import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { prisma } from "./db";
import { getObject } from "./storage";
import { ANGLE_LABELS } from "./constants";
import { logEvent } from "./bookings";

/**
 * Automatic damage review of dock photos with Claude vision.
 *
 * - Check-out ("before") photos: flags damage that is ALREADY there, so the
 *   crew can document it and the renter isn't blamed for it later.
 * - Check-in ("after") photos: compares against the before photo from the same
 *   angle and flags anything NEW.
 *
 * Findings are saved as DamageReport rows with status "needs_check". The dock
 * crew confirms or dismisses each one; nothing is charged automatically.
 * Without ANTHROPIC_API_KEY the review is skipped and the crew logs damage by hand.
 */

const MODEL = "claude-opus-5-5";
const SUPPORTED = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type Supported = (typeof SUPPORTED)[number];

export const isDamageReviewEnabled = () => !!process.env.ANTHROPIC_API_KEY;

const Findings = z.object({
  photo_quality: z.enum(["ok", "too_dark", "blurry", "wrong_angle", "obstructed"]),
  summary: z.string(),
  findings: z.array(
    z.object({
      location: z.string(),
      description: z.string(),
      severity: z.enum(["minor", "moderate", "major"]),
      confidence: z.number(),
    }),
  ),
});

let _client: Anthropic | null = null;
const client = () => (_client ??= new Anthropic());

async function imageBlock(storageKey: string, contentType: string): Promise<Anthropic.ImageBlockParam | null> {
  if (!SUPPORTED.includes(contentType as Supported)) return null;
  const buf = await getObject(storageKey);
  if (!buf) return null;
  return { type: "image", source: { type: "base64", media_type: contentType as Supported, data: buf.toString("base64") } };
}

const SYSTEM = `You inspect rental boats (tritoon pontoon boats) at a marina in Port Aransas, Texas, from photos the dock crew takes at check-out and check-in.
Look for physical damage: dents, gouges, deep scratches, cracked or chipped fiberglass, bent or dented pontoons, bent rails or ladder, torn or cut upholstery, burns, broken or missing hardware (cleats, lights, cup holders, Bimini parts), cracked screens or gauges, and propeller damage (chips, bends, missing blade tips).
Ignore normal conditions: water spots, dirt, sand, wet surfaces, reflections, shadows, ordinary wear, items the guests left, and fenders/lines.
Describe each spot so a crew member can find it in seconds (e.g. "port pontoon, about 2 ft behind the boarding gate, just above waterline").
Be careful but not alarmist: list only things a reasonable inspector would want checked, with your honest confidence from 0 to 1.`;

/** Runs the review for one photo. Safe to call in the background; never throws. */
export async function reviewPhoto(photoId: string): Promise<void> {
  const photo = await prisma.photo.findUnique({ where: { id: photoId }, include: { booking: { include: { boat: true } } } });
  if (!photo || (photo.phase !== "before" && photo.phase !== "after")) return;
  if (!isDamageReviewEnabled()) {
    await prisma.photo.update({ where: { id: photoId }, data: { aiStatus: "skipped" } });
    return;
  }
  await prisma.photo.update({ where: { id: photoId }, data: { aiStatus: "pending" } });
  try {
    const current = await imageBlock(photo.storageKey, photo.contentType);
    if (!current) {
      await prisma.photo.update({ where: { id: photoId }, data: { aiStatus: "skipped", aiSummary: "Photo format can't be reviewed automatically." } });
      return;
    }
    const angle = ANGLE_LABELS[photo.angle] ?? photo.angle;
    const boat = photo.booking.boat;
    const known = await prisma.damageReport.findMany({
      where: { boatId: boat.id, status: "confirmed", OR: [{ angle: photo.angle }, { angle: "other" }] },
      orderBy: { createdAt: "desc" },
      take: 15,
    });
    const knownText = known.length
      ? `Damage already on record for this boat (do not report these again):\n${known.map((k) => `- ${k.location ? k.location + ": " : ""}${k.description}`).join("\n")}`
      : "No damage is on record for this boat yet.";

    const content: Anthropic.ContentBlockParam[] = [];
    if (photo.phase === "after") {
      const before = await prisma.photo.findFirst({
        where: { bookingId: photo.bookingId, phase: "before", angle: photo.angle },
        orderBy: { createdAt: "desc" },
      });
      const beforeBlock = before ? await imageBlock(before.storageKey, before.contentType) : null;
      if (beforeBlock) {
        content.push({ type: "text", text: `BEFORE photo (${angle}), taken at check-out:` }, beforeBlock);
        content.push({ type: "text", text: `AFTER photo (${angle}), taken at check-in just now:` }, current);
        content.push({
          type: "text",
          text: `${knownText}\n\nBoat: ${boat.name} (${boat.type}). Compare the two photos and list damage visible in the AFTER photo that is NOT visible in the BEFORE photo. If the angles differ, only report what you can reasonably compare. If nothing new, return an empty findings list.`,
        });
      } else {
        content.push({ type: "text", text: `Check-in photo (${angle}). No matching check-out photo exists.` }, current);
        content.push({
          type: "text",
          text: `${knownText}\n\nBoat: ${boat.name} (${boat.type}). List any damage you can see that is not already on record, so the crew can check whether it is new.`,
        });
      }
    } else {
      content.push({ type: "text", text: `Check-out photo (${angle}), taken before the guests leave:` }, current);
      content.push({
        type: "text",
        text: `${knownText}\n\nBoat: ${boat.name} (${boat.type}). List existing damage visible in this photo that is not already on record, so the crew can document it before departure.`,
      });
    }

    // Server-side fallback: if the model declines a request, the API retries it on a fallback model.
    const response = await client().beta.messages.parse({
      model: MODEL,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: "medium", format: zodOutputFormat(Findings) },
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      await prisma.photo.update({ where: { id: photoId }, data: { aiStatus: "error", aiSummary: "Review unavailable for this photo." } });
      return;
    }
    const out = response.parsed_output;
    const findings = out.findings.filter((f) => f.confidence >= 0.35);
    const quality = out.photo_quality !== "ok" ? ` Retake suggested: ${out.photo_quality.replace("_", " ")}.` : "";
    await prisma.$transaction([
      prisma.photo.update({ where: { id: photoId }, data: { aiStatus: "done", aiSummary: (out.summary + quality).slice(0, 1000) } }),
      ...findings.map((f) =>
        prisma.damageReport.create({
          data: {
            boatId: boat.id,
            bookingId: photo.bookingId,
            photoId,
            source: "ai",
            phase: photo.phase,
            angle: photo.angle,
            location: f.location.slice(0, 300),
            description: f.description.slice(0, 1000),
            severity: f.severity,
            confidence: f.confidence,
            status: "needs_check",
          },
        }),
      ),
    ]);
    if (findings.length) {
      await logEvent(
        photo.bookingId,
        "ai_damage",
        `Photo review flagged ${findings.length} spot(s) to check on ${angle} (${photo.phase === "after" ? "possible new damage" : "existing damage"})`,
        "Photo review",
      );
      if (photo.phase === "after") {
        const { alertCrew } = await import("./messaging");
        await alertCrew(
          `⚠ ${boat.name} check-in: ${findings.length} possible damage spot(s) on ${angle}. ${findings
            .map((f) => f.location)
            .join("; ")
            .slice(0, 200)}`,
        );
      }
    }
  } catch (e) {
    console.error("Damage review failed", e);
    await prisma.photo.update({ where: { id: photoId }, data: { aiStatus: "error", aiSummary: "Review failed; check the photo by eye." } }).catch(() => {});
  }
}

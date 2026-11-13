import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { putObject } from "./storage";
import { alertCrew } from "./messaging";
import { appUrl, emailLayout, sendMail } from "./mail";
import { fmtDateTime, zonedToUtc } from "./time";
import { logEvent } from "./bookings";
import { INCIDENT_TYPE_LABELS, needsTpwdReminder, TPWD_ACCIDENT_URL, TPWD_PHONE } from "./incidentRules";

export const INCIDENT_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const INCIDENT_PHOTO_MAX_BYTES = 15 * 1024 * 1024;
/** Guests can add at most this many photos to one report. */
export const GUEST_PHOTO_LIMIT = 8;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Save one incident photo. Returns an error string or the new photo id. */
export async function saveIncidentPhoto(incidentId: string, file: File): Promise<{ id?: string; error?: string }> {
  if (!INCIDENT_PHOTO_TYPES.includes(file.type)) return { error: `Unsupported file type ${file.type || "(unknown)"}` };
  if (file.size > INCIDENT_PHOTO_MAX_BYTES) return { error: "Photo too large (max 15 MB)" };
  const ext = file.type.split("/")[1].replace("jpeg", "jpg");
  const key = `incidents/${incidentId}/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
  const p = await prisma.incidentPhoto.create({ data: { incidentId, storageKey: key, contentType: file.type } });
  return { id: p.id };
}

/** Text the alert phone and email the office about a new incident. Never throws. */
export async function notifyIncident(id: string) {
  try {
    const i = await prisma.incident.findUnique({
      where: { id },
      include: { boat: { include: { insurance: { orderBy: { expiresAt: "desc" } } } }, booking: { select: { code: true } } },
    });
    if (!i) return;
    const type = INCIDENT_TYPE_LABELS[i.type] ?? i.type;
    const link = await appUrl(`/admin/incidents/${i.id}`);
    const who = i.reporterType === "guest" ? `Guest ${i.reporterName}` : i.reporterName;
    const flags = [i.injuries && "INJURIES", i.emsCalled && "EMS called"].filter(Boolean).join(", ");
    const tpwd = needsTpwdReminder(i);
    const claims = i.boat?.insurance.find((p) => p.claimsPhone)?.claimsPhone;
    const carrier = i.boat?.insurance[0]?.carrier;

    await alertCrew(
      `INCIDENT (${i.severity}): ${type}${i.boat ? ` on ${i.boat.name}` : ""}${flags ? ` - ${flags}` : ""}. Reported by ${who}. ${link}`,
    );

    const staff = process.env.STAFF_NOTIFY_EMAIL;
    if (staff) {
      const reminders = tpwd
        ? `<div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:12px;margin:12px 0">
<b>Texas boating accident report may be required.</b> TPWD asks operators to report accidents with a death, an injury needing more than first aid,
or more than $2,000 in damage (deaths within 48 hours; written report within 30 days). Check TPWD guidance:
<a href="${TPWD_ACCIDENT_URL}">${TPWD_ACCIDENT_URL}</a> or call ${TPWD_PHONE}.<br><br>
Also consider notifying the insurance carrier${carrier ? ` (${esc(carrier)})` : ""}${claims ? `: claims ${esc(claims)}` : ""}.
</div>`
        : "";
      await sendMail({
        to: staff,
        subject: `Incident: ${type}${i.boat ? ` on ${i.boat.name}` : ""} (${i.severity})`,
        html: emailLayout(
          "New incident report",
          `<p><b>${esc(type)}</b> · severity ${esc(i.severity)}${flags ? ` · <b>${flags}</b>` : ""}</p>
<p>${esc(fmtDateTime(i.occurredAt))}${i.location ? ` · ${esc(i.location)}` : ""}<br>
${i.boat ? `Boat: ${esc(i.boat.name)}<br>` : ""}${i.booking ? `Booking: #${esc(i.booking.code)}<br>` : ""}
Reported by: ${esc(who)}${i.reporterPhone ? ` (${esc(i.reporterPhone)})` : ""}</p>
<p style="white-space:pre-wrap">${esc(i.description)}</p>${reminders}
<p><a href="${link}" style="background:#C62828;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open the report</a></p>`,
        ),
      });
    }
    if (i.bookingId) await logEvent(i.bookingId, "incident", `Incident reported: ${type} (${i.severity})`, i.reporterName);
  } catch (e) {
    console.error("[incident] notify failed", e);
  }
}

const field = (f: FormData, k: string, max = 4000) => String(f.get(k) ?? "").trim().slice(0, max);

/** Read the common incident fields from a form. Returns an error message or the data. */
export function parseIncidentForm(f: FormData, allowedTypes: readonly string[]) {
  const type = field(f, "type", 40);
  const description = field(f, "description");
  if (!allowedTypes.includes(type)) return { error: "Pick what kind of problem it was." } as const;
  if (!description) return { error: "Please tell us what happened." } as const;
  const date = field(f, "date", 10);
  const time = field(f, "time", 5) || "12:00";
  let occurredAt = new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time)) occurredAt = zonedToUtc(date, time);
  if (occurredAt.getTime() > Date.now() + 60 * 60_000) return { error: "The date and time can't be in the future." } as const;
  const severity = ["low", "medium", "high"].includes(field(f, "severity", 10)) ? field(f, "severity", 10) : "low";
  return {
    data: {
      type,
      severity,
      occurredAt,
      location: field(f, "location", 300),
      description,
      peopleInvolved: field(f, "peopleInvolved"),
      witnesses: field(f, "witnesses"),
      injuries: f.get("injuries") === "on",
      emsCalled: f.get("emsCalled") === "on",
      authoritiesNotified: field(f, "authoritiesNotified", 300),
      actionsTaken: field(f, "actionsTaken"),
    },
  } as const;
}

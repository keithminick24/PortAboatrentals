import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { putObject } from "@/lib/storage";
import { PHOTO_ANGLES, PHOTO_PHASES } from "@/lib/constants";
import { reviewPhoto } from "@/lib/damageReview";
import { logEvent } from "@/lib/bookings";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await req.formData();
  const bookingId = String(form.get("bookingId") ?? "");
  const phase = String(form.get("phase") ?? "");
  const caption = String(form.get("caption") ?? "").slice(0, 300);
  const rawAngle = String(form.get("angle") ?? "other");
  const angle = PHOTO_ANGLES.some((a) => a.key === rawAngle) ? rawAngle : "other";
  if (!PHOTO_PHASES.includes(phase as (typeof PHOTO_PHASES)[number])) {
    return NextResponse.json({ error: "Invalid phase" }, { status: 400 });
  }
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true, code: true } });
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "No files" }, { status: 400 });

  const saved: Awaited<ReturnType<typeof prisma.photo.create>>[] = [];
  for (const file of files) {
    if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: `Unsupported file type ${file.type}` }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 20 MB)" }, { status: 400 });
    const ext = file.type.split("/")[1].replace("jpeg", "jpg");
    const key = `bookings/${booking.code}/${phase}/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
    await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
    saved.push(
      await prisma.photo.create({
        data: { bookingId, phase, angle, storageKey: key, contentType: file.type, sizeBytes: file.size, caption, uploadedBy: s.name },
      }),
    );
  }
  await logEvent(bookingId, "photos", `${saved.length} ${phase} photo(s) uploaded`, s.name);
  // Automatic damage review runs after the response so the crew isn't kept waiting.
  if (phase === "before" || phase === "after") {
    await prisma.photo.updateMany({ where: { id: { in: saved.map((p) => p.id) } }, data: { aiStatus: "pending" } });
    after(async () => {
      for (const p of saved) await reviewPhoto(p.id);
    });
  }
  return NextResponse.json({ ok: true, count: saved.length, ids: saved.map((p) => p.id) });
}

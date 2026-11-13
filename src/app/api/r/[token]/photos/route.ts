import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { GUEST_PHOTO_LIMIT, saveIncidentPhoto } from "@/lib/incidents";

// Public, token-checked: a guest adds photos to the report they just filed.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await prisma.booking.findUnique({ where: { accessToken: token }, select: { id: true } });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const form = await req.formData();
  const incidentId = String(form.get("incidentId") ?? "");
  const incident = await prisma.incident.findFirst({
    where: {
      id: incidentId,
      bookingId: booking.id,
      reporterType: "guest",
      // Photos can only be added for a short while after the report is sent.
      createdAt: { gte: new Date(Date.now() - 2 * 60 * 60_000) },
    },
    include: { _count: { select: { photos: true } } },
  });
  if (!incident) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "No files" }, { status: 400 });
  if (incident._count.photos + files.length > GUEST_PHOTO_LIMIT) {
    return NextResponse.json({ error: `Up to ${GUEST_PHOTO_LIMIT} photos per report` }, { status: 400 });
  }
  for (const file of files) {
    const r = await saveIncidentPhoto(incident.id, file);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, count: files.length });
}

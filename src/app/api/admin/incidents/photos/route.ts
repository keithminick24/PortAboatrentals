import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { saveIncidentPhoto } from "@/lib/incidents";

// Staff-only: add photos to an incident report.
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(s.role, "dock") && !can(s.role, "ops")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const form = await req.formData();
  const incidentId = String(form.get("incidentId") ?? "");
  const incident = await prisma.incident.findUnique({ where: { id: incidentId }, select: { id: true } });
  if (!incident) return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "No files" }, { status: 400 });
  const ids: string[] = [];
  for (const file of files) {
    const r = await saveIncidentPhoto(incident.id, file);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    ids.push(r.id!);
  }
  return NextResponse.json({ ok: true, count: ids.length, ids });
}

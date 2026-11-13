"use server";

import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { notifyIncident, parseIncidentForm } from "@/lib/incidents";
import { INCIDENT_TYPE_KEYS } from "@/lib/incidentRules";

/** Crew (or any staff) files an incident report from the dock app. */
export async function createCrewIncident(f: FormData): Promise<{ id?: string; error?: string }> {
  const s = await requirePermission("dock");
  const parsed = parseIncidentForm(f, INCIDENT_TYPE_KEYS);
  if ("error" in parsed) return { error: parsed.error };
  const bookingId = String(f.get("bookingId") ?? "") || null;
  let boatId = String(f.get("boatId") ?? "") || null;
  if (bookingId) {
    const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { boatId: true } });
    if (!b) return { error: "That trip wasn't found." };
    boatId ??= b.boatId;
  }
  if (boatId && !(await prisma.boat.findUnique({ where: { id: boatId }, select: { id: true } }))) boatId = null;
  const me = await prisma.adminUser.findUnique({ where: { id: s.uid }, select: { phone: true } });
  const i = await prisma.incident.create({
    data: { ...parsed.data, bookingId, boatId, reporterType: "crew", reporterName: s.name, reporterPhone: me?.phone ?? "" },
  });
  await notifyIncident(i.id);
  return { id: i.id };
}

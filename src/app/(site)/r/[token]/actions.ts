"use server";

import { prisma } from "@/lib/db";
import { notifyIncident, parseIncidentForm } from "@/lib/incidents";
import { GUEST_INCIDENT_TYPES } from "@/lib/incidentRules";

const GUEST_TYPES = GUEST_INCIDENT_TYPES.map(([k]) => k as string);

/** A guest reports a problem from their booking link. The token is the booking's accessToken. */
export async function createGuestIncident(token: string, f: FormData): Promise<{ id?: string; error?: string }> {
  const b = await prisma.booking.findUnique({ where: { accessToken: String(token) }, select: { id: true, boatId: true } });
  if (!b) return { error: "We couldn't find your booking. Please call us." };
  const recent = await prisma.incident.count({
    where: { bookingId: b.id, reporterType: "guest", createdAt: { gte: new Date(Date.now() - 86_400_000) } },
  });
  if (recent >= 5) return { error: "We've received several reports already. Please call us." };
  const parsed = parseIncidentForm(f, GUEST_TYPES);
  if ("error" in parsed) return { error: parsed.error };
  const name = String(f.get("reporterName") ?? "").trim().slice(0, 120);
  if (!name) return { error: "Please add your name." };
  const d = parsed.data;
  const i = await prisma.incident.create({
    data: {
      ...d,
      // Guests don't rate severity; injuries count as high so the office sees it first.
      severity: d.injuries ? "high" : ["collision", "grounding"].includes(d.type) ? "medium" : "low",
      emsCalled: false,
      witnesses: "",
      authoritiesNotified: "",
      actionsTaken: "",
      bookingId: b.id,
      boatId: b.boatId,
      reporterType: "guest",
      reporterName: name,
      reporterPhone: String(f.get("reporterPhone") ?? "").trim().slice(0, 40),
    },
  });
  await notifyIncident(i.id);
  return { id: i.id };
}

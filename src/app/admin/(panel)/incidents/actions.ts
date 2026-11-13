"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { deleteObject } from "@/lib/storage";
import { fmtDateTime } from "@/lib/time";
import { logEvent } from "@/lib/bookings";
import { INCIDENT_STATUS_LABELS } from "@/lib/incidentRules";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, msg?: string, err?: string): never => {
  const q = new URLSearchParams();
  if (msg) q.set("msg", msg);
  if (err) q.set("err", err);
  redirect(`${path}${q.size ? `?${q}` : ""}`);
};

/** Change status and/or add a follow-up note (notes are appended with a timestamp). */
export async function updateIncident(f: FormData) {
  const s = await requirePermission("incidents");
  const id = str(f, "id");
  const i = await prisma.incident.findUnique({ where: { id } });
  if (!i) return back("/admin/incidents", undefined, "Incident not found");
  const status = str(f, "status");
  const note = str(f, "note").slice(0, 4000);
  const data: { status?: string; followUp?: string } = {};
  if (status && status !== i.status && INCIDENT_STATUS_LABELS[status]) data.status = status;
  const stamp = `[${fmtDateTime(new Date())} · ${s.name}]`;
  const lines: string[] = [];
  if (data.status) lines.push(`${stamp} Status: ${INCIDENT_STATUS_LABELS[data.status]}`);
  if (note) lines.push(`${stamp} ${note}`);
  if (lines.length === 0) return back(`/admin/incidents/${id}`, undefined, "Nothing to save");
  data.followUp = [i.followUp, ...lines].filter(Boolean).join("\n");
  await prisma.incident.update({ where: { id }, data });
  if (data.status && i.bookingId) await logEvent(i.bookingId, "incident", `Incident marked ${INCIDENT_STATUS_LABELS[data.status]}`, s.name);
  back(`/admin/incidents/${id}`, "Saved");
}

/** Fix the core details (office corrections). */
export async function editIncidentDetails(f: FormData) {
  await requirePermission("incidents");
  const id = str(f, "id");
  const severity = ["low", "medium", "high"].includes(str(f, "severity")) ? str(f, "severity") : "low";
  await prisma.incident.update({
    where: { id },
    data: {
      severity,
      injuries: str(f, "injuries") === "on",
      emsCalled: str(f, "emsCalled") === "on",
      authoritiesNotified: str(f, "authoritiesNotified").slice(0, 300),
      boatId: str(f, "boatId") || null,
    },
  });
  back(`/admin/incidents/${id}`, "Details updated");
}

export async function deleteIncidentPhoto(f: FormData) {
  await requirePermission("incidents");
  const p = await prisma.incidentPhoto.delete({ where: { id: str(f, "photoId") } });
  await deleteObject(p.storageKey);
  back(`/admin/incidents/${p.incidentId}`, "Photo deleted");
}

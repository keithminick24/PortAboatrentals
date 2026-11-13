import Link from "next/link";
import { prisma } from "@/lib/db";
import { INCIDENT_TYPE_LABELS } from "@/lib/incidentRules";

/** One-line banner on the booking page when incidents were reported for this trip. */
export default async function BookingIncidents({ bookingId }: { bookingId: string }) {
  const list = await prisma.incident.findMany({ where: { bookingId }, select: { id: true, type: true, status: true }, orderBy: { createdAt: "desc" } });
  if (list.length === 0) return null;
  const open = list.filter((i) => i.status !== "closed").length;
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
      ⚠ {list.length} incident report{list.length > 1 ? "s" : ""} for this trip{open ? ` (${open} open)` : ""}:{" "}
      {list.map((i, n) => (
        <span key={i.id}>
          {n > 0 && ", "}
          <Link href={`/admin/incidents/${i.id}`} className="font-semibold underline">{INCIDENT_TYPE_LABELS[i.type] ?? i.type}</Link>
        </span>
      ))}
    </div>
  );
}

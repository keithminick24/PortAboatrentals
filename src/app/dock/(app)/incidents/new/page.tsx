import Link from "next/link";
import { prisma } from "@/lib/db";
import { addDays, fmtTime, localTime, todayLocal, zonedToUtc } from "@/lib/time";
import IncidentForm from "@/components/IncidentForm";
import { createCrewIncident } from "../../../incident-actions";

export default async function NewIncident({ searchParams }: { searchParams: Promise<{ bookingId?: string; boatId?: string }> }) {
  const sp = await searchParams;
  const today = todayLocal();
  const start = zonedToUtc(today, "00:00");
  const end = zonedToUtc(addDays(today, 1), "00:00");
  const [bookings, boats] = await Promise.all([
    prisma.booking.findMany({
      where: {
        OR: [
          { startsAt: { gte: start, lt: end }, status: { notIn: ["cancelled", "no_show", "pending"] } },
          { status: "checked_out" },
          ...(sp.bookingId ? [{ id: sp.bookingId }] : []),
        ],
      },
      include: { boat: true, customer: true },
      orderBy: { startsAt: "asc" },
    }),
    prisma.boat.findMany({ where: { status: { not: "retired" } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  const prefillBoat = sp.boatId ?? bookings.find((b) => b.id === sp.bookingId)?.boatId;

  return (
    <div className="space-y-4">
      <Link href="/dock/incidents" className="text-sm text-brand">← Incidents</Link>
      <div>
        <h1 className="text-2xl font-bold">Report an incident</h1>
        <p className="text-sm text-slate-600">Anyone hurt? Call 911 first. Fill this in once everyone is safe.</p>
      </div>
      <IncidentForm
        mode="crew"
        action={createCrewIncident}
        uploadUrl="/api/admin/incidents/photos"
        doneHref="/dock/incidents"
        bookings={bookings.map((b) => ({
          id: b.id,
          boatId: b.boatId,
          label: `${b.boat.name} · ${b.customer.firstName} ${b.customer.lastName} · ${fmtTime(b.startsAt)}`,
        }))}
        boats={boats.map((b) => ({ id: b.id, label: b.name }))}
        defaults={{ date: today, time: localTime(new Date()), bookingId: sp.bookingId, boatId: prefillBoat }}
      />
    </div>
  );
}

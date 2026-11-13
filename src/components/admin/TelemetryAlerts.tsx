import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/time";
import { ackTelemetryAlert } from "@/app/admin/(panel)/boats/telemetry-actions";

/** Open BoatFix alerts (bilge, battery, engine fault, geofence) on the Today page. */
export default async function TelemetryAlerts({ returnTo = "/admin" }: { returnTo?: string }) {
  const alerts = await prisma.telemetryAlert.findMany({ where: { status: "open" }, include: { boat: true }, orderBy: { occurredAt: "desc" }, take: 10 });
  if (alerts.length === 0) return null;
  return (
    <div className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
      <div className="font-semibold text-amber-900">⚠ BoatFix alerts ({alerts.length})</div>
      <ul className="mt-2 space-y-1 text-sm">
        {alerts.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <Link className="font-medium underline" href={`/admin/boats/${a.boatId}#boatfix`}>{a.boat.name}</Link>: {a.message}{" "}
              <span className="text-xs text-amber-800">{fmtDateTime(a.occurredAt)}</span>
            </span>
            <form action={ackTelemetryAlert}>
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button className="rounded border border-amber-400 bg-white px-2 py-0.5 text-xs">Mark seen</button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}

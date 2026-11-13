import { prisma } from "@/lib/db";
import { isTelemetryWebhookEnabled } from "@/lib/telemetry";
import { fmtDateTime } from "@/lib/time";
import { Pill } from "@/components/ui";
import { ackTelemetryAlert, importBoatfixCsv, saveBoatfix } from "@/app/admin/(panel)/boats/telemetry-actions";

/** BoatFix (telematics) card on a boat's page: device link, latest readings, alerts, report import. */
export default async function BoatTelemetry({ boatId }: { boatId: string }) {
  const boat = await prisma.boat.findUniqueOrThrow({ where: { id: boatId } });
  const [latest, alerts, located] = await Promise.all([
    prisma.telemetryReading.findFirst({ where: { boatId }, orderBy: { recordedAt: "desc" } }),
    prisma.telemetryAlert.findMany({ where: { boatId }, orderBy: { occurredAt: "desc" }, take: 10 }),
    prisma.telemetryReading.findFirst({ where: { boatId, lat: { not: null } }, orderBy: { recordedAt: "desc" } }),
  ]);
  const live = isTelemetryWebhookEnabled();
  return (
    <div id="boatfix" className="card card-pad space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="h2">BoatFix telematics</h2>
        <Pill tone={live && boat.boatfixDeviceId ? "green" : "amber"}>{live && boat.boatfixDeviceId ? "Receiving updates" : "Not receiving updates yet"}</Pill>
      </div>
      <form action={saveBoatfix} className="grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="boatId" value={boat.id} />
        <div><label className="label">BoatFix device ID / serial</label><input name="boatfixDeviceId" className="input" defaultValue={boat.boatfixDeviceId} placeholder="From the BoatFix app or device label" /></div>
        <div className="sm:col-span-2"><label className="label">Link to this boat in BoatFix</label><input name="boatfixUrl" className="input" defaultValue={boat.boatfixUrl} placeholder="https://… (copy from the BoatFix web portal)" /></div>
        <div className="flex flex-wrap gap-2 sm:col-span-3">
          <button className="btn-secondary btn-sm">Save</button>
          {boat.boatfixUrl && <a className="btn-secondary btn-sm" href={boat.boatfixUrl} target="_blank" rel="noreferrer">Open in BoatFix ↗</a>}
        </div>
      </form>
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-3"><div className="muted">Engine hours</div><div className="text-lg font-semibold">{boat.engineHours.toFixed(1)}</div><div className="muted text-xs">{latest ? `BoatFix ${fmtDateTime(latest.recordedAt)}` : "No BoatFix reading yet"}</div></div>
        <div className="rounded-lg bg-slate-50 p-3"><div className="muted">Last position</div>{located ? <a className="text-brand underline" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${located.lat},${located.lng}`}>{located.lat!.toFixed(4)}, {located.lng!.toFixed(4)}</a> : <div>—</div>}<div className="muted text-xs">{located ? fmtDateTime(located.recordedAt) : ""}</div></div>
        <div className="rounded-lg bg-slate-50 p-3"><div className="muted">Battery</div><div className="text-lg font-semibold">{latest?.batteryVolts != null ? `${latest.batteryVolts.toFixed(1)} V` : "—"}</div></div>
      </div>
      <div>
        <div className="mb-1 text-sm font-semibold">Alerts</div>
        {alerts.length === 0 ? <p className="muted">None.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-1.5">
                <span>{a.status === "open" ? "⚠ " : ""}{a.message} <span className="muted text-xs">{fmtDateTime(a.occurredAt)}{a.ackBy ? ` · seen by ${a.ackBy}` : ""}</span></span>
                {a.status === "open" && (
                  <form action={ackTelemetryAlert}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="returnTo" value={`/admin/boats/${boat.id}#boatfix`} /><button className="btn-secondary btn-sm">Mark seen</button></form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-brand">Import a BoatFix report (CSV)</summary>
        <form action={importBoatfixCsv} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="boatId" value={boat.id} />
          <input type="file" name="file" accept=".csv,text/csv,text/plain" className="text-sm" />
          <button className="btn-secondary btn-sm">Import</button>
        </form>
        <p className="muted mt-1 text-xs">Needs a date column and an engine hours column (battery and GPS optional). Engine hours here update service reminders.</p>
      </details>
    </div>
  );
}

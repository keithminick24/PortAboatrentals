import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/time";
import { INCIDENT_STATUS_LABELS, INCIDENT_TYPE_LABELS, needsTpwdReminder } from "@/lib/incidentRules";
import FlashMessage from "@/components/FlashMessage";
import TpwdReminder from "@/components/TpwdReminder";

export default async function DockIncidents({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const since = new Date(Date.now() - 60 * 86_400_000);
  const incidents = await prisma.incident.findMany({
    where: { createdAt: { gte: since } },
    include: { boat: { include: { insurance: true } }, _count: { select: { photos: true } } },
    orderBy: { occurredAt: "desc" },
    take: 50,
  });
  const latest = incidents[0];
  const justFiled = sp.msg && latest && Date.now() - latest.createdAt.getTime() < 10 * 60_000;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Incidents</h1>
        <Link href="/dock/incidents/new" className="btn-primary">+ Report</Link>
      </div>
      <FlashMessage msg={sp.msg} err={sp.err} />
      {justFiled && needsTpwdReminder(latest) && (
        <TpwdReminder claimsPhone={latest.boat?.insurance.find((p) => p.claimsPhone)?.claimsPhone} carrier={latest.boat?.insurance[0]?.carrier} />
      )}
      {incidents.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-500">No incidents in the last 60 days.</div>
      )}
      <div className="space-y-2">
        {incidents.map((i) => (
          <details key={i.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <summary className="cursor-pointer">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-bold">{INCIDENT_TYPE_LABELS[i.type] ?? i.type}{i.boat ? ` · ${i.boat.name}` : ""}</span>
                <span className="text-xs text-slate-500">{INCIDENT_STATUS_LABELS[i.status] ?? i.status}</span>
              </div>
              <div className="text-sm text-slate-600">
                {fmtDateTime(i.occurredAt)} · {i.reporterType === "guest" ? "Guest" : "Crew"}: {i.reporterName}
                {i.injuries ? <span className="font-semibold text-rose-700"> · injuries</span> : null}
              </div>
            </summary>
            <div className="mt-2 space-y-1 text-sm">
              {i.location && <div><b>Where:</b> {i.location}</div>}
              <div className="whitespace-pre-wrap">{i.description}</div>
              {i.actionsTaken && <div><b>Done:</b> {i.actionsTaken}</div>}
              {i._count.photos > 0 && <div className="text-slate-500">{i._count.photos} photo(s)</div>}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

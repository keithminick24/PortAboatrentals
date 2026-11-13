import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/time";
import { INCIDENT_TYPES } from "@/lib/constants";
import { INCIDENT_STATUSES, INCIDENT_STATUS_LABELS, INCIDENT_TYPE_LABELS, severityTone, statusTone } from "@/lib/incidentRules";
import { Empty, PageHeader, Pill } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; boat?: string; msg?: string; err?: string }>;
}) {
  const sp = await searchParams;
  const status = sp.status ?? "active";
  const where = {
    ...(status === "active" ? { status: { in: ["open", "investigating"] } } : status !== "all" ? { status } : {}),
    ...(sp.type ? { type: sp.type } : {}),
    ...(sp.boat ? { boatId: sp.boat } : {}),
  };
  const [incidents, boats, openCount] = await Promise.all([
    prisma.incident.findMany({
      where,
      include: { boat: true, booking: { select: { code: true } }, _count: { select: { photos: true } } },
      orderBy: { occurredAt: "desc" },
      take: 200,
    }),
    prisma.boat.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.incident.count({ where: { status: "open" } }),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Incidents"
        subtitle={`Reports from crew and guests. ${openCount} open.`}
        actions={<Link href="/dock/incidents/new" className="btn-primary">+ New report</Link>}
      />
      <FlashMessage msg={sp.msg} err={sp.err} />

      <form className="card card-pad flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Status</label>
          <select name="status" className="input" defaultValue={status}>
            <option value="active">Open + investigating</option>
            {INCIDENT_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            <option value="all">All</option>
          </select>
        </div>
        <div>
          <label className="label">Type</label>
          <select name="type" className="input" defaultValue={sp.type ?? ""}>
            <option value="">All types</option>
            {INCIDENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Boat</label>
          <select name="boat" className="input" defaultValue={sp.boat ?? ""}>
            <option value="">All boats</option>
            {boats.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <button className="btn-secondary">Filter</button>
      </form>

      {incidents.length === 0 ? (
        <Empty>No incidents match.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">What</th>
                <th className="px-4 py-2">Boat / trip</th>
                <th className="px-4 py-2">Reported by</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {incidents.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-2">{fmtDateTime(i.occurredAt)}</td>
                  <td className="px-4 py-2">
                    <Link href={`/admin/incidents/${i.id}`} className="font-medium text-brand hover:underline">
                      {INCIDENT_TYPE_LABELS[i.type] ?? i.type}
                    </Link>{" "}
                    <Pill tone={severityTone(i.severity)}>{i.severity}</Pill>
                    {i.injuries && <> <Pill tone="red">injuries</Pill></>}
                    <div className="muted line-clamp-1 max-w-md">{i.description}</div>
                  </td>
                  <td className="px-4 py-2">
                    {i.boat?.name ?? "—"}
                    {i.booking && <div className="muted">#{i.booking.code}</div>}
                  </td>
                  <td className="px-4 py-2">{i.reporterType === "guest" ? "Guest" : "Crew"}: {i.reporterName}</td>
                  <td className="px-4 py-2"><Pill tone={statusTone(i.status)}>{INCIDENT_STATUS_LABELS[i.status] ?? i.status}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

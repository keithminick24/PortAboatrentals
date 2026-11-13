import Link from "next/link";
import { prisma } from "@/lib/db";
import { dueStatus } from "@/lib/maintenance";
import { fmtMoney } from "@/lib/money";
import { fmtDate, todayLocal } from "@/lib/time";
import { PageHeader, Pill, Empty } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import { addMaintenance } from "../../actions";

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const [boats, addOns, recent, issues] = await Promise.all([
    prisma.boat.findMany({ where: { status: { not: "retired" } }, include: { schedules: { where: { active: true } } }, orderBy: { sortOrder: "asc" } }),
    prisma.addOn.findMany({ include: { maintenance: { orderBy: { performedAt: "desc" }, take: 3 } }, orderBy: { sortOrder: "asc" } }),
    prisma.maintenanceLog.findMany({ orderBy: { performedAt: "desc" }, take: 30, include: { boat: true, addOn: true } }),
    prisma.maintenanceLog.findMany({ where: { category: "issue" }, orderBy: { performedAt: "desc" }, take: 20, include: { boat: true, addOn: true } }),
  ]);
  const due = boats
    .flatMap((b) => b.schedules.map((s) => ({ boat: b, s, d: dueStatus(s, b.engineHours) })))
    .filter((x) => x.d.state !== "ok")
    .sort((a, b) => (a.d.state === b.d.state ? 0 : a.d.state === "due" ? -1 : 1));

  return (
    <div className="space-y-6">
      <PageHeader title="Maintenance" subtitle="Service due across the fleet, equipment upkeep, and every log entry. Each boat's full history is on its Fleet page." />
      <FlashMessage msg={sp.msg} err={sp.err} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card card-pad">
          <h2 className="h2 mb-3">Due now or soon</h2>
          {due.length === 0 ? <Empty>Everything is up to date.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {due.map(({ boat, s, d }) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <Link href={`/admin/boats/${boat.id}`} className="font-medium text-brand hover:underline">{boat.name}</Link> · {s.name}
                    <div className="muted">{d.label}</div>
                  </div>
                  <Pill tone={d.state === "due" ? "red" : "amber"}>{d.state === "due" ? "Due" : "Soon"}</Pill>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card card-pad">
          <h2 className="h2 mb-3">Open issues reported</h2>
          {issues.length === 0 ? <p className="muted">None reported.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {issues.map((m) => (
                <li key={m.id} className="py-2">
                  <div className="font-medium">{m.boat?.name ?? m.addOn?.name}: {m.description}</div>
                  <div className="muted">{fmtDate(m.performedAt)}{m.createdBy && ` · ${m.createdBy}`}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card card-pad space-y-3">
        <h2 className="h2">Equipment (add-ons)</h2>
        <p className="muted text-sm">Paddle boards, floats, coolers and other gear. Log repairs, replacements and inspections here.</p>
        <form action={addMaintenance} className="grid grid-cols-12 gap-2">
          <input type="hidden" name="returnTo" value="/admin/maintenance" />
          <select name="addOnId" className="input col-span-12 sm:col-span-3" required>
            {addOns.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input name="description" className="input col-span-12 sm:col-span-4" placeholder="e.g. Patched leak on board #3" required />
          <select name="category" className="input col-span-4 sm:col-span-2">
            <option value="repair">Repair</option><option value="inspection">Inspection</option><option value="service">Service</option><option value="cleaning">Cleaning</option><option value="issue">Issue to fix</option>
          </select>
          <input name="date" type="date" className="input col-span-4 sm:col-span-2" defaultValue={todayLocal()} />
          <input name="cost" className="input col-span-4 sm:col-span-1" placeholder="$" />
          <button className="btn-secondary btn-sm col-span-12">Log equipment work</button>
        </form>
        <div className="grid gap-3 sm:grid-cols-3">
          {addOns.map((a) => (
            <div key={a.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="font-medium">{a.name} <span className="muted">({a.quantity} owned)</span></div>
              {a.maintenance.length === 0 ? <div className="muted">No entries.</div> : a.maintenance.map((m) => (
                <div key={m.id} className="muted">{fmtDate(m.performedAt)} · {m.description}</div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3 font-semibold">All recent work</div>
        <table className="table">
          <thead><tr><th>Date</th><th>Asset</th><th>Work</th><th>Type</th><th>Hours</th><th>By</th><th className="text-right">Cost</th></tr></thead>
          <tbody>
            {recent.map((m) => (
              <tr key={m.id}>
                <td>{fmtDate(m.performedAt)}</td>
                <td>{m.boat ? <Link className="text-brand hover:underline" href={`/admin/boats/${m.boat.id}`}>{m.boat.name}</Link> : m.addOn?.name}</td>
                <td>{m.description}</td>
                <td>{m.category}</td>
                <td>{m.engineHours ?? ""}</td>
                <td>{m.vendor || m.createdBy}</td>
                <td className="text-right">{m.costCents != null ? fmtMoney(m.costCents) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

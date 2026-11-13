import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { centsToInput, fmtMoney } from "@/lib/money";
import { fmtDateStr, isValidDateStr, localDate, localTime, todayLocal } from "@/lib/time";
import { hours2, periodDates, type PeriodPreset } from "@/lib/crewMath";
import { payrollReport } from "@/lib/payroll";
import { Notice, PageHeader, Pill, Stat } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import { deleteTimeEntry, saveCrewDetails, saveTimeEntry } from "./actions";

export const dynamic = "force-dynamic";

const PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "last_2_weeks", label: "Last 2 weeks" },
  { key: "custom", label: "Custom" },
];
const localInput = (d: Date | null) => (d ? `${localDate(d)}T${localTime(d)}` : "");

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; person?: string; msg?: string; err?: string }>;
}) {
  const s = await requirePermission("payroll");
  const canEditTime = can(s.role, "schedule");
  const sp = await searchParams;
  const preset = (PRESETS.some((p) => p.key === sp.period) ? sp.period : "last_week") as PeriodPreset;
  const { from, to } = periodDates(preset, todayLocal(), {
    from: isValidDateStr(sp.from) ? sp.from : undefined,
    to: isValidDateStr(sp.to) ? sp.to : undefined,
  });
  const report = await payrollReport(from, to);
  const query = new URLSearchParams({ period: preset, from, to, ...(sp.person ? { person: sp.person } : {}) }).toString();

  const person = sp.person && report.rows.some((r) => r.user.id === sp.person) ? sp.person : undefined;
  const [entries, staff] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { clockIn: { gte: report.start, lt: report.end }, ...(person ? { userId: person } : {}) },
      include: { user: true },
      orderBy: [{ clockIn: "asc" }],
    }),
    prisma.adminUser.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  const totals = report.rows.reduce(
    (t, r) => ({
      hours: t.hours + r.regularMinutes + r.overtimeMinutes,
      ot: t.ot + r.overtimeMinutes,
      card: t.card + r.cardTipsCents,
      cash: t.cash + r.cashTipsCents,
      gross: t.gross + r.grossCents,
    }),
    { hours: 0, ot: 0, card: 0, cash: 0, gross: 0 },
  );
  const open = report.rows.reduce((n, r) => n + r.openEntries, 0);
  const missingGusto = report.rows.filter((r) => !r.user.gustoEmployeeId && r.regularMinutes + r.overtimeMinutes + r.cardTipsCents + r.cashTipsCents > 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Hours & tips"
        subtitle={`${fmtDateStr(from)} – ${fmtDateStr(to, { year: "numeric" })}`}
        actions={
          <a href={`/api/admin/payroll/export?from=${from}&to=${to}`} className="btn-primary btn-sm">
            Download CSV for Gusto
          </a>
        }
      />
      <FlashMessage msg={sp.msg} err={sp.err} />

      <form className="card card-pad flex flex-wrap items-end gap-3" method="get">
        <div>
          <label className="label">Pay period</label>
          <select name="period" className="input" defaultValue={preset}>
            {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">From (custom)</label>
          <input type="date" name="from" className="input" defaultValue={from} />
        </div>
        <div>
          <label className="label">To (custom)</label>
          <input type="date" name="to" className="input" defaultValue={to} />
        </div>
        <button className="btn-secondary">Show</button>
      </form>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Total hours" value={hours2(totals.hours)} />
        <Stat label="Overtime hours" value={hours2(totals.ot)} />
        <Stat label="Tips (card / cash)" value={`${fmtMoney(totals.card)} / ${fmtMoney(totals.cash)}`} />
        <Stat label="Est. gross wages" value={fmtMoney(totals.gross)} />
      </div>

      {open > 0 && <Notice tone="warn">{open} time entr{open === 1 ? "y has" : "ies have"} no clock-out. Fix them below before exporting (open entries aren&apos;t counted).</Notice>}
      {missingGusto.length > 0 && (
        <Notice tone="info">Add a Gusto employee ID for {missingGusto.map((r) => r.user.name).join(", ")} below so Gusto matches them for sure (otherwise Gusto matches by name).</Notice>
      )}
      {report.unassigned && (
        <Notice tone="warn">
          {fmtMoney(report.unassigned.totalCents)} in tips has no crew on the trip, so it isn&apos;t in anyone&apos;s pay. Add crew on{" "}
          {report.unassignedBookings.map((id, i) => (
            <span key={id}>{i > 0 && ", "}<Link className="underline" href={`/admin/bookings/${id}`}>this trip</Link></span>
          ))}
          .
        </Notice>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="p-2">Name</th>
              <th className="p-2 text-right">Regular hrs</th>
              <th className="p-2 text-right">Overtime hrs</th>
              <th className="p-2 text-right">Card tips</th>
              <th className="p-2 text-right">Cash tips</th>
              <th className="p-2 text-right">Rate</th>
              <th className="p-2 text-right">Est. gross</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {report.rows.map((r) => (
              <tr key={r.user.id}>
                <td className="p-2">
                  <div className="flex items-center gap-2 font-medium">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.user.color }} />
                    {r.user.name}
                    {r.openEntries > 0 && <Pill tone="amber">missing clock-out</Pill>}
                  </div>
                  <div className="text-xs text-slate-500">{r.user.gustoEmployeeId ? `Gusto ID ${r.user.gustoEmployeeId}` : "No Gusto ID"}</div>
                </td>
                <td className="p-2 text-right">{hours2(r.regularMinutes)}</td>
                <td className={`p-2 text-right ${r.overtimeMinutes ? "font-semibold text-amber-700" : ""}`}>{hours2(r.overtimeMinutes)}</td>
                <td className="p-2 text-right">{fmtMoney(r.cardTipsCents)}</td>
                <td className="p-2 text-right">{fmtMoney(r.cashTipsCents)}</td>
                <td className="p-2 text-right">{r.user.hourlyRateCents ? fmtMoney(r.user.hourlyRateCents) : <span className="text-slate-400">not set</span>}</td>
                <td className="p-2 text-right">{fmtMoney(r.grossCents)}</td>
                <td className="p-2 text-right">
                  <Link href={`/admin/payroll?${new URLSearchParams({ period: preset, from, to, person: r.user.id })}#time`} className="text-xs text-brand underline">
                    Time entries
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted text-xs">
        Overtime is time past 40 hours in a Monday–Sunday week. Each tip is split evenly between the crew on that trip and counts in the
        pay period of the trip (or when it was received, if later). Card tips go on the paycheck; cash tips were already paid and are
        reported for taxes. Estimated gross = regular hours × rate + overtime × 1.5 × rate, for reference only.
      </p>

      <div className="card card-pad text-sm">
        <div className="font-semibold">Using this with Gusto</div>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-slate-600">
          <li>Click <b>Download CSV for Gusto</b>. In Gusto, start the payroll for the same dates, choose <b>Upload CSV</b> (Import), and upload the file. Hours go to Regular/Overtime, card tips to Paycheck tips, cash tips to Cash tips.</li>
          <li>Check the numbers in Gusto before you submit. If Gusto rejects a column name, download Gusto&apos;s blank template from that screen and copy the columns over.</li>
        </ol>
        <p className="muted mt-2 text-xs">Later: sending hours straight to Gusto (no file) needs a Gusto developer app, which Gusto must review and approve first.</p>
      </div>

      <section id="time" className="card card-pad space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="h2">Time entries {person ? `· ${report.rows.find((r) => r.user.id === person)?.user.name}` : ""}</h2>
          {person && <Link href={`/admin/payroll?${new URLSearchParams({ period: preset, from, to })}#time`} className="text-sm text-brand underline">Show everyone</Link>}
        </div>
        {!canEditTime && <p className="muted text-xs">Only an owner or manager can change time entries.</p>}
        {entries.length === 0 && <p className="muted">No time entries in this period.</p>}
        <div className="space-y-2">
          {entries.map((e) => (
            <form key={e.id} action={saveTimeEntry} className={`grid grid-cols-2 items-end gap-2 rounded-lg p-2 md:grid-cols-12 ${e.clockOut ? "bg-slate-50" : "bg-amber-50"}`}>
              <input type="hidden" name="id" value={e.id} />
              <input type="hidden" name="query" value={query} />
              <div className="col-span-2 text-sm font-medium md:col-span-2">
                {e.user.name}
                {e.editedBy && <div className="text-xs font-normal text-slate-500">edited by {e.editedBy}</div>}
              </div>
              <div className="md:col-span-3">
                <label className="label text-xs">Clock in</label>
                <input type="datetime-local" name="clockIn" className="input" defaultValue={localInput(e.clockIn)} disabled={!canEditTime} required />
              </div>
              <div className="md:col-span-3">
                <label className="label text-xs">Clock out {!e.clockOut && <span className="text-amber-700">(missing)</span>}</label>
                <input type="datetime-local" name="clockOut" className="input" defaultValue={localInput(e.clockOut)} disabled={!canEditTime} />
              </div>
              <div className="col-span-2 md:col-span-2">
                <label className="label text-xs">Notes</label>
                <input name="notes" className="input" defaultValue={e.notes} disabled={!canEditTime} />
              </div>
              {canEditTime && (
                <div className="col-span-2 flex gap-2 md:col-span-2">
                  <button className="btn-secondary btn-sm">Save</button>
                  <button formAction={deleteTimeEntry} className="btn-secondary btn-sm text-rose-700">Delete</button>
                </div>
              )}
            </form>
          ))}
        </div>
        {canEditTime && (
          <form action={saveTimeEntry} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-dashed border-slate-300 p-2 md:grid-cols-12">
            <input type="hidden" name="query" value={query} />
            <div className="col-span-2 md:col-span-2">
              <label className="label text-xs">Add entry for</label>
              <select name="userId" className="input" defaultValue={person ?? ""} required>
                <option value="" disabled>Pick…</option>
                {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="label text-xs">Clock in</label>
              <input type="datetime-local" name="clockIn" className="input" defaultValue={`${from}T08:00`} required />
            </div>
            <div className="md:col-span-3">
              <label className="label text-xs">Clock out</label>
              <input type="datetime-local" name="clockOut" className="input" defaultValue={`${from}T16:00`} />
            </div>
            <div className="col-span-2 md:col-span-2">
              <label className="label text-xs">Notes</label>
              <input name="notes" className="input" placeholder="e.g. forgot to clock in" />
            </div>
            <div className="col-span-2 md:col-span-2"><button className="btn-primary btn-sm">Add entry</button></div>
          </form>
        )}
      </section>

      <section className="card card-pad space-y-3">
        <h2 className="h2">Crew details</h2>
        <p className="muted text-xs">Phone is used to text schedules. Find the Gusto employee ID in Gusto under People → the person&apos;s profile.</p>
        {staff.map((u) => (
          <form key={u.id} action={saveCrewDetails} className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
            <input type="hidden" name="userId" value={u.id} />
            <input type="hidden" name="query" value={query} />
            <div className="col-span-2 text-sm md:col-span-3">
              <div className="font-medium">{u.name}</div>
              <div className="text-xs text-slate-500">{ROLE_LABELS[u.role] ?? u.role} · {u.email}</div>
            </div>
            <div className="md:col-span-2">
              <label className="label text-xs">Phone</label>
              <input name="phone" type="tel" className="input" defaultValue={u.phone} />
            </div>
            <div className="md:col-span-2">
              <label className="label text-xs">Hourly rate ($)</label>
              <input name="hourlyRate" inputMode="decimal" className="input" defaultValue={centsToInput(u.hourlyRateCents)} />
            </div>
            <div className="md:col-span-2">
              <label className="label text-xs">Gusto employee ID</label>
              <input name="gustoEmployeeId" className="input" defaultValue={u.gustoEmployeeId ?? ""} />
            </div>
            <div className="md:col-span-1">
              <label className="label text-xs">Color</label>
              <input name="color" type="color" className="h-9 w-full rounded border border-slate-300" defaultValue={u.color} />
            </div>
            <div className="md:col-span-2"><button className="btn-secondary btn-sm">Save</button></div>
          </form>
        ))}
      </section>
    </div>
  );
}

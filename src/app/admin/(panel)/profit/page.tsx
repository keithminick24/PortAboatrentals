import Link from "next/link";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { COST_LABELS } from "@/lib/constants";
import { fmtMoney } from "@/lib/money";
import { addDays, fmtDate, isValidDateStr, todayLocal } from "@/lib/time";
import { addMonths, daysInMonth, loadProfit, rollup, totals, type Breakeven } from "@/lib/profit";
import { Empty, Notice, PageHeader, Pill, Stat } from "@/components/ui";

type SP = { from?: string; to?: string };

const pct = (x: number | null) => (x == null ? "–" : `${(x * 100).toFixed(1)}%`);

export default async function ProfitPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const s = await getSession();
  if (!can(s?.role, "reports")) return <Notice tone="warn">You don&apos;t have access to reports.</Notice>;

  const today = todayLocal();
  const thisMonth = today.slice(0, 7);
  let from = isValidDateStr(sp.from) ? sp.from : `${thisMonth}-01`;
  let to = isValidDateStr(sp.to) ? sp.to : `${thisMonth}-${daysInMonth(thisMonth)}`;
  if (to < from) [from, to] = [to, from];
  if (addDays(from, 731) < to) to = addDays(from, 731); // keep it to ~2 years

  const { boats, months, result, inRange, breakevens } = await loadProfit(from, to);
  const boatName = new Map(boats.map((b) => [b.id, b.name]));
  const sum = totals(inRange);
  const byBoat = rollup(inRange, (r) => r.boatId);
  const showBoats = boats.filter((b) => b.status !== "retired" || byBoat.some((r) => r.key === b.id));
  const beMonth = months.includes(thisMonth) ? thisMonth : months[months.length - 1];
  const beFor = (boatId: string) => breakevens.find((b) => b.boatId === boatId && b.month === beMonth);
  const boatMonths = result.boatMonths.filter((bm) => months.includes(bm.month) && (bm.trips > 0 || Object.keys(bm.categories).length > 0));
  const unallocated = boatMonths.reduce((s2, bm) => s2 + bm.unallocatedCents, 0);
  const partialMonths = from.slice(8) !== "01" || to !== `${to.slice(0, 7)}-${daysInMonth(to.slice(0, 7))}`;

  const presets: [string, string, string][] = [
    ["This month", `${thisMonth}-01`, `${thisMonth}-${daysInMonth(thisMonth)}`],
    ["Last month", `${addMonths(thisMonth, -1)}-01`, `${addMonths(thisMonth, -1)}-${daysInMonth(addMonths(thisMonth, -1))}`],
    ["Year to date", `${today.slice(0, 4)}-01-01`, today],
    ["Last 12 months", `${addMonths(thisMonth, -11)}-01`, `${thisMonth}-${daysInMonth(thisMonth)}`],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profit & breakeven"
        subtitle="Gross profit per trip and per boat: what each trip brought in minus what it cost to run."
        actions={
          <>
            <Link href="/admin/profit/assumptions" className="btn-secondary">Cost assumptions</Link>
            <Link href="/admin/budget" className="btn-secondary">Budget & forecast</Link>
          </>
        }
      />

      <div className="card card-pad flex flex-wrap items-end gap-3">
        <form className="flex flex-wrap items-end gap-2">
          <div><label className="label">From</label><input type="date" name="from" defaultValue={from} className="input" /></div>
          <div><label className="label">To</label><input type="date" name="to" defaultValue={to} className="input" /></div>
          <button className="btn-secondary">Show</button>
        </form>
        <div className="flex flex-wrap gap-2 text-sm">
          {presets.map(([label, f, t]) => (
            <Link key={label} href={`?from=${f}&to=${t}`} className={`badge ${f === from && t === to ? "border-brand bg-brand text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{label}</Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={`Revenue (${sum.trips} trips)`} value={fmtMoney(sum.revenueCents)} />
        <Stat label="Trip costs (COGS)" value={fmtMoney(sum.cogsCents)} />
        <Stat label="Gross profit" value={<span className={sum.grossCents < 0 ? "text-rose-700" : ""}>{fmtMoney(sum.grossCents)}</span>} />
        <Stat label="Gross margin" value={pct(sum.margin)} />
      </div>
      <p className="muted -mt-3 text-xs">
        Includes upcoming trips already booked in this range. Revenue = boat rental + add-ons + fees + convenience fee + damage captured − refunds. Sales tax and tips are left out (tips go to the crew).
        {partialMonths && " Monthly costs are spread over each whole month's trips, so a partial month only shows its share."}
        {unallocated > 0 && ` ${fmtMoney(unallocated)} of monthly costs fell in months/boats with no trips, so no trip carries them (they still count toward breakeven).`}
      </p>

      {/* ---------------------------------------------- by boat */}
      <div className="card card-pad space-y-3">
        <h2 className="h2">By boat</h2>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Boat</th><th className="text-right">Trips</th><th className="text-right">Revenue</th><th className="text-right">COGS</th>
                <th className="text-right">Gross profit</th><th className="text-right">GP %</th><th className="min-w-[220px]">Breakeven · {monthLabel(beMonth)}</th>
              </tr>
            </thead>
            <tbody>
              {showBoats.map((b) => {
                const r = byBoat.find((x) => x.key === b.id);
                return (
                  <tr key={b.id}>
                    <td className="font-medium">{b.name}</td>
                    <td className="text-right">{r?.trips ?? 0}</td>
                    <td className="text-right tabular-nums">{fmtMoney(r?.revenueCents ?? 0)}</td>
                    <td className="text-right tabular-nums">{fmtMoney(r?.cogsCents ?? 0)}</td>
                    <td className={`text-right tabular-nums ${(r?.grossCents ?? 0) < 0 ? "text-rose-700" : ""}`}>{fmtMoney(r?.grossCents ?? 0)}</td>
                    <td className="text-right">{pct(r?.margin ?? null)}</td>
                    <td><BreakevenBar be={beFor(b.id)} /></td>
                  </tr>
                );
              })}
              <tr className="font-semibold">
                <td>Total</td><td className="text-right">{sum.trips}</td><td className="text-right">{fmtMoney(sum.revenueCents)}</td>
                <td className="text-right">{fmtMoney(sum.cogsCents)}</td><td className="text-right">{fmtMoney(sum.grossCents)}</td><td className="text-right">{pct(sum.margin)}</td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted text-xs">
          <b>Breakeven</b> = fixed monthly costs (slip, insurance, boat payment…) ÷ average contribution per trip (revenue minus trip-by-trip costs like fuel and cleaning). The bar shows trips done (solid) and trips on the books (light).
        </p>
      </div>

      {/* ---------------------------------------------- breakeven detail */}
      {months.length > 1 && (
        <details className="card card-pad">
          <summary className="cursor-pointer font-semibold">Breakeven by month</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="table">
              <thead><tr><th>Month</th><th>Boat</th><th className="text-right">Fixed costs</th><th className="text-right">Avg contribution</th><th className="text-right">Trips needed</th><th className="text-right">Done</th><th className="text-right">On the books</th><th>Status</th></tr></thead>
              <tbody>
                {breakevens.filter((b) => months.includes(b.month) && (b.fixedCents > 0 || b.tripsDone + b.tripsBooked > 0)).map((b) => (
                  <tr key={b.boatId + b.month}>
                    <td>{monthLabel(b.month)}</td><td>{boatName.get(b.boatId)}</td>
                    <td className="text-right">{fmtMoney(b.fixedCents)}</td>
                    <td className="text-right">{b.avgContributionCents == null ? "–" : fmtMoney(b.avgContributionCents)}</td>
                    <td className="text-right">{b.tripsNeeded ?? "–"}</td><td className="text-right">{b.tripsDone}</td><td className="text-right">{b.tripsBooked}</td>
                    <td className="min-w-[180px]"><BreakevenBar be={b} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* ---------------------------------------------- where costs come from */}
      <div className="card card-pad space-y-3">
        <h2 className="h2">Where the costs come from</h2>
        <p className="muted">
          For each boat and month, a cost type uses <Pill tone="green">Using actual Xero expenses</Pill> when real expenses of that type are recorded for that boat (or the whole fleet) that month. Otherwise it uses <Pill tone="slate">Using estimate</Pill> from your{" "}
          <Link href="/admin/profit/assumptions" className="text-brand hover:underline">cost assumptions</Link>. Real totals are spread over the boat&apos;s trips that month by trip hours (engine hours for fuel); fleet-wide expenses are split across boats by trip hours.
        </p>
        {boatMonths.length === 0 ? (
          <Empty>No costs set up yet. Add cost assumptions or sync expenses from Xero.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Month</th><th>Boat</th><th>Cost types</th></tr></thead>
              <tbody>
                {boatMonths.map((bm) => (
                  <tr key={bm.boatId + bm.month}>
                    <td className="whitespace-nowrap">{monthLabel(bm.month)}</td>
                    <td className="whitespace-nowrap">{boatName.get(bm.boatId)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(bm.categories).map(([cat, c]) => (
                          <Pill key={cat} tone={c.source === "actual" ? "green" : "slate"}>
                            {COST_LABELS[cat] ?? cat}: {fmtMoney(c.cents)} · {c.source === "actual" ? "actual" : "estimate"}
                          </Pill>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------------------------------------------- per booking */}
      <div className="card card-pad space-y-3">
        <h2 className="h2">Per trip</h2>
        {inRange.length === 0 ? (
          <Empty>No trips in this range.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Date</th><th>Boat</th><th>Guest</th><th className="text-right">Revenue</th><th className="text-right">COGS</th><th className="text-right">Gross profit</th><th className="text-right">Margin</th><th>Costs</th></tr></thead>
              <tbody>
                {inRange.slice(0, 400).map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap"><Link href={`/admin/bookings/${r.id}`} className="text-brand hover:underline">{fmtDate(r.booking.startsAt)}</Link></td>
                    <td className="whitespace-nowrap">{boatName.get(r.boatId)}</td>
                    <td>{r.booking.customer.firstName} {r.booking.customer.lastName}</td>
                    <td className="text-right tabular-nums">{fmtMoney(r.revenueCents)}</td>
                    <td className="text-right tabular-nums">{fmtMoney(r.cogsCents)}</td>
                    <td className={`text-right tabular-nums ${r.grossCents < 0 ? "text-rose-700" : ""}`}>{fmtMoney(r.grossCents)}</td>
                    <td className="text-right">{pct(r.margin)}</td>
                    <td>
                      <details>
                        <summary className="cursor-pointer text-xs text-brand">Show</summary>
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {Object.entries(r.cogs).length === 0 && <li className="muted">No costs set up</li>}
                          {Object.entries(r.cogs).sort((a, b) => b[1] - a[1]).map(([cat, cents]) => (
                            <li key={cat} className="flex justify-between gap-3">
                              <span>{COST_LABELS[cat] ?? cat} <span className={r.sources[cat] === "actual" ? "text-emerald-700" : "text-slate-400"}>({r.sources[cat] === "actual" ? "actual" : "estimate"})</span></span>
                              <span className="tabular-nums">{fmtMoney(cents)}</span>
                            </li>
                          ))}
                          <li className="muted pt-1">{r.hours.toFixed(1)} hrs · {r.booking.status.replace("_", " ")}</li>
                        </ul>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {inRange.length > 400 && <p className="muted mt-2 text-xs">Showing the first 400 trips. Totals above include all {inRange.length}.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function BreakevenBar({ be }: { be?: Breakeven }) {
  if (!be) return <span className="muted text-xs">–</span>;
  if (be.tripsNeeded == null) return <span className="text-xs text-amber-800">Trips don&apos;t cover their own costs yet</span>;
  if (be.tripsNeeded === 0) return <span className="text-xs text-slate-500">No fixed costs set</span>;
  const done = Math.min(1, be.pctDone ?? 0);
  const booked = Math.min(1, be.pctWithBooked ?? 0);
  const reached = (be.pctDone ?? 0) >= 1;
  return (
    <div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="absolute inset-y-0 left-0 bg-sky-200" style={{ width: `${booked * 100}%` }} />
        <div className={`absolute inset-y-0 left-0 ${reached ? "bg-emerald-500" : "bg-sky-600"}`} style={{ width: `${done * 100}%` }} />
      </div>
      <div className="mt-1 text-xs text-slate-600">
        {reached ? "Broke even · " : ""}
        {be.tripsDone} done + {be.tripsBooked} booked of {be.tripsNeeded} needed ({Math.round((be.pctWithBooked ?? 0) * 100)}%)
      </div>
    </div>
  );
}

function monthLabel(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, mo - 1, 1)));
}

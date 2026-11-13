import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { centsToInput, fmtMoney } from "@/lib/money";
import { todayLocal, zonedToUtc } from "@/lib/time";
import { addMonths, bookingRevenue, forecastMonths, monthKey, PICKUP_WINDOW_DAYS, type Forecast } from "@/lib/profit";
import { Notice, PageHeader, Stat } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import { saveBudget } from "./actions";

type SP = { msg?: string; err?: string; year?: string; boat?: string };

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");
const dollars = (c: number) => fmtMoney(c).replace(/\.00$/, "");

export default async function BudgetPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const s = await getSession();
  if (!can(s?.role, "reports")) return <Notice tone="warn">You don&apos;t have access to reports.</Notice>;
  const canEdit = can(s?.role, "accounting");

  const today = todayLocal();
  const thisMonth = today.slice(0, 7);
  const year = /^\d{4}$/.test(sp.year ?? "") ? sp.year! : today.slice(0, 4);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const forecastStart = thisMonth;
  const forecastList = [forecastStart, addMonths(forecastStart, 1), addMonths(forecastStart, 2)];

  const boats = await prisma.boat.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, status: true } });
  const boatId = boats.some((b) => b.id === sp.boat) ? sp.boat! : null;
  const boatName = boatId ? boats.find((b) => b.id === boatId)!.name : "Whole business";

  const yearStart = zonedToUtc(`${year}-01-01`, "00:00");
  const yearEnd = zonedToUtc(`${Number(year) + 1}-01-01`, "00:00");
  const [budgets, forecastBudgets, bookings, expenses, forecasts] = await Promise.all([
    prisma.budget.findMany({ where: { month: { in: months }, boatId } }),
    prisma.budget.findMany({ where: { month: { in: forecastList }, boatId } }),
    prisma.booking.findMany({
      where: { startsAt: { gte: yearStart, lt: yearEnd }, status: { not: "cancelled" }, ...(boatId ? { boatId } : {}) },
      select: { startsAt: true, subtotalCents: true, addOnsCents: true, feesCents: true, convenienceFeeCents: true, depositCapturedCents: true, refundedCents: true },
    }),
    prisma.expense.findMany({ where: { date: { gte: yearStart, lt: yearEnd }, ...(boatId ? { boatId } : {}) }, select: { date: true, amountCents: true } }),
    forecastMonths(forecastStart, 3, { boatId: boatId ?? undefined, today }),
  ]);

  const goal = (m: string) => budgets.find((b) => b.month === m) ?? forecastBudgets.find((b) => b.month === m);
  const actual = new Map<string, { revenue: number; trips: number; expenses: number }>(months.map((m) => [m, { revenue: 0, trips: 0, expenses: 0 }]));
  for (const b of bookings) {
    const a = actual.get(monthKey(b.startsAt));
    if (a) {
      a.revenue += bookingRevenue(b);
      a.trips++;
    }
  }
  for (const e of expenses) {
    const a = actual.get(monthKey(e.date));
    if (a) a.expenses += e.amountCents;
  }
  const fc = new Map<string, Forecast>(forecasts.map((f) => [f.month, f]));

  // Year to date (months before this one + this month's actual to date)
  const ytdMonths = months.filter((m) => m <= thisMonth);
  const ytdGoal = ytdMonths.reduce((sum, m) => sum + (goal(m)?.revenueGoalCents ?? 0), 0);
  const ytdActual = ytdMonths.reduce((sum, m) => sum + (m === thisMonth ? fc.get(m)?.actualCents ?? 0 : actual.get(m)!.revenue), 0);
  const yearGoal = months.reduce((sum, m) => sum + (goal(m)?.revenueGoalCents ?? 0), 0);

  const cur = fc.get(thisMonth)!;
  const curGoal = goal(thisMonth)?.revenueGoalCents ?? 0;
  const summary = curGoal
    ? `On pace for ${dollars(cur.totalCents)} vs goal ${dollars(curGoal)} (${pct(cur.totalCents, curGoal)}).`
    : `On pace for ${dollars(cur.totalCents)} this month. Set a revenue goal below to compare.`;
  const tone = !curGoal ? "info" : cur.totalCents >= curGoal ? "success" : cur.totalCents >= curGoal * 0.9 ? "warn" : "error";

  // Bars: past months = actual, this month and later = forecast if we have one, else booked so far.
  const barValue = (m: string) => (fc.has(m) ? fc.get(m)!.totalCents : actual.get(m)?.revenue ?? 0);
  const barMax = Math.max(1, ...months.map((m) => Math.max(barValue(m), goal(m)?.revenueGoalCents ?? 0)));

  const qs = (y: string, b: string | null) => `?year=${y}${b ? `&boat=${b}` : ""}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget & forecast"
        subtitle="Set monthly goals, see how you're tracking, and where this month is headed."
        actions={
          <>
            <Link href={qs(String(Number(year) - 1), boatId)} className="btn-secondary">← {Number(year) - 1}</Link>
            <Link href={qs(String(Number(year) + 1), boatId)} className="btn-secondary">{Number(year) + 1} →</Link>
            <Link href="/admin/profit" className="btn-secondary">Profit & breakeven</Link>
          </>
        }
      />
      <FlashMessage msg={sp.msg} err={sp.err} />

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={qs(year, null)} className={`badge ${!boatId ? "border-brand bg-brand text-white" : "border-slate-200 bg-white text-slate-700"}`}>Whole business</Link>
        {boats.filter((b) => b.status !== "retired" || b.id === boatId).map((b) => (
          <Link key={b.id} href={qs(year, b.id)} className={`badge ${boatId === b.id ? "border-brand bg-brand text-white" : "border-slate-200 bg-white text-slate-700"}`}>{b.name}</Link>
        ))}
      </div>

      <Notice tone={tone}>
        <b>How we&apos;re doing ({boatName}, {monthLabel(thisMonth, "long")}):</b> {summary}{" "}
        <span className="opacity-80">
          {dollars(cur.actualCents)} done, {dollars(cur.bookedCents)} booked for the rest of the month, and about {dollars(cur.projectedCents)} more expected.
        </span>
      </Notice>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={`${year} revenue goal`} value={dollars(yearGoal)} />
        <Stat label="Year to date" value={dollars(ytdActual)} />
        <Stat label="YTD goal" value={dollars(ytdGoal)} />
        <Stat label="YTD vs goal" value={<span className={ytdActual - ytdGoal < 0 ? "text-rose-700" : "text-emerald-700"}>{ytdGoal ? `${ytdActual - ytdGoal < 0 ? "−" : "+"}${dollars(Math.abs(ytdActual - ytdGoal))}` : "–"}</span>} />
      </div>

      {/* ---------------------------------------------- forecast */}
      <div className="card card-pad space-y-3">
        <h2 className="h2">Forecast: next 3 months</h2>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Month</th><th className="text-right">Done</th><th className="text-right">Booked</th><th className="text-right">Expected more</th><th className="text-right">Forecast</th><th className="text-right">Goal</th><th className="text-right">% of goal</th><th className="text-right">Variance</th></tr></thead>
            <tbody>
              {forecasts.map((f) => {
                const g = goal(f.month)?.revenueGoalCents ?? 0;
                return (
                  <tr key={f.month}>
                    <td>{monthLabel(f.month, "long")}</td>
                    <td className="text-right">{dollars(f.actualCents)}</td>
                    <td className="text-right">{dollars(f.bookedCents)}</td>
                    <td className="text-right" title={`${dollars(f.dailyPickupCents)}/day × ${f.daysLeft} days`}>{dollars(f.projectedCents)}</td>
                    <td className="text-right font-semibold">{dollars(f.totalCents)}</td>
                    <td className="text-right">{g ? dollars(g) : "–"}</td>
                    <td className="text-right">{pct(f.totalCents, g)}</td>
                    <td className={`text-right ${g && f.totalCents < g ? "text-rose-700" : "text-emerald-700"}`}>{g ? `${f.totalCents < g ? "−" : "+"}${dollars(Math.abs(f.totalCents - g))}` : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted text-xs">
          <b>How the forecast works:</b> revenue from trips already taken this month + trips already booked + an estimate of bookings still to come.
          That estimate is the average dollars per day of new bookings made for that month over the last {PICKUP_WINDOW_DAYS} days, times the days left until the month ends.
          It assumes the next few weeks sell like the last four. Far-off months usually pick up faster as they get closer, so treat those as a floor.
        </p>
      </div>

      {/* ---------------------------------------------- bars */}
      <div className="card card-pad space-y-3">
        <h2 className="h2">{year} revenue vs goal</h2>
        <div className="flex h-48 items-end gap-2">
          {months.map((m) => {
            const v = barValue(m);
            const g = goal(m)?.revenueGoalCents ?? 0;
            const isForecast = fc.has(m);
            return (
              <div key={m} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${monthLabel(m, "long")}: ${dollars(v)}${isForecast ? " forecast" : ""}${g ? ` · goal ${dollars(g)}` : ""}`}>
                <div className="relative w-full flex-1">
                  <div
                    className={`absolute bottom-0 left-1/2 w-3/5 -translate-x-1/2 rounded-t ${isForecast ? "bg-sky-300" : g && v >= g ? "bg-emerald-500" : "bg-sky-600"}`}
                    style={{ height: `${(v / barMax) * 100}%` }}
                  />
                  {g > 0 && <div className="absolute left-0 right-0 border-t-2 border-dashed border-slate-700" style={{ bottom: `${(g / barMax) * 100}%` }} />}
                </div>
                <div className="text-[10px] text-slate-500">{monthLabel(m, "short").slice(0, 3)}</div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-slate-600">
          <span><span className="mr-1 inline-block h-2 w-3 bg-sky-600" />Actual</span>
          <span><span className="mr-1 inline-block h-2 w-3 bg-emerald-500" />Hit goal</span>
          <span><span className="mr-1 inline-block h-2 w-3 bg-sky-300" />Forecast</span>
          <span><span className="mr-1 inline-block w-4 border-t-2 border-dashed border-slate-700 align-middle" />Goal</span>
        </div>
      </div>

      {/* ---------------------------------------------- grid */}
      <form action={saveBudget} className="card card-pad space-y-3">
        <input type="hidden" name="year" value={year} />
        <input type="hidden" name="boatId" value={boatId ?? ""} />
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="h2 flex-1">{year} goals · {boatName}</h2>
          {canEdit && <button className="btn-primary btn-sm">Save goals</button>}
        </div>
        {!canEdit && <p className="muted text-xs">Only Admin and Accounting logins can change goals.</p>}
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Month</th><th>Revenue goal</th><th className="text-right">Actual</th><th className="text-right">%</th><th className="text-right">Variance</th>
                <th>Trips goal</th><th className="text-right">Trips</th><th>Expense budget</th><th className="text-right">Spent</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const g = goal(m);
                const a = actual.get(m)!;
                const future = m > thisMonth;
                const rg = g?.revenueGoalCents ?? 0;
                const variance = a.revenue - rg;
                return (
                  <tr key={m} className={m === thisMonth ? "bg-sky-50/50" : ""}>
                    <td className="whitespace-nowrap font-medium">
                      <input type="hidden" name="month" value={m} />
                      {monthLabel(m, "short")}{m === thisMonth && <span className="muted"> (now)</span>}
                    </td>
                    <td><input name={`rev_${m}`} className="input w-28" defaultValue={rg ? centsToInput(rg) : ""} placeholder="$" disabled={!canEdit} /></td>
                    <td className="text-right tabular-nums">{dollars(a.revenue)}{future && a.revenue > 0 && <div className="muted text-[10px]">booked</div>}</td>
                    <td className="text-right">{pct(a.revenue, rg)}</td>
                    <td className={`text-right tabular-nums ${rg ? (variance < 0 ? "text-rose-700" : "text-emerald-700") : ""}`}>{rg && !future ? `${variance < 0 ? "−" : "+"}${dollars(Math.abs(variance))}` : "–"}</td>
                    <td><input name={`trips_${m}`} type="number" min="0" className="input w-20" defaultValue={g?.tripsGoal || ""} disabled={!canEdit} /></td>
                    <td className="text-right">{a.trips}{g?.tripsGoal ? <span className="muted"> / {g.tripsGoal}</span> : null}</td>
                    <td><input name={`exp_${m}`} className="input w-28" defaultValue={g?.expenseBudgetCents ? centsToInput(g.expenseBudgetCents) : ""} placeholder="$" disabled={!canEdit} /></td>
                    <td className={`text-right tabular-nums ${g?.expenseBudgetCents && a.expenses > g.expenseBudgetCents ? "text-rose-700" : ""}`}>{dollars(a.expenses)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted text-xs">
          Actual revenue counts trips in that month (rental, add-ons, fees, damage captured, minus refunds; no tax or tips). Future months show what&apos;s booked so far.
          Spent = expenses recorded {boatId ? "for this boat" : "for the business"} (from Xero, CSV, or typed in).
        </p>
        {canEdit && <button className="btn-primary btn-sm">Save goals</button>}
      </form>
    </div>
  );
}

function monthLabel(m: string, style: "long" | "short") {
  const [y, mo] = m.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: style, year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, mo - 1, 1)));
}

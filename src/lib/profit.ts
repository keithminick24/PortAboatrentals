/**
 * Profitability down to gross profit, breakeven, and revenue forecast.
 *
 * Xero stays the books. This file only turns bookings + cost assumptions
 * (BoatCost) + categorized expenses (Expense, mostly pulled from Xero) into
 * per-trip gross profit.
 *
 * Rules (also explained on /admin/profit):
 *  - Revenue per trip = rental (subtotal, which includes "included" fees like fuel)
 *    + add-ons + added fees + convenience fee + deposit captured − refunds.
 *    Sales tax and tips are NOT revenue (tax goes to the state, tips go to crew).
 *  - Cost of goods sold (COGS) per trip comes from the cost assumptions:
 *      per_trip         flat $ per trip
 *      per_trip_hour    $ × scheduled trip hours
 *      per_engine_hour  $ × engine hours run (in − out), falls back to scheduled hours
 *      percent_revenue  % of the trip's revenue (e.g. card fees 2.9%)
 *      monthly          a monthly bill, spread over that boat's trips that month by trip hours
 *    Fleet-wide rows (no boat): monthly amounts are split evenly across boats
 *    that aren't retired; per-trip / per-hour / percent rows apply to every trip.
 *  - ACTUALS WIN: if there are real expenses for a boat + month + COGS category
 *    (from Xero, CSV or typed in), that real total replaces the estimate for
 *    that category. It is spread over the boat's trips that month by trip hours
 *    (engine hours for fuel when recorded). Fleet-wide expenses (no boat) are
 *    split across boats by their trip hours that month.
 *  - Fixed vs variable (for breakeven): monthly assumptions are fixed; the rest
 *    are variable. A category on actuals is fixed when all of its assumption
 *    rows are monthly (or, with no rows, when it's lift/insurance/loan/depreciation).
 */
import { COST_CATEGORIES } from "./constants";
import { addDays, localDate } from "./time";

// ---------------------------------------------------------------- types

export type ProfitBookingInput = {
  id: string;
  boatId: string;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
  subtotalCents: number;
  addOnsCents: number;
  feesCents: number;
  convenienceFeeCents: number;
  depositCapturedCents: number;
  refundedCents: number;
  engineHoursOut: number | null;
  engineHoursIn: number | null;
};

export type CostInput = {
  id?: string;
  boatId: string | null;
  name: string;
  category: string;
  basis: string; // monthly | per_trip | per_engine_hour | per_trip_hour | percent_revenue
  amountCents: number;
  percentBps: number;
  active?: boolean;
};

export type ExpenseInput = { date: Date; amountCents: number; category: string; boatId: string | null };
export type BoatInput = { id: string; name: string; status: string };

export type CostSource = "actual" | "estimate";

export type BookingProfit = {
  id: string;
  boatId: string;
  month: string;
  revenueCents: number;
  hours: number;
  cogs: Record<string, number>;
  cogsCents: number;
  /** Part of COGS that is a fixed monthly cost spread onto this trip */
  fixedCents: number;
  variableCents: number;
  grossCents: number;
  /** gross / revenue, or null when revenue is 0 */
  margin: number | null;
  /** Contribution = revenue − variable costs (used for breakeven) */
  contributionCents: number;
  sources: Record<string, CostSource>;
};

export type BoatMonth = {
  boatId: string;
  month: string;
  trips: number;
  hours: number;
  revenueCents: number;
  cogsCents: number;
  grossCents: number;
  /** Fixed monthly costs for the boat this month (estimate or actual) */
  fixedCents: number;
  /** Costs for the month that couldn't land on a trip (no trips that month) */
  unallocatedCents: number;
  categories: Record<string, { source: CostSource; cents: number }>;
};

export const BASIS_LABELS: Record<string, string> = {
  monthly: "Per month",
  per_trip: "Per trip",
  per_trip_hour: "Per trip hour",
  per_engine_hour: "Per engine hour",
  percent_revenue: "% of trip revenue",
};

export const COGS_KEYS = new Set<string>(COST_CATEGORIES.filter((c) => c.cogs).map((c) => c.key));
/** Categories treated as fixed when they're on actuals and have no assumption rows. */
export const DEFAULT_FIXED_CATEGORIES = new Set(["boat_lift", "insurance", "boat_payment", "depreciation"]);

// ---------------------------------------------------------------- small helpers

export function bookingRevenue(b: Pick<ProfitBookingInput, "subtotalCents" | "addOnsCents" | "feesCents" | "convenienceFeeCents" | "depositCapturedCents" | "refundedCents">): number {
  return b.subtotalCents + b.addOnsCents + b.feesCents + b.convenienceFeeCents + b.depositCapturedCents - b.refundedCents;
}

export function scheduledHours(b: Pick<ProfitBookingInput, "startsAt" | "endsAt">): number {
  return Math.max(0, (b.endsAt.getTime() - b.startsAt.getTime()) / 3_600_000);
}

/** Engine hours run on the trip, or scheduled hours when not recorded. */
export function runHours(b: Pick<ProfitBookingInput, "startsAt" | "endsAt" | "engineHoursOut" | "engineHoursIn">): number {
  if (b.engineHoursOut != null && b.engineHoursIn != null && b.engineHoursIn > b.engineHoursOut) {
    return b.engineHoursIn - b.engineHoursOut;
  }
  return scheduledHours(b);
}

/** Local (business TZ) "YYYY-MM" for an instant. */
export function monthKey(d: Date): string {
  return localDate(d).slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Months ("YYYY-MM") touched by a local date range, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m, 1)) out.push(m);
  return out;
}

/**
 * Split `total` cents across `weights` so the parts are whole cents and add up
 * exactly to `total` (largest remainder). All-zero weights split evenly.
 */
export function allocate(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  let w = weights.map((x) => (x > 0 && Number.isFinite(x) ? x : 0));
  let sum = w.reduce((s, x) => s + x, 0);
  if (sum === 0) {
    w = weights.map(() => 1);
    sum = w.length;
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = w.map((x) => (abs * x) / sum);
  const parts = raw.map((x) => Math.floor(x));
  let left = abs - parts.reduce((s, x) => s + x, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) parts[order[k][1]]++;
  return parts.map((p) => p * sign);
}

/** Variable (non-monthly) cost of one row for one trip. */
export function variableCost(row: CostInput, trip: { revenueCents: number; hours: number; runHours: number }): number {
  switch (row.basis) {
    case "per_trip":
      return row.amountCents;
    case "per_trip_hour":
      return Math.round(row.amountCents * trip.hours);
    case "per_engine_hour":
      return Math.round(row.amountCents * trip.runHours);
    case "percent_revenue":
      return Math.round((Math.max(0, trip.revenueCents) * row.percentBps) / 10_000);
    default:
      return 0;
  }
}

// ---------------------------------------------------------------- main calculation

export type ProfitInput = {
  boats: BoatInput[];
  bookings: ProfitBookingInput[];
  costs: CostInput[];
  expenses: ExpenseInput[];
  /** Extra months to compute (e.g. the current month with no trips yet) */
  months?: string[];
};

export type ProfitResult = { bookings: BookingProfit[]; boatMonths: BoatMonth[] };

export function computeProfit(input: ProfitInput): ProfitResult {
  const costs = input.costs.filter((c) => c.active !== false);
  const activeBoats = input.boats.filter((b) => b.status !== "retired");
  const activeIds = new Set(activeBoats.map((b) => b.id));
  const nActive = activeBoats.length || 1;

  // Per-trip basics
  const trips = input.bookings.map((b) => ({
    b,
    month: monthKey(b.startsAt),
    revenueCents: bookingRevenue(b),
    hours: scheduledHours(b),
    runHours: runHours(b),
  }));

  // Months to look at
  const months = new Set<string>(input.months ?? []);
  for (const t of trips) months.add(t.month);
  for (const e of input.expenses) months.add(monthKey(e.date));

  // Boats to look at: every boat that exists (retired ones only matter if they have trips)
  const boatIds = new Set<string>(activeBoats.map((b) => b.id));
  for (const t of trips) boatIds.add(t.b.boatId);

  // Actual COGS expenses by month → category → boat ("" = fleet-wide)
  const actuals = new Map<string, Map<string, Map<string, number>>>();
  for (const e of input.expenses) {
    if (!COGS_KEYS.has(e.category)) continue;
    const m = monthKey(e.date);
    const byCat = actuals.get(m) ?? new Map<string, Map<string, number>>();
    const byBoat = byCat.get(e.category) ?? new Map<string, number>();
    const k = e.boatId ?? "";
    byBoat.set(k, (byBoat.get(k) ?? 0) + e.amountCents);
    byCat.set(e.category, byBoat);
    actuals.set(m, byCat);
  }

  const results = new Map<string, BookingProfit>();
  for (const t of trips) {
    results.set(t.b.id, {
      id: t.b.id,
      boatId: t.b.boatId,
      month: t.month,
      revenueCents: t.revenueCents,
      hours: t.hours,
      cogs: {},
      cogsCents: 0,
      fixedCents: 0,
      variableCents: 0,
      grossCents: 0,
      margin: null,
      contributionCents: 0,
      sources: {},
    });
  }
  const add = (id: string, cat: string, cents: number, fixed: boolean, source: CostSource) => {
    const r = results.get(id)!;
    r.cogs[cat] = (r.cogs[cat] ?? 0) + cents;
    r.cogsCents += cents;
    if (fixed) r.fixedCents += cents;
    else r.variableCents += cents;
    r.sources[cat] = source;
  };

  const boatMonths: BoatMonth[] = [];
  const boatList = [...boatIds];

  for (const month of [...months].sort()) {
    const monthTrips = trips.filter((t) => t.month === month);
    const hoursByBoat = boatList.map((id) => monthTrips.filter((t) => t.b.boatId === id).reduce((s, t) => s + t.hours, 0));
    const monthActuals = actuals.get(month);

    // Fleet-wide actuals: split across boats by trip hours this month
    const fleetShare = new Map<string, Map<string, number>>(); // cat -> boat -> cents
    let fleetUnallocated = 0;
    for (const [cat, byBoat] of monthActuals ?? []) {
      const fleet = byBoat.get("") ?? 0;
      if (!fleet) continue;
      if (hoursByBoat.every((h) => h === 0)) {
        fleetUnallocated += fleet;
        continue;
      }
      const parts = allocate(fleet, hoursByBoat);
      fleetShare.set(cat, new Map(boatList.map((id, i) => [id, parts[i]])));
    }

    boatList.forEach((boatId, bi) => {
      const bt = monthTrips.filter((t) => t.b.boatId === boatId);
      const rows = costs.filter((c) => c.boatId === boatId || c.boatId == null);
      const bm: BoatMonth = {
        boatId,
        month,
        trips: bt.length,
        hours: hoursByBoat[bi],
        revenueCents: bt.reduce((s, t) => s + t.revenueCents, 0),
        cogsCents: 0,
        grossCents: 0,
        fixedCents: 0,
        unallocatedCents: 0,
        categories: {},
      };
      // A boat with no trips gets the leftover fleet actuals noted on the first boat only.
      if (bi === 0) bm.unallocatedCents += fleetUnallocated;

      const cats = new Set<string>(rows.map((r) => r.category));
      for (const [cat, byBoat] of monthActuals ?? []) if (byBoat.has(boatId) || byBoat.has("")) cats.add(cat);

      for (const cat of cats) {
        const catRows = rows.filter((r) => r.category === cat);
        const byBoat = monthActuals?.get(cat);
        const hasActual = COGS_KEYS.has(cat) && !!byBoat && (byBoat.has(boatId) || byBoat.has(""));

        if (hasActual) {
          const total = (byBoat!.get(boatId) ?? 0) + (fleetShare.get(cat)?.get(boatId) ?? 0);
          const fixed = catRows.length ? catRows.every((r) => r.basis === "monthly") : DEFAULT_FIXED_CATEGORIES.has(cat);
          if (fixed) bm.fixedCents += total;
          bm.categories[cat] = { source: "actual", cents: total };
          if (bt.length === 0) {
            bm.unallocatedCents += total;
            continue;
          }
          const weights = bt.map((t) => (cat === "fuel" ? t.runHours : t.hours));
          allocate(total, weights).forEach((cents, i) => add(bt[i].b.id, cat, cents, fixed, "actual"));
          continue;
        }

        // Estimate
        let catTotal = 0;
        for (const t of bt) {
          let v = 0;
          for (const r of catRows) if (r.basis !== "monthly") v += variableCost(r, t);
          if (v) add(t.b.id, cat, v, false, "estimate");
          else if (catRows.length) results.get(t.b.id)!.sources[cat] = "estimate";
          catTotal += v;
        }
        const monthly = catRows
          .filter((r) => r.basis === "monthly")
          .reduce((s, r) => {
            if (r.boatId) return s + r.amountCents;
            return activeIds.has(boatId) ? s + r.amountCents / nActive : s;
          }, 0);
        const monthlyCents = Math.round(monthly);
        if (monthlyCents) {
          bm.fixedCents += monthlyCents;
          catTotal += monthlyCents;
          if (bt.length === 0) bm.unallocatedCents += monthlyCents;
          else allocate(monthlyCents, bt.map((t) => t.hours)).forEach((cents, i) => add(bt[i].b.id, cat, cents, true, "estimate"));
        }
        if (catRows.length) bm.categories[cat] = { source: "estimate", cents: catTotal };
      }

      bm.cogsCents = bt.reduce((s, t) => s + results.get(t.b.id)!.cogsCents, 0);
      bm.grossCents = bm.revenueCents - bm.cogsCents;
      boatMonths.push(bm);
    });
  }

  for (const r of results.values()) {
    r.grossCents = r.revenueCents - r.cogsCents;
    r.margin = r.revenueCents ? r.grossCents / r.revenueCents : null;
    r.contributionCents = r.revenueCents - r.variableCents;
  }

  return { bookings: input.bookings.map((b) => results.get(b.id)!), boatMonths };
}

// ---------------------------------------------------------------- rollups

export type Rollup = { key: string; trips: number; revenueCents: number; cogsCents: number; grossCents: number; margin: number | null };

export function rollup(rows: BookingProfit[], keyOf: (r: BookingProfit) => string): Rollup[] {
  const map = new Map<string, Rollup>();
  for (const r of rows) {
    const k = keyOf(r);
    const cur = map.get(k) ?? { key: k, trips: 0, revenueCents: 0, cogsCents: 0, grossCents: 0, margin: null };
    cur.trips++;
    cur.revenueCents += r.revenueCents;
    cur.cogsCents += r.cogsCents;
    cur.grossCents += r.grossCents;
    map.set(k, cur);
  }
  for (const v of map.values()) v.margin = v.revenueCents ? v.grossCents / v.revenueCents : null;
  return [...map.values()];
}

export function totals(rows: BookingProfit[]): Omit<Rollup, "key"> {
  const r = rollup(rows, () => "all")[0];
  return r ?? { trips: 0, revenueCents: 0, cogsCents: 0, grossCents: 0, margin: null };
}

// ---------------------------------------------------------------- breakeven

export type Breakeven = {
  fixedCents: number;
  avgContributionCents: number | null;
  /** Trips needed to cover fixed costs this month, null when it can't be worked out */
  tripsNeeded: number | null;
  tripsDone: number;
  tripsBooked: number;
  /** 0..1+ of trips needed that are already done */
  pctDone: number | null;
  /** 0..1+ of trips needed counting trips on the books */
  pctWithBooked: number | null;
};

/**
 * Trips needed = fixed monthly costs ÷ average contribution per trip
 * (contribution = revenue − variable costs). Uses this month's trips for the
 * average, or `fallbackAvgCents` (e.g. the boat's average over the range) when
 * there are none yet.
 */
export function breakeven(args: { fixedCents: number; contributions: number[]; tripsDone: number; tripsBooked: number; fallbackAvgCents?: number | null }): Breakeven {
  const { fixedCents, contributions, tripsDone, tripsBooked } = args;
  const avg = contributions.length ? contributions.reduce((s, c) => s + c, 0) / contributions.length : args.fallbackAvgCents ?? null;
  let tripsNeeded: number | null = null;
  if (fixedCents <= 0) tripsNeeded = 0;
  else if (avg != null && avg > 0) tripsNeeded = Math.ceil(fixedCents / avg);
  const pct = (n: number) => (tripsNeeded == null ? null : tripsNeeded === 0 ? 1 : n / tripsNeeded);
  return {
    fixedCents,
    avgContributionCents: avg == null ? null : Math.round(avg),
    tripsNeeded,
    tripsDone,
    tripsBooked,
    pctDone: pct(tripsDone),
    pctWithBooked: pct(tripsDone + tripsBooked),
  };
}

/** Breakeven for every boat-month in a result. `now` splits done vs on the books. */
export function breakevenByBoatMonth(result: ProfitResult, bookings: ProfitBookingInput[], now: Date) {
  const start = new Map(bookings.map((b) => [b.id, b.startsAt]));
  const byBoatAll = new Map<string, number[]>();
  for (const r of result.bookings) byBoatAll.set(r.boatId, [...(byBoatAll.get(r.boatId) ?? []), r.contributionCents]);
  return result.boatMonths.map((bm) => {
    const rows = result.bookings.filter((r) => r.boatId === bm.boatId && r.month === bm.month);
    const all = byBoatAll.get(bm.boatId) ?? [];
    const done = rows.filter((r) => start.get(r.id)! < now).length;
    return {
      boatId: bm.boatId,
      month: bm.month,
      ...breakeven({
        fixedCents: bm.fixedCents,
        contributions: rows.map((r) => r.contributionCents),
        tripsDone: done,
        tripsBooked: rows.length - done,
        fallbackAvgCents: all.length ? all.reduce((s, c) => s + c, 0) / all.length : null,
      }),
    };
  });
}

// ---------------------------------------------------------------- forecast

export type ForecastTrip = { startsAt: Date; createdAt: Date; revenueCents: number };

export type Forecast = {
  month: string;
  /** Revenue from this month's trips on days already past */
  actualCents: number;
  /** Revenue from this month's trips today or later that are already booked */
  bookedCents: number;
  /** Expected new bookings still to come for this month */
  projectedCents: number;
  totalCents: number;
  /** Average $ per day of new bookings for this month over the last 28 days */
  dailyPickupCents: number;
  /** Days left to take bookings for this month (today through month end) */
  daysLeft: number;
};

export const PICKUP_WINDOW_DAYS = 28;

/**
 * Forecast for one month ("YYYY-MM"), as of local date `today`:
 *
 *   actual     = revenue of the month's trips before today
 *   booked     = revenue of the month's trips today or later that are already booked
 *   projected  = pickup rate × days left
 *       pickup rate = revenue of bookings MADE in the last 28 days (today included)
 *                     for trips in this month, ÷ 28   → "$ of new bookings per day"
 *       days left   = days from today through the last day of the month
 *                     (0 for a month that's over)
 *   forecast   = actual + booked + projected
 *
 * It assumes the next few weeks sell like the last four did. It's a pace
 * check, not a promise: far-out months sell slower now than they will later.
 */
export function forecastFrom(month: string, today: string, trips: ForecastTrip[]): Forecast {
  const inMonth = trips.filter((t) => monthKey(t.startsAt) === month);
  let actual = 0;
  let booked = 0;
  for (const t of inMonth) {
    if (localDate(t.startsAt) < today) actual += t.revenueCents;
    else booked += t.revenueCents;
  }
  const windowStart = addDays(today, -(PICKUP_WINDOW_DAYS - 1));
  const pickup = inMonth
    .filter((t) => {
      const c = localDate(t.createdAt);
      return c >= windowStart && c <= today;
    })
    .reduce((s, t) => s + t.revenueCents, 0);
  const daily = pickup / PICKUP_WINDOW_DAYS;
  const monthEnd = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  let daysLeft = 0;
  // Bookings for this month can still come in any day from today until it ends.
  for (let d = today; d <= monthEnd; d = addDays(d, 1)) daysLeft++;
  const projected = Math.round(daily * daysLeft);
  return {
    month,
    actualCents: actual,
    bookedCents: booked,
    projectedCents: projected,
    totalCents: actual + booked + projected,
    dailyPickupCents: Math.round(daily),
    daysLeft,
  };
}

// ---------------------------------------------------------------- loaders (server only)

/** Local "YYYY-MM-DD" → first instant of that day in UTC. */
async function dayStart(dateStr: string) {
  const { zonedToUtc } = await import("./time");
  return zonedToUtc(dateStr, "00:00");
}

/**
 * Load everything for a local date range and compute profit. Whole months are
 * loaded so monthly costs and actuals are spread over the full month's trips,
 * then `inRange` holds only trips that start inside [from, to].
 */
export async function loadProfit(from: string, to: string, opts: { boatId?: string } = {}) {
  const { prisma } = await import("./db");
  const months = monthsBetween(from, to);
  const start = await dayStart(`${months[0]}-01`);
  const end = await dayStart(`${addMonths(months[months.length - 1], 1)}-01`);
  const [boats, bookings, costs, expenses] = await Promise.all([
    prisma.boat.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, status: true } }),
    prisma.booking.findMany({
      where: { startsAt: { gte: start, lt: end }, status: { not: "cancelled" } },
      include: { customer: { select: { firstName: true, lastName: true } } },
      orderBy: { startsAt: "asc" },
    }),
    prisma.boatCost.findMany({ where: { active: true } }),
    prisma.expense.findMany({ where: { date: { gte: start, lt: end } } }),
  ]);
  const result = computeProfit({ boats, bookings, costs, expenses, months });
  const fromUtc = await dayStart(from);
  const toUtc = await dayStart(addDays(to, 1));
  const byId = new Map(bookings.map((b) => [b.id, b]));
  const inRange = result.bookings
    .filter((r) => {
      const b = byId.get(r.id)!;
      return b.startsAt >= fromUtc && b.startsAt < toUtc && (!opts.boatId || b.boatId === opts.boatId);
    })
    .map((r) => ({ ...r, booking: byId.get(r.id)! }));
  const breakevens = breakevenByBoatMonth(result, bookings, new Date());
  return { boats, months, result, inRange, breakevens };
}

/** Forecast a month ("YYYY-MM"), optionally for one boat. See forecastFrom for the method. */
export async function forecastMonth(month: string, opts: { boatId?: string; today?: string } = {}): Promise<Forecast> {
  return (await forecastMonths(month, 1, opts))[0];
}

/** Forecast `count` months starting at `month` with one query. */
export async function forecastMonths(month: string, count: number, opts: { boatId?: string; today?: string } = {}): Promise<Forecast[]> {
  const { prisma } = await import("./db");
  const { todayLocal } = await import("./time");
  const today = opts.today ?? todayLocal();
  const last = addMonths(month, count - 1);
  const bookings = await prisma.booking.findMany({
    where: {
      startsAt: { gte: await dayStart(`${month}-01`), lt: await dayStart(`${addMonths(last, 1)}-01`) },
      status: { not: "cancelled" },
      ...(opts.boatId ? { boatId: opts.boatId } : {}),
    },
  });
  const trips = bookings.map((b) => ({ startsAt: b.startsAt, createdAt: b.createdAt, revenueCents: bookingRevenue(b) }));
  return Array.from({ length: count }, (_, i) => forecastFrom(addMonths(month, i), today, trips));
}

// ---------------------------------------------------------------- sample assumptions

export const PLACEHOLDER_PREFIX = "PLACEHOLDER: ";

/** Sample cost rows per boat. Amounts are made up: replace them with real numbers. */
export const SAMPLE_COSTS: Omit<CostInput, "boatId">[] = [
  { name: "Boat lift / slip", category: "boat_lift", basis: "monthly", amountCents: 40000, percentBps: 0 },
  { name: "Insurance", category: "insurance", basis: "monthly", amountCents: 25000, percentBps: 0 },
  { name: "Boat payment", category: "boat_payment", basis: "monthly", amountCents: 90000, percentBps: 0 },
  { name: "Fuel", category: "fuel", basis: "per_engine_hour", amountCents: 1800, percentBps: 0 },
  { name: "Maintenance reserve", category: "maintenance", basis: "per_engine_hour", amountCents: 800, percentBps: 0 },
  { name: "Cleaning", category: "cleaning", basis: "per_trip", amountCents: 2500, percentBps: 0 },
  { name: "Dock crew labor", category: "crew_labor", basis: "per_trip_hour", amountCents: 2000, percentBps: 0 },
  { name: "Card processing 2.9%", category: "card_fees", basis: "percent_revenue", amountCents: 0, percentBps: 290 },
  { name: "Card processing 30¢", category: "card_fees", basis: "per_trip", amountCents: 30, percentBps: 0 },
];

/**
 * Idempotent: adds the PLACEHOLDER sample rows for each boat that isn't
 * retired, skipping any row (same boat + name) that already exists.
 * Returns how many rows were created.
 */
export async function seedCostAssumptions(): Promise<number> {
  const { prisma } = await import("./db");
  const boats = await prisma.boat.findMany({ where: { status: { not: "retired" } } });
  let created = 0;
  for (const boat of boats) {
    for (const s of SAMPLE_COSTS) {
      const name = PLACEHOLDER_PREFIX + s.name;
      const exists = await prisma.boatCost.findFirst({ where: { boatId: boat.id, name } });
      if (exists) continue;
      await prisma.boatCost.create({ data: { ...s, name, boatId: boat.id } });
      created++;
    }
  }
  return created;
}

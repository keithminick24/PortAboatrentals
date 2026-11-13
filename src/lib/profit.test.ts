import { describe, expect, it } from "vitest";
import { zonedToUtc } from "./time";
import {
  allocate,
  bookingRevenue,
  breakeven,
  breakevenByBoatMonth,
  computeProfit,
  forecastFrom,
  type CostInput,
  type ProfitBookingInput,
} from "./profit";

const at = (d: string, t: string) => zonedToUtc(d, t);
let n = 0;
function trip(boatId: string, date: string, hours: number, rev: number, extra: Partial<ProfitBookingInput> = {}): ProfitBookingInput {
  const startsAt = at(date, "09:00");
  return {
    id: `t${++n}`,
    boatId,
    startsAt,
    endsAt: new Date(startsAt.getTime() + hours * 3_600_000),
    createdAt: at("2026-05-01", "12:00"),
    subtotalCents: rev,
    addOnsCents: 0,
    feesCents: 0,
    convenienceFeeCents: 0,
    depositCapturedCents: 0,
    refundedCents: 0,
    engineHoursOut: null,
    engineHoursIn: null,
    ...extra,
  };
}
const cost = (c: Partial<CostInput>): CostInput => ({ boatId: "A", name: "x", category: "other", basis: "monthly", amountCents: 0, percentBps: 0, ...c });
const boats = [
  { id: "A", name: "Alpha", status: "available" },
  { id: "B", name: "Bravo", status: "available" },
];

describe("allocate", () => {
  it("sums exactly and follows weights", () => {
    const p = allocate(1000, [1, 1, 1]);
    expect(p.reduce((s, x) => s + x, 0)).toBe(1000);
    expect(p).toEqual([334, 333, 333]);
    expect(allocate(900, [4, 8])).toEqual([300, 600]);
  });
  it("splits evenly with zero weights", () => {
    expect(allocate(100, [0, 0])).toEqual([50, 50]);
    expect(allocate(-100, [1, 3])).toEqual([-25, -75]);
  });
});

describe("revenue", () => {
  it("excludes tax and tips, nets refunds, adds deposit captures", () => {
    expect(
      bookingRevenue({ subtotalCents: 45000, addOnsCents: 5000, feesCents: 5000, convenienceFeeCents: 1500, depositCapturedCents: 10000, refundedCents: 2000 }),
    ).toBe(64500);
  });
});

describe("computeProfit estimates", () => {
  it("applies each basis and spreads monthly costs by trip hours", () => {
    const t1 = trip("A", "2026-06-10", 4, 40000, { engineHoursOut: 100, engineHoursIn: 103 });
    const t2 = trip("A", "2026-06-11", 8, 80000);
    const costs = [
      cost({ category: "boat_lift", basis: "monthly", amountCents: 1200 }),
      cost({ category: "fuel", basis: "per_engine_hour", amountCents: 1000 }),
      cost({ category: "cleaning", basis: "per_trip", amountCents: 2500 }),
      cost({ category: "crew_labor", basis: "per_trip_hour", amountCents: 2000 }),
      cost({ category: "card_fees", basis: "percent_revenue", percentBps: 290 }),
      cost({ category: "card_fees", basis: "per_trip", amountCents: 30 }),
    ];
    const r = computeProfit({ boats, bookings: [t1, t2], costs, expenses: [] });
    const [p1, p2] = r.bookings;
    expect(p1.cogs.boat_lift).toBe(400); // 4 of 12 hours
    expect(p2.cogs.boat_lift).toBe(800);
    expect(p1.cogs.fuel).toBe(3000); // 3 engine hours
    expect(p2.cogs.fuel).toBe(8000); // falls back to 8 scheduled hours
    expect(p1.cogs.cleaning).toBe(2500);
    expect(p1.cogs.crew_labor).toBe(8000);
    expect(p1.cogs.card_fees).toBe(1160 + 30);
    expect(p1.cogsCents).toBe(400 + 3000 + 2500 + 8000 + 1190);
    expect(p1.grossCents).toBe(40000 - p1.cogsCents);
    expect(p1.fixedCents).toBe(400);
    expect(p1.contributionCents).toBe(40000 - (p1.cogsCents - 400));
    expect(p1.sources.fuel).toBe("estimate");
    const bm = r.boatMonths.find((b) => b.boatId === "A" && b.month === "2026-06")!;
    expect(bm.fixedCents).toBe(1200);
  });

  it("splits fleet-wide monthly costs evenly across non-retired boats", () => {
    const tA = trip("A", "2026-06-10", 4, 40000);
    const tB = trip("B", "2026-06-10", 4, 40000);
    const fleet = cost({ boatId: null, category: "insurance", basis: "monthly", amountCents: 1000 });
    const r = computeProfit({ boats: [...boats, { id: "C", name: "Old", status: "retired" }], bookings: [tA, tB], costs: [fleet], expenses: [] });
    expect(r.bookings[0].cogs.insurance).toBe(500);
    expect(r.bookings[1].cogs.insurance).toBe(500);
  });
});

describe("actuals override estimates", () => {
  it("uses the real total for that boat + month + category", () => {
    const t1 = trip("A", "2026-06-10", 2, 30000, { engineHoursOut: 10, engineHoursIn: 11 });
    const t2 = trip("A", "2026-06-12", 6, 60000, { engineHoursOut: 11, engineHoursIn: 14 });
    const costs = [cost({ category: "fuel", basis: "per_engine_hour", amountCents: 5000 }), cost({ category: "cleaning", basis: "per_trip", amountCents: 1000 })];
    const expenses = [{ date: at("2026-06-15", "12:00"), amountCents: 8000, category: "fuel", boatId: "A" }];
    const r = computeProfit({ boats, bookings: [t1, t2], costs, expenses });
    // Fuel actual $80 split by engine hours 1 : 3
    expect(r.bookings[0].cogs.fuel).toBe(2000);
    expect(r.bookings[1].cogs.fuel).toBe(6000);
    expect(r.bookings[0].sources.fuel).toBe("actual");
    // Cleaning has no actuals, stays an estimate
    expect(r.bookings[0].cogs.cleaning).toBe(1000);
    expect(r.bookings[0].sources.cleaning).toBe("estimate");
    const bm = r.boatMonths.find((b) => b.boatId === "A")!;
    expect(bm.categories.fuel).toEqual({ source: "actual", cents: 8000 });
  });

  it("does not let actuals in another month or a non-COGS category override", () => {
    const t1 = trip("A", "2026-06-10", 4, 30000);
    const costs = [cost({ category: "fuel", basis: "per_trip", amountCents: 700 })];
    const expenses = [
      { date: at("2026-07-02", "12:00"), amountCents: 99999, category: "fuel", boatId: "A" },
      { date: at("2026-06-02", "12:00"), amountCents: 5000, category: "marketing", boatId: null },
    ];
    const r = computeProfit({ boats, bookings: [t1], costs, expenses });
    expect(r.bookings[0].cogs.fuel).toBe(700);
    expect(r.bookings[0].cogs.marketing).toBeUndefined();
  });

  it("splits fleet-wide actuals across boats by trip hours", () => {
    const tA = trip("A", "2026-06-10", 6, 50000);
    const tB = trip("B", "2026-06-10", 2, 20000);
    const expenses = [{ date: at("2026-06-20", "12:00"), amountCents: 4000, category: "maintenance", boatId: null }];
    const r = computeProfit({ boats, bookings: [tA, tB], costs: [], expenses });
    expect(r.bookings[0].cogs.maintenance).toBe(3000);
    expect(r.bookings[1].cogs.maintenance).toBe(1000);
  });

  it("treats monthly-type categories on actuals as fixed", () => {
    const t1 = trip("A", "2026-06-10", 4, 30000);
    const expenses = [{ date: at("2026-06-01", "12:00"), amountCents: 50000, category: "insurance", boatId: "A" }];
    const r = computeProfit({ boats, bookings: [t1], costs: [], expenses });
    expect(r.boatMonths.find((b) => b.boatId === "A")!.fixedCents).toBe(50000);
    expect(r.bookings[0].contributionCents).toBe(30000);
  });
});

describe("breakeven", () => {
  it("divides fixed costs by average contribution", () => {
    const b = breakeven({ fixedCents: 100000, contributions: [30000, 20000], tripsDone: 2, tripsBooked: 1 });
    expect(b.avgContributionCents).toBe(25000);
    expect(b.tripsNeeded).toBe(4);
    expect(b.pctDone).toBe(0.5);
    expect(b.pctWithBooked).toBe(0.75);
  });
  it("uses the fallback average and handles no contribution", () => {
    expect(breakeven({ fixedCents: 1000, contributions: [], tripsDone: 0, tripsBooked: 0, fallbackAvgCents: 300 }).tripsNeeded).toBe(4);
    expect(breakeven({ fixedCents: 1000, contributions: [-5], tripsDone: 1, tripsBooked: 0 }).tripsNeeded).toBeNull();
    expect(breakeven({ fixedCents: 0, contributions: [], tripsDone: 0, tripsBooked: 0 }).pctDone).toBe(1);
  });
  it("counts done vs booked trips by now", () => {
    const t1 = trip("A", "2026-06-05", 4, 50000);
    const t2 = trip("A", "2026-06-25", 4, 50000);
    const costs = [cost({ category: "boat_lift", basis: "monthly", amountCents: 120000 })];
    const r = computeProfit({ boats, bookings: [t1, t2], costs, expenses: [] });
    const be = breakevenByBoatMonth(r, [t1, t2], at("2026-06-15", "12:00")).find((b) => b.boatId === "A")!;
    expect(be.tripsDone).toBe(1);
    expect(be.tripsBooked).toBe(1);
    expect(be.tripsNeeded).toBe(3); // 1200 / 500
  });
});

describe("forecast", () => {
  it("adds actual, booked, and pickup × days left", () => {
    const today = "2026-06-21";
    const mk = (start: string, created: string, rev: number) => ({ startsAt: at(start, "10:00"), createdAt: at(created, "10:00"), revenueCents: rev });
    const trips = [
      mk("2026-06-02", "2026-05-01", 10000), // past, old booking
      mk("2026-06-10", "2026-06-01", 20000), // past, booked in window
      mk("2026-06-25", "2026-06-15", 28000), // future, booked in window
      mk("2026-07-04", "2026-06-20", 56000), // next month
    ];
    const f = forecastFrom("2026-06", today, trips);
    expect(f.actualCents).toBe(30000);
    expect(f.bookedCents).toBe(28000);
    expect(f.daysLeft).toBe(10); // 21st..30th
    expect(f.dailyPickupCents).toBe(Math.round(48000 / 28));
    expect(f.projectedCents).toBe(Math.round((48000 / 28) * 10));
    expect(f.totalCents).toBe(30000 + 28000 + f.projectedCents);

    const j = forecastFrom("2026-07", today, trips);
    expect(j.actualCents).toBe(0);
    expect(j.bookedCents).toBe(56000);
    expect(j.daysLeft).toBe(10 + 31);
    expect(j.projectedCents).toBe(Math.round((56000 / 28) * 41));

    const past = forecastFrom("2026-05", today, trips);
    expect(past.daysLeft).toBe(0);
    expect(past.projectedCents).toBe(0);
  });
});

import { matchCategory, parseExpenseCsv, parseLooseAmount, parseLooseDate, SAMPLE_EXPENSE_CSV } from "./expenseCsv";

describe("expense CSV", () => {
  it("parses the sample", () => {
    const r = parseExpenseCsv(SAMPLE_EXPENSE_CSV);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[1]).toMatchObject({ date: "2026-06-05", amountCents: 125000, category: "insurance", boatName: "" });
    expect(r.rows[2].category).toBe("cleaning");
  });
  it("is tolerant", () => {
    expect(parseLooseDate("6/3/26")).toBe("2026-06-03");
    expect(parseLooseDate("2026-02-30")).toBeNull();
    expect(parseLooseAmount("(45.10)")).toBe(4510);
    expect(matchCategory("Gas")).toBe("fuel");
    const r = parseExpenseCsv("Payee;Total;Date\nShell;20;2026-01-02\nbad;x;2026-01-02");
    expect(r.rows[0]).toMatchObject({ vendor: "Shell", amountCents: 2000, date: "2026-01-02" });
    expect(r.errors).toHaveLength(1);
  });
});

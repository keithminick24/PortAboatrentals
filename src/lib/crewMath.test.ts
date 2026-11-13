import { describe, expect, it } from "vitest";
import { estimatedGrossCents, mondayOf, periodDates, splitTip, tipEarnedAt, tipShares, weeklyOvertime } from "./crewMath";
import { zonedToUtc } from "./time";

const TZ = "America/Chicago";
const at = (d: string, t: string) => zonedToUtc(d, t, TZ);
const shift = (d: string, from: string, to: string) => ({ clockIn: at(d, from), clockOut: at(d, to) });

describe("tip splitting", () => {
  it("splits evenly with leftover cents to the first person", () => {
    const s = splitTip(1000, [
      { userId: "a", name: "Ann" },
      { userId: "b", name: "Bo" },
      { userId: "c", name: "Cy" },
    ]);
    expect(s.map((x) => x.cents)).toEqual([334, 333, 333]);
    expect(s.reduce((n, x) => n + x.cents, 0)).toBe(1000);
  });

  it("gives tips with no crew to Unassigned", () => {
    expect(splitTip(500, [])).toEqual([{ userId: "unassigned", name: "Unassigned", cents: 500 }]);
  });

  it("totals card and cash per person across trips", () => {
    const tips = [
      { id: "t1", bookingId: "b1", amountCents: 2001, method: "card" },
      { id: "t2", bookingId: "b1", amountCents: 1000, method: "cash" },
      { id: "t3", bookingId: "b2", amountCents: 700, method: "mock" },
      { id: "t4", bookingId: "b3", amountCents: 300, method: "cash" },
    ];
    const crew = [
      { bookingId: "b1", userId: "a", name: "Ann" },
      { bookingId: "b1", userId: "b", name: "Bo" },
      { bookingId: "b1", userId: "b", name: "Bo" }, // duplicate ignored
      { bookingId: "b2", userId: "b", name: "Bo" },
    ];
    const { byPerson, perTip } = tipShares(tips, crew);
    const get = (id: string) => byPerson.find((p) => p.userId === id)!;
    expect(get("a")).toMatchObject({ cardCents: 1001, cashCents: 500, totalCents: 1501 });
    expect(get("b")).toMatchObject({ cardCents: 1000 + 700, cashCents: 500, totalCents: 2200 });
    expect(get("unassigned")).toMatchObject({ cashCents: 300 });
    expect(perTip[0].shares).toHaveLength(2);
    const all = byPerson.reduce((n, p) => n + p.totalCents, 0);
    expect(all).toBe(2001 + 1000 + 700 + 300);
  });

  it("counts a tip on the later of trip start and when received", () => {
    const trip = new Date("2026-07-04T15:00:00Z");
    expect(tipEarnedAt(new Date("2026-06-01T00:00:00Z"), trip)).toEqual(trip);
    expect(tipEarnedAt(new Date("2026-07-05T00:00:00Z"), trip)).toEqual(new Date("2026-07-05T00:00:00Z"));
  });
});

describe("overtime", () => {
  // Mon Jul 6 2026 – Sun Jul 12 2026
  const from = at("2026-07-06", "00:00");
  const to = at("2026-07-13", "00:00");

  it("no overtime at or under 40 hours", () => {
    const e = ["06", "07", "08", "09", "10"].map((d) => shift(`2026-07-${d}`, "08:00", "16:00"));
    expect(weeklyOvertime(e, from, to, TZ)).toEqual({ regularMinutes: 2400, overtimeMinutes: 0 });
  });

  it("hours past 40 in the week are overtime", () => {
    const e = ["06", "07", "08", "09", "10"].map((d) => shift(`2026-07-${d}`, "08:00", "18:00")); // 50 hrs
    expect(weeklyOvertime(e, from, to, TZ)).toEqual({ regularMinutes: 2400, overtimeMinutes: 600 });
  });

  it("resets each Monday", () => {
    const e = [
      ...["06", "07", "08", "09"].map((d) => shift(`2026-07-${d}`, "07:00", "19:00")), // 48 hrs week 1
      shift("2026-07-13", "08:00", "12:00"), // 4 hrs week 2
    ];
    const r = weeklyOvertime(e, from, at("2026-07-20", "00:00"), TZ);
    expect(r).toEqual({ regularMinutes: 2400 + 240, overtimeMinutes: 480 });
  });

  it("counts earlier hours in the week when the period starts mid-week", () => {
    const e = ["06", "07", "08", "09", "10"].map((d) => shift(`2026-07-${d}`, "08:00", "18:00")); // 10 hrs/day
    // Period starts Friday: Mon–Thu = 40 hrs, so all of Friday is overtime
    const r = weeklyOvertime(e, at("2026-07-10", "00:00"), to, TZ);
    expect(r).toEqual({ regularMinutes: 0, overtimeMinutes: 600 });
  });

  it("skips entries with no clock-out", () => {
    expect(weeklyOvertime([{ clockIn: at("2026-07-06", "08:00"), clockOut: null }], from, to, TZ)).toEqual({
      regularMinutes: 0,
      overtimeMinutes: 0,
    });
  });

  it("estimates gross pay with time and a half", () => {
    expect(estimatedGrossCents(2400, 600, 1500)).toBe(40 * 1500 + 10 * 2250);
  });
});

describe("pay periods", () => {
  it("finds Monday", () => {
    expect(mondayOf("2026-11-13")).toBe("2026-11-09"); // Friday
    expect(mondayOf("2026-11-15")).toBe("2026-11-09"); // Sunday
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
  });
  it("presets", () => {
    expect(periodDates("this_week", "2026-11-13")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(periodDates("last_week", "2026-11-13")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(periodDates("last_2_weeks", "2026-11-13")).toEqual({ from: "2026-10-26", to: "2026-11-08" });
    expect(periodDates("custom", "2026-11-13", { from: "2026-11-10", to: "2026-11-01" })).toEqual({ from: "2026-11-01", to: "2026-11-10" });
  });
});

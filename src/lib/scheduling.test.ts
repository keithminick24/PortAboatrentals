import { describe, expect, it } from "vitest";
import { availableStartTimes, isFree, peakUsage } from "./availability";
import { computeQuote, isWeekendDay } from "./pricing";
import { addDays, localDate, localTime, weekdayOf, zonedToUtc } from "./time";
import { parseMoney } from "./money";

const TZ = "America/Chicago";

describe("time zone helpers", () => {
  it("converts Central wall time to UTC across DST", () => {
    expect(zonedToUtc("2026-07-04", "09:00", TZ).toISOString()).toBe("2026-07-04T14:00:00.000Z"); // CDT -5
    expect(zonedToUtc("2026-12-04", "09:00", TZ).toISOString()).toBe("2026-12-04T15:00:00.000Z"); // CST -6
  });
  it("round-trips", () => {
    const d = zonedToUtc("2026-03-08", "15:30", TZ); // DST start day
    expect(localDate(d, TZ)).toBe("2026-03-08");
    expect(localTime(d, TZ)).toBe("15:30");
  });
  it("does date math", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOf("2026-11-14")).toBe(6);
  });
});

describe("availability", () => {
  const base = {
    date: "2026-07-04",
    openTime: "08:00",
    closeTime: "18:00",
    slotIntervalMin: 60,
    bufferMin: 30,
    earliestStart: new Date(0),
    blocks: [],
    tz: TZ,
  };

  it("lists every start that fits before close", () => {
    const times = availableStartTimes({ ...base, durationMin: 240, bookings: [] });
    expect(times).toEqual(["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00"]);
  });

  it("respects existing bookings plus turnaround buffer", () => {
    const booked = { start: zonedToUtc("2026-07-04", "08:00", TZ), end: zonedToUtc("2026-07-04", "12:00", TZ) };
    const times = availableStartTimes({ ...base, durationMin: 240, bookings: [booked] });
    // 12:00 is blocked by the 30 min buffer; 13:00 is first free
    expect(times).toEqual(["13:00", "14:00"]);
  });

  it("respects maintenance blocks and minimum notice", () => {
    const block = { start: zonedToUtc("2026-07-04", "14:00", TZ), end: zonedToUtc("2026-07-04", "18:00", TZ) };
    const times = availableStartTimes({
      ...base,
      durationMin: 120,
      bookings: [],
      blocks: [block],
      earliestStart: zonedToUtc("2026-07-04", "10:30", TZ),
    });
    expect(times).toEqual(["11:00", "12:00"]);
  });

  it("isFree allows back-to-back when buffer is zero", () => {
    const a = { start: new Date("2026-01-01T10:00Z"), end: new Date("2026-01-01T12:00Z") };
    expect(isFree({ start: a.end, end: new Date("2026-01-01T14:00Z") }, [a], [], 0)).toBe(true);
    expect(isFree({ start: a.end, end: new Date("2026-01-01T14:00Z") }, [a], [], 15)).toBe(false);
  });

  it("computes peak add-on usage", () => {
    const t = (h: number) => new Date(`2026-01-01T${String(h).padStart(2, "0")}:00Z`);
    const uses = [
      { start: t(8), end: t(12), quantity: 2 },
      { start: t(11), end: t(15), quantity: 1 },
      { start: t(13), end: t(17), quantity: 3 },
    ];
    expect(peakUsage({ start: t(9), end: t(14) }, uses)).toBe(4); // 13:00-14:00: 1 + 3
    expect(peakUsage({ start: t(9), end: t(11) }, uses)).toBe(2);
  });
});

describe("pricing", () => {
  it("applies weekend price, add-ons, tax and fee", () => {
    const q = computeQuote({
      rate: { priceCents: 45000, weekendPriceCents: 50000 },
      isWeekend: true,
      addOns: [{ priceCents: 4000, quantity: 2 }],
      taxRateBps: 825,
      feeRateBps: 300,
    });
    expect(q.subtotalCents).toBe(50000);
    expect(q.addOnsCents).toBe(8000);
    expect(q.taxCents).toBe(4785);
    expect(q.feesCents).toBe(1500);
    expect(q.totalCents).toBe(64285);
  });
  it("weekend days", () => {
    expect(isWeekendDay(6, "0,6")).toBe(true);
    expect(isWeekendDay(5, "0,5,6")).toBe(true);
    expect(isWeekendDay(3, "0,6")).toBe(false);
  });
  it("parses money", () => {
    expect(parseMoney("$1,234.5")).toBe(123450);
    expect(parseMoney("abc")).toBeNull();
  });
});

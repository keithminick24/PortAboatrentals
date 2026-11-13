/**
 * Pure crew math (no database): tip splitting, weekly overtime, pay periods.
 * Covered by crewMath.test.ts.
 */
import { addDays, localDate, weekdayOf, zonedToUtc, TZ } from "./time";

// ---------------------------------------------------------------------------
// Tips
// ---------------------------------------------------------------------------

export type TipLike = { id: string; bookingId: string; amountCents: number; method: string };
export type CrewLike = { bookingId: string; userId: string; name: string };
export type TipShare = { userId: string; name: string; cents: number };
export type PersonTips = { userId: string; name: string; cardCents: number; cashCents: number; totalCents: number };

export const UNASSIGNED = "unassigned";

/** "card" and "mock" (test mode card) count as card tips; everything else as cash. */
export const isCardTip = (method: string) => method !== "cash";

/**
 * Splits one tip evenly between a trip's crew. Leftover cents go to the first person.
 * No crew → the whole tip is "Unassigned".
 */
export function splitTip(amountCents: number, crew: { userId: string; name: string }[]): TipShare[] {
  if (crew.length === 0) return [{ userId: UNASSIGNED, name: "Unassigned", cents: amountCents }];
  const each = Math.floor(amountCents / crew.length);
  const rest = amountCents - each * crew.length;
  return crew.map((c, i) => ({ userId: c.userId, name: c.name, cents: each + (i === 0 ? rest : 0) }));
}

/**
 * Splits every tip evenly between the crew on its trip (crew in the order given; pass
 * them oldest first so the person who checked the boat out is "first").
 */
export function tipShares(tips: TipLike[], crew: CrewLike[]) {
  const crewByBooking = new Map<string, CrewLike[]>();
  for (const c of crew) {
    const list = crewByBooking.get(c.bookingId) ?? [];
    if (!list.some((x) => x.userId === c.userId)) list.push(c);
    crewByBooking.set(c.bookingId, list);
  }
  const people = new Map<string, PersonTips>();
  const perTip: { tipId: string; shares: TipShare[] }[] = [];
  for (const t of tips) {
    const shares = splitTip(t.amountCents, crewByBooking.get(t.bookingId) ?? []);
    perTip.push({ tipId: t.id, shares });
    for (const s of shares) {
      const p = people.get(s.userId) ?? { userId: s.userId, name: s.name, cardCents: 0, cashCents: 0, totalCents: 0 };
      if (isCardTip(t.method)) p.cardCents += s.cents;
      else p.cashCents += s.cents;
      p.totalCents += s.cents;
      people.set(s.userId, p);
    }
  }
  return { byPerson: [...people.values()], perTip };
}

/** A tip belongs to the pay period of the later of the trip start and when it was received. */
export function tipEarnedAt(tipCreatedAt: Date, tripStartsAt: Date): Date {
  return tipCreatedAt > tripStartsAt ? tipCreatedAt : tripStartsAt;
}

// ---------------------------------------------------------------------------
// Hours & overtime
// ---------------------------------------------------------------------------

export type EntryLike = { clockIn: Date; clockOut: Date | null };

/** Monday ("YYYY-MM-DD") of the Mon–Sun week containing a local date. */
export function mondayOf(dateStr: string): string {
  return addDays(dateStr, -((weekdayOf(dateStr) + 6) % 7));
}

export const OT_WEEKLY_MINUTES = 40 * 60;

/**
 * Regular and overtime minutes for entries that start inside [from, to).
 * Overtime = time past 40 hours in a Mon–Sun week (business time zone). Pass entries
 * from the whole first week too (even before `from`) so a period that starts mid-week
 * still counts the earlier hours toward the 40. Open entries (no clock-out) are skipped.
 */
export function weeklyOvertime(entries: EntryLike[], from: Date, to: Date, tz = TZ) {
  const closed = entries
    .filter((e): e is { clockIn: Date; clockOut: Date } => !!e.clockOut && e.clockOut > e.clockIn)
    .sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());
  const weekTotals = new Map<string, number>();
  let regularMinutes = 0;
  let overtimeMinutes = 0;
  for (const e of closed) {
    const minutes = Math.round((e.clockOut.getTime() - e.clockIn.getTime()) / 60000);
    const week = mondayOf(localDate(e.clockIn, tz));
    const before = weekTotals.get(week) ?? 0;
    const regular = Math.max(0, Math.min(minutes, OT_WEEKLY_MINUTES - before));
    weekTotals.set(week, before + minutes);
    if (e.clockIn >= from && e.clockIn < to) {
      regularMinutes += regular;
      overtimeMinutes += minutes - regular;
    }
  }
  return { regularMinutes, overtimeMinutes };
}

/** Estimated gross pay in cents (display only): regular × rate + OT × 1.5 × rate. */
export function estimatedGrossCents(regularMinutes: number, overtimeMinutes: number, hourlyRateCents: number): number {
  return Math.round((regularMinutes / 60) * hourlyRateCents + (overtimeMinutes / 60) * hourlyRateCents * 1.5);
}

export const hours2 = (minutes: number) => (minutes / 60).toFixed(2);

// ---------------------------------------------------------------------------
// Pay periods
// ---------------------------------------------------------------------------

export type PeriodPreset = "this_week" | "last_week" | "last_2_weeks" | "custom";

/** Inclusive local dates for a preset (weeks run Mon–Sun). */
export function periodDates(preset: PeriodPreset, today: string, custom?: { from?: string; to?: string }): { from: string; to: string } {
  const mon = mondayOf(today);
  if (preset === "last_week") return { from: addDays(mon, -7), to: addDays(mon, -1) };
  if (preset === "last_2_weeks") return { from: addDays(mon, -14), to: addDays(mon, -1) };
  if (preset === "custom" && custom?.from && custom?.to) {
    return custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from };
  }
  return { from: mon, to: addDays(mon, 6) };
}

/** UTC bounds [start, end) for inclusive local dates. */
export function periodBounds(from: string, to: string, tz = TZ) {
  return { start: zonedToUtc(from, "00:00", tz), end: zonedToUtc(addDays(to, 1), "00:00", tz) };
}

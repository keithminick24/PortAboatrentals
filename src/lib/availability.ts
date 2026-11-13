import { hhmmFromMinutes, minutesFromHHMM, zonedToUtc } from "./time";

export type Interval = { start: Date; end: Date };

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * True if [start,end) is free given existing bookings (padded by bufferMin
 * on both sides for turnaround) and hard blocks (no buffer).
 */
export function isFree(
  candidate: Interval,
  bookings: Interval[],
  blocks: Interval[],
  bufferMin: number,
): boolean {
  const pad = bufferMin * 60000;
  for (const b of bookings) {
    if (overlaps(candidate, { start: new Date(b.start.getTime() - pad), end: new Date(b.end.getTime() + pad) })) {
      return false;
    }
  }
  for (const b of blocks) if (overlaps(candidate, b)) return false;
  return true;
}

export type SlotOptions = {
  date: string; // local YYYY-MM-DD
  durationMin: number;
  openTime: string; // HH:MM
  closeTime: string; // HH:MM
  slotIntervalMin: number;
  bufferMin: number;
  earliestStart: Date; // now + min notice
  bookings: Interval[];
  blocks: Interval[];
  tz?: string;
};

/** Available local start times ("HH:MM") for one boat and one duration on a date. */
export function availableStartTimes(o: SlotOptions): string[] {
  const open = minutesFromHHMM(o.openTime);
  const close = minutesFromHHMM(o.closeTime);
  const out: string[] = [];
  for (let m = open; m + o.durationMin <= close; m += o.slotIntervalMin) {
    const hhmm = hhmmFromMinutes(m);
    const start = zonedToUtc(o.date, hhmm, o.tz);
    const end = new Date(start.getTime() + o.durationMin * 60000);
    if (start < o.earliestStart) continue;
    if (isFree({ start, end }, o.bookings, o.blocks, o.bufferMin)) out.push(hhmm);
  }
  return out;
}

/**
 * Peak concurrent units used by intervals within the candidate window.
 * Used to make sure add-on inventory (e.g. 4 paddle boards) isn't oversold.
 */
export function peakUsage(candidate: Interval, uses: (Interval & { quantity: number })[]): number {
  const relevant = uses.filter((u) => overlaps(candidate, u));
  const points = new Set<number>([candidate.start.getTime()]);
  for (const u of relevant) {
    if (u.start > candidate.start) points.add(u.start.getTime());
  }
  let peak = 0;
  for (const t of points) {
    const at = relevant
      .filter((u) => u.start.getTime() <= t && u.end.getTime() > t)
      .reduce((s, u) => s + u.quantity, 0);
    peak = Math.max(peak, at);
  }
  return peak;
}

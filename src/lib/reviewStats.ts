/** Pure helpers for the Reviews page (rating trends from snapshots). */

export type Snap = { rating: number; count: number; takenAt: Date };

/** Latest snapshot, and how rating/count changed versus the newest snapshot at least `days` old (or the oldest one). */
export function trendSummary(snaps: Snap[], days: number, now: Date) {
  const sorted = [...snaps].sort((a, b) => +a.takenAt - +b.takenAt);
  const latest = sorted[sorted.length - 1] ?? null;
  if (!latest) return { latest: null, ratingChange: 0, countChange: 0 };
  const cutoff = now.getTime() - days * 86400000;
  const before = [...sorted].reverse().find((s) => +s.takenAt <= cutoff) ?? sorted[0];
  return {
    latest,
    ratingChange: Math.round((latest.rating - before.rating) * 100) / 100,
    countChange: latest.count - before.count,
  };
}

/** Keeps one snapshot per local day (the last one), oldest first, limited to the last `days`. */
export function dailySeries(snaps: Snap[], days: number, now: Date): Snap[] {
  const cutoff = now.getTime() - days * 86400000;
  const byDay = new Map<string, Snap>();
  for (const s of [...snaps].sort((a, b) => +a.takenAt - +b.takenAt)) {
    if (+s.takenAt < cutoff) continue;
    byDay.set(s.takenAt.toISOString().slice(0, 10), s);
  }
  return [...byDay.values()];
}

/** SVG polyline points for a sparkline (width x height), values scaled to their own min/max. */
export function sparkPoints(values: number[], width: number, height: number): string {
  if (values.length === 0) return "";
  if (values.length === 1) return `0,${height / 2} ${width},${height / 2}`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => `${Math.round((i / (values.length - 1)) * width * 10) / 10},${Math.round((height - ((v - min) / span) * (height - 4) - 2) * 10) / 10}`)
    .join(" ");
}

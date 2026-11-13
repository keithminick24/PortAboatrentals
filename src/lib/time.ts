/**
 * Timezone helpers. Everything is stored in UTC; the business operates in
 * BUSINESS_TZ (America/Chicago by default). Uses Intl only - no deps.
 */
export const TZ = process.env.BUSINESS_TZ || process.env.NEXT_PUBLIC_BUSINESS_TZ || "America/Chicago";

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(date: Date, tz = TZ): Parts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour: +p.hour,
    minute: +p.minute,
    weekday: WEEKDAYS[p.weekday] ?? 0,
  };
}

/** Offset (minutes) of tz from UTC at the given instant. */
function offsetMinutes(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const truncated = Math.floor(date.getTime() / 60000) * 60000;
  return (asUtc - truncated) / 60000;
}

/** Convert a local wall-clock date ("YYYY-MM-DD") + time ("HH:MM") in tz to a UTC Date. */
export function zonedToUtc(dateStr: string, timeStr: string, tz = TZ): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = offsetMinutes(new Date(guess), tz);
  let ts = guess - off1 * 60000;
  const off2 = offsetMinutes(new Date(ts), tz);
  if (off2 !== off1) ts = guess - off2 * 60000;
  return new Date(ts);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local "YYYY-MM-DD" for an instant. */
export function localDate(date: Date, tz = TZ): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Local "HH:MM" (24h) for an instant. */
export function localTime(date: Date, tz = TZ): string {
  const p = zonedParts(date, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function todayLocal(tz = TZ): string {
  return localDate(new Date(), tz);
}

/** Add days to a "YYYY-MM-DD" string (calendar arithmetic, DST-safe). */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Day of week (0=Sun) for a "YYYY-MM-DD" string. */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function minutesFromHHMM(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function hhmmFromMinutes(mins: number): string {
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

export function isValidDateStr(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

// ---------- Display formatting (always in business TZ) ----------

export function fmtTime(date: Date, tz = TZ): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(date);
}

export function fmtHHMM(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${suffix}`;
}

export function fmtDate(date: Date, tz = TZ): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function fmtDateStr(dateStr: string, opts: Intl.DateTimeFormatOptions = {}): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...opts,
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function fmtDateTime(date: Date, tz = TZ): string {
  return `${fmtDate(date, tz)} · ${fmtTime(date, tz)}`;
}

export function fmtRange(start: Date, end: Date, tz = TZ): string {
  return `${fmtDate(start, tz)} · ${fmtTime(start, tz)} – ${fmtTime(end, tz)}`;
}

export function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} hr ${m} min`;
  if (h) return `${h} hr${h === 1 ? "" : "s"}`;
  return `${m} min`;
}

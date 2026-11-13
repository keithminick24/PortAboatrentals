/**
 * Pure helpers for phone (Quo AI) booking requests. No server imports, so
 * vitest can cover them directly.
 */
import { hhmmFromMinutes, minutesFromHHMM } from "./time";

/** What the AI pulled out of a call. Every field may be empty; staff fill gaps. */
export type Extracted = {
  wantsToBook?: boolean;
  customerName?: string | null;
  email?: string | null;
  date?: string | null; // YYYY-MM-DD
  startTime?: string | null; // HH:MM 24h
  timePreference?: string | null; // "morning", "after lunch"…
  boatName?: string | null;
  rateLabel?: string | null;
  partySize?: number | null;
  addOns?: { name: string; quantity: number }[];
  notes?: string | null;
  confidence?: number | null;
  // Filled in by the app after matching against the live fleet
  boatId?: string | null;
  rateId?: string | null;
  suggestions?: string[];
};

export function parseExtracted(json: string | null | undefined): Extracted {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" ? (v as Extracted) : {};
  } catch {
    return {};
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Placeholder email when the caller didn't spell one out (Customer.email is unique). */
export function placeholderEmail(phone: string): string {
  const digits = phone.replace(/\D/g, "").slice(-10) || "unknown";
  return `phone-${digits}@phone-orders.invalid`;
}

export const isPlaceholderEmail = (email: string) => /@phone-orders\.invalid$/i.test(email.trim());

export function looksLikeEmail(s: string | null | undefined): boolean {
  return !!s && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}

/** "Jane Q. Smith" → { firstName: "Jane", lastName: "Q. Smith" }. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "Phone", lastName: "Guest" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** Which package a phrase means. "half" / "4 hour" → half, "full day" / "all day" → full, "sunset" → sunset. */
function packageKind(s: string): "half" | "full" | "sunset" | null {
  const n = norm(s);
  if (/sunset|evening/.test(n)) return "sunset";
  if (/half|\b[2-4] ?h(ou)?rs?\b|\b[2-4] hour/.test(n)) return "half";
  if (/full|all day|whole day|\b[6-9] ?h(ou)?rs?\b|\b[6-9] hour/.test(n)) return "full";
  return null;
}

/**
 * Picks the rate that best matches what the caller asked for: exact label,
 * then same kind (half/full/sunset), then a label that contains the words.
 * Full day without a "full" label → the longest rate; half day → the shortest.
 */
export function matchRate<R extends { label: string; minutes: number }>(wanted: string | null | undefined, rates: R[]): R | null {
  if (!wanted || !rates.length) return null;
  const w = norm(wanted);
  const exact = rates.find((r) => norm(r.label) === w);
  if (exact) return exact;
  const kind = packageKind(wanted);
  if (kind) {
    const same = rates.find((r) => packageKind(r.label) === kind);
    if (same) return same;
    const sorted = [...rates].filter((r) => packageKind(r.label) !== "sunset").sort((a, b) => a.minutes - b.minutes);
    if (kind === "full" && sorted.length) return sorted[sorted.length - 1];
    if (kind === "half" && sorted.length) return sorted[0];
  }
  return rates.find((r) => norm(r.label).includes(w) || w.includes(norm(r.label))) ?? null;
}

/** Matches a boat by name, loosely ("the big one" won't match; "Reel Deal" matches "Reel Deal II"). */
export function matchBoat<B extends { name: string }>(wanted: string | null | undefined, boats: B[]): B | null {
  if (!wanted) return null;
  const w = norm(wanted);
  if (!w) return null;
  return (
    boats.find((b) => norm(b.name) === w) ??
    boats.find((b) => norm(b.name).includes(w) || w.includes(norm(b.name))) ??
    null
  );
}

/** Matches an add-on by name ("paddleboard" → "Paddle Board"). */
export function matchAddOn<A extends { name: string }>(wanted: string, addOns: A[]): A | null {
  const w = norm(wanted).replace(/ /g, "");
  if (!w) return null;
  const strip = (s: string) => norm(s).replace(/ /g, "").replace(/s$/, "");
  const ws = w.replace(/s$/, "");
  return addOns.find((a) => strip(a.name) === ws) ?? addOns.find((a) => strip(a.name).includes(ws) || ws.includes(strip(a.name))) ?? null;
}

/** The `count` open start times closest to the requested one (ties → earlier first), in time order. */
export function nearestTimes(requested: string, open: string[], count = 3): string[] {
  const want = minutesFromHHMM(requested);
  const uniq = [...new Set(open)];
  return uniq
    .map((t) => ({ t, d: Math.abs(minutesFromHHMM(t) - want), m: minutesFromHHMM(t) }))
    .sort((a, b) => a.d - b.d || a.m - b.m)
    .slice(0, count)
    .sort((a, b) => a.m - b.m)
    .map((x) => hhmmFromMinutes(x.m));
}

/** Rough start time for a time-of-day preference, used to rank suggestions. */
export function preferenceToTime(pref: string | null | undefined): string | null {
  if (!pref) return null;
  const n = norm(pref);
  if (/early/.test(n)) return "08:00";
  if (/morning|am\b/.test(n)) return "09:00";
  if (/afternoon|pm\b/.test(n)) return "13:00";
  if (/noon|lunch|midday/.test(n)) return "12:00";
  if (/sunset|evening/.test(n)) return "17:00";
  return null;
}

export function isHHMM(s: unknown): s is string {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/**
 * Pure helpers for campaigns (no database, no server imports) so they can be
 * unit tested and used in client components for live previews.
 */

export const MERGE_TAGS = [
  { tag: "firstName", label: "First name" },
  { tag: "lastName", label: "Last name" },
  { tag: "boat", label: "Boat" },
  { tag: "date", label: "Trip date" },
  { tag: "time", label: "Start time" },
  { tag: "manageLink", label: "Booking link" },
  { tag: "waiverLink", label: "Waiver link" },
  { tag: "waiverReminder", label: "Waiver reminder (only if guests haven't signed)" },
  { tag: "reviewLink", label: "Review link" },
  { tag: "tipLink", label: "Tip link" },
  { tag: "bookLink", label: "Book again link" },
  { tag: "address", label: "Meeting point" },
  { tag: "business", label: "Business name" },
] as const;

export type MergeData = Partial<Record<(typeof MERGE_TAGS)[number]["tag"], string>>;

/** Replaces {{tag}} (spaces allowed) with values. Unknown/missing tags become "". Cleans up doubled spaces. */
export function renderTemplate(template: string, data: MergeData): string {
  const out = template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_m, key: string) => (data as Record<string, string | undefined>)[key] ?? "");
  return out
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").replace(/ +([.,!?])/g, "$1").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Review link: explicit Google link, else one built from the Place ID, else the Facebook link. */
export function reviewLinkFrom(s: { googleReviewUrl?: string; googlePlaceId?: string; facebookReviewUrl?: string }): string {
  if (s.googleReviewUrl?.trim()) return s.googleReviewUrl.trim();
  if (s.googlePlaceId?.trim()) return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(s.googlePlaceId.trim())}`;
  return s.facebookReviewUrl?.trim() ?? "";
}

// ---------------------------------------------------------------- consent

export type ConsentCustomer = { marketingOptIn: boolean; smsOptOut: boolean; emailOptOut: boolean; phone: string; email: string };

/** Returns null when allowed, or a short reason it must be skipped. */
export function consentBlock(c: ConsentCustomer, channel: "sms" | "email", isMarketing: boolean, phoneValid: boolean): string | null {
  if (isMarketing && !c.marketingOptIn) return "Not opted in to promotions";
  if (channel === "sms") {
    if (c.smsOptOut) return "Opted out of texts";
    if (!phoneValid) return "No valid phone";
  } else {
    if (c.emailOptOut) return "Unsubscribed from email";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) return "No valid email";
  }
  return null;
}

export function channelsFor(channel: string): ("sms" | "email")[] {
  if (channel === "both") return ["sms", "email"];
  return channel === "email" ? ["email"] : ["sms"];
}

// ---------------------------------------------------------------- windows

const H = 3600000;
const D = 24 * H;

export const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
export const START_WORDS = ["START", "UNSTOP"];
/** "stop" → "stop", "start" → "start", anything else → null. */
export function optKeyword(text: string): "stop" | "start" | null {
  const t = text.trim().toUpperCase();
  if (STOP_WORDS.includes(t)) return "stop";
  if (START_WORDS.includes(t)) return "start";
  return null;
}

/** Trip starts within the next offsetHours (and hasn't started). */
export function inBeforeTripWindow(startsAt: Date, offsetHours: number, now: Date): boolean {
  const t = startsAt.getTime();
  return t > now.getTime() && t <= now.getTime() + offsetHours * H;
}

/** Trip ended at least offsetHours ago, but no more than offsetHours + 48h ago. */
export function inAfterTripWindow(endsAt: Date, offsetHours: number, now: Date): boolean {
  const age = now.getTime() - endsAt.getTime();
  return age >= offsetHours * H && age < offsetHours * H + 48 * H;
}

/** Booking was made at least offsetHours ago, within a 48h window. */
export function inAfterBookingWindow(createdAt: Date, offsetHours: number, now: Date): boolean {
  const age = now.getTime() - createdAt.getTime();
  return age >= offsetHours * H && age < offsetHours * H + 48 * H;
}

/** Last trip ended offsetHours/24 days ago, within a 7-day window. */
export function inWinBackWindow(lastTripEnd: Date, offsetHours: number, now: Date): boolean {
  const age = now.getTime() - lastTripEnd.getTime();
  const days = Math.round(offsetHours / 24);
  return age >= days * D && age < (days + 7) * D;
}

// ---------------------------------------------------------------- timing (friendly units)

export type TimingUnit = "hours" | "days";

export function timingFromHours(offsetHours: number): { value: number; unit: TimingUnit } {
  return offsetHours > 72 && offsetHours % 24 === 0 ? { value: offsetHours / 24, unit: "days" } : { value: offsetHours, unit: "hours" };
}

export function hoursFromTiming(value: number, unit: TimingUnit): number {
  const v = Math.max(0, Math.round(value * (unit === "days" ? 24 : 1)));
  return v;
}

const TRIGGER_WORD: Record<string, string> = {
  before_trip: "before trip",
  after_trip: "after trip",
  after_booking: "after booking",
  win_back: "after last trip",
};

export const TRIGGER_LABELS: Record<string, string> = {
  before_trip: "Before the trip",
  after_trip: "After the trip",
  after_booking: "After they book",
  win_back: "Win-back (time since last trip)",
  manual: "Send by hand (broadcast)",
};

/** e.g. "48 hours before trip", "300 days after last trip". */
export function describeTiming(trigger: string, offsetHours: number): string {
  if (trigger === "manual") return "Sent by hand";
  const t = trigger === "win_back" ? { value: Math.round(offsetHours / 24), unit: "days" as const } : timingFromHours(offsetHours);
  const unit = t.value === 1 ? t.unit.slice(0, -1) : t.unit;
  return `${t.value} ${unit} ${TRIGGER_WORD[trigger] ?? trigger}`;
}

// ---------------------------------------------------------------- segments

export type Segment = { tags?: string[]; minTrips?: number; lastTripWithinDays?: number; hasFutureBooking?: boolean };

export function parseSegment(json: string | null | undefined): Segment {
  try {
    const raw = JSON.parse(json || "{}") as Record<string, unknown>;
    const seg: Segment = {};
    if (Array.isArray(raw.tags)) {
      const tags = raw.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
      if (tags.length) seg.tags = tags;
    }
    if (typeof raw.minTrips === "number" && raw.minTrips > 0) seg.minTrips = Math.floor(raw.minTrips);
    if (typeof raw.lastTripWithinDays === "number" && raw.lastTripWithinDays > 0) seg.lastTripWithinDays = Math.floor(raw.lastTripWithinDays);
    if (typeof raw.hasFutureBooking === "boolean") seg.hasFutureBooking = raw.hasFutureBooking;
    return seg;
  } catch {
    return {};
  }
}

export function parseTags(tags: string): string[] {
  return [...new Set(tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

export type SegmentCustomer = { tags: string; trips: { status: string; startsAt: Date; endsAt: Date }[] };

const DONE = ["returned", "completed"];
const LIVE = ["pending", "confirmed", "checked_out"];

export function matchesSegment(c: SegmentCustomer, seg: Segment, now: Date): boolean {
  if (seg.tags?.length) {
    const mine = parseTags(c.tags);
    if (!seg.tags.some((t) => mine.includes(t))) return false;
  }
  const done = c.trips.filter((t) => DONE.includes(t.status));
  if (seg.minTrips && done.length < seg.minTrips) return false;
  if (seg.lastTripWithinDays) {
    const last = Math.max(0, ...done.map((t) => t.endsAt.getTime()));
    if (!last || now.getTime() - last > seg.lastTripWithinDays * D) return false;
  }
  if (seg.hasFutureBooking !== undefined) {
    const future = c.trips.some((t) => LIVE.includes(t.status) && t.startsAt.getTime() > now.getTime());
    if (future !== seg.hasFutureBooking) return false;
  }
  return true;
}

export function describeSegment(seg: Segment): string {
  const parts: string[] = [];
  if (seg.tags?.length) parts.push(`tagged ${seg.tags.join(" or ")}`);
  if (seg.minTrips) parts.push(`${seg.minTrips}+ trips`);
  if (seg.lastTripWithinDays) parts.push(`last trip within ${seg.lastTripWithinDays} days`);
  if (seg.hasFutureBooking === true) parts.push("has an upcoming booking");
  if (seg.hasFutureBooking === false) parts.push("no upcoming booking");
  return parts.length ? parts.join(", ") : "All customers";
}

// ---------------------------------------------------------------- email body

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text (with blank-line paragraphs) → simple HTML with clickable links. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#0B2E4F">${u}</a>`).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

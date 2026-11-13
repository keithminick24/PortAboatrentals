/**
 * Pure helpers for incidents, insurance and tow memberships (no server imports,
 * safe in client components and tests).
 */
import { INCIDENT_TYPES } from "./constants";

export const INCIDENT_TYPE_LABELS: Record<string, string> = Object.fromEntries(INCIDENT_TYPES.map(([k, l]) => [k, l]));
export const INCIDENT_TYPE_KEYS = INCIDENT_TYPES.map(([k]) => k) as string[];
export const INCIDENT_SEVERITIES = [
  ["low", "Low: minor, no one hurt"],
  ["medium", "Medium: damage or someone needed help"],
  ["high", "High: injury, serious damage or emergency"],
] as const;
export const INCIDENT_STATUSES = [
  ["open", "Open"],
  ["investigating", "Investigating"],
  ["closed", "Closed"],
] as const;
export const INCIDENT_STATUS_LABELS: Record<string, string> = Object.fromEntries(INCIDENT_STATUSES.map(([k, l]) => [k, l]));

/** Guests pick from a shorter, friendlier list. */
export const GUEST_INCIDENT_TYPES = [
  ["injury", "Someone got hurt"],
  ["collision", "Hit another boat, dock or object"],
  ["grounding", "Ran aground / stuck"],
  ["mechanical", "Boat problem (engine, battery, etc.)"],
  ["property_damage", "Something got damaged"],
  ["lost_item", "Lost item / person overboard"],
  ["complaint", "Complaint"],
  ["other", "Something else"],
] as const;

/** Official TPWD page on reporting boating accidents. */
export const TPWD_ACCIDENT_URL = "https://tpwd.texas.gov/fishboat/boat/responsible/accident_reports/";
export const TPWD_PHONE = "(512) 389-4848";

type IncidentLike = { type: string; severity: string; injuries: boolean; emsCalled?: boolean };

/**
 * Should we remind staff that a Texas boating accident report may be required?
 * TPWD asks for a report when there's a death, an injury needing more than first
 * aid, or more than $2,000 in damage. We can't know the dollar amount, so we
 * remind on injuries, collisions, groundings, medical calls and anything high severity.
 */
export function needsTpwdReminder(i: IncidentLike): boolean {
  return i.injuries || !!i.emsCalled || i.severity === "high" || ["injury", "collision", "grounding", "medical"].includes(i.type);
}

export type ExpiryState = "missing" | "expired" | "expiring" | "ok";

/** Status of something that expires (insurance, tow membership). `days` = warning window. */
export function expiryState(expiresAt: Date | null | undefined, now = new Date(), days = 45): ExpiryState {
  if (!expiresAt) return "missing";
  if (expiresAt.getTime() < now.getTime()) return "expired";
  if (expiresAt.getTime() - now.getTime() <= days * 86_400_000) return "expiring";
  return "ok";
}

export function daysUntil(d: Date, now = new Date()): number {
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

/**
 * Overall insurance state for a boat from its policies: "ok" if any policy is current
 * and not expiring soon; otherwise the best of the others. A policy with no
 * expiry date counts as "ok" (we can't tell), unless the boat has no policies.
 */
export function boatInsuranceState(policies: { expiresAt: Date | null }[], now = new Date(), days = 45): ExpiryState {
  if (policies.length === 0) return "missing";
  const states = policies.map((p) => (p.expiresAt ? expiryState(p.expiresAt, now, days) : "ok"));
  for (const s of ["ok", "expiring", "expired"] as const) if (states.includes(s)) return s;
  return "missing";
}

/** "tel:" link for a phone typed any way. */
export function telHref(phone: string): string {
  const t = phone.trim();
  return `tel:${t.startsWith("+") ? "+" : ""}${t.replace(/[^\d]/g, "")}`;
}

type Tone = "red" | "amber" | "slate";
export const statusTone = (s: string): Tone => (s === "open" ? "red" : s === "investigating" ? "amber" : "slate");
export const severityTone = (s: string): Tone => (s === "high" ? "red" : s === "medium" ? "amber" : "slate");

/** Service-interval math (pure; used by admin, dock and tests). */

export type ScheduleLike = {
  everyHours: number | null;
  everyDays: number | null;
  lastDoneAt: Date | null;
  lastDoneHours: number | null;
  createdAt: Date;
};

export type DueState = { state: "ok" | "soon" | "due"; hoursLeft: number | null; daysLeft: number | null; label: string };

const SOON_HOURS = 10;
const SOON_DAYS = 14;

export function dueStatus(s: ScheduleLike, engineHours: number, now = new Date()): DueState {
  const hoursLeft = s.everyHours != null ? (s.lastDoneHours ?? 0) + s.everyHours - engineHours : null;
  const since = s.lastDoneAt ?? s.createdAt;
  const daysLeft = s.everyDays != null ? Math.floor((since.getTime() + s.everyDays * 86400000 - now.getTime()) / 86400000) : null;
  const due = (hoursLeft != null && hoursLeft <= 0) || (daysLeft != null && daysLeft <= 0);
  const soon = !due && ((hoursLeft != null && hoursLeft <= SOON_HOURS) || (daysLeft != null && daysLeft <= SOON_DAYS));
  const parts: string[] = [];
  if (hoursLeft != null) parts.push(hoursLeft <= 0 ? `${Math.abs(hoursLeft).toFixed(1)} hrs overdue` : `${hoursLeft.toFixed(1)} hrs left`);
  if (daysLeft != null) parts.push(daysLeft <= 0 ? `${Math.abs(daysLeft)} days overdue` : `${daysLeft} days left`);
  return { state: due ? "due" : soon ? "soon" : "ok", hoursLeft, daysLeft, label: parts.join(" · ") || "No interval set" };
}

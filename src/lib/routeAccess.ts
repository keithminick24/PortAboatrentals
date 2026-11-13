/**
 * Which permission a URL needs. Pure + edge-safe: used by middleware (and tests).
 * Returns null for pages that need no sign-in check here (login pages).
 */
import { can, homeFor, type Permission } from "./permissions";

/** Longest/most specific prefixes first. Paths are matched without the leading "/api". */
const PREFIXES: [string, Permission][] = [
  ["/admin/settings", "settings"],
  ["/admin/accounting", "accounting"],
  ["/admin/profit", "reports"],
  ["/admin/budget", "reports"],
  ["/admin/reports", "reports"],
  ["/admin/payroll", "payroll"],
  ["/admin/campaigns", "marketing"],
  ["/admin/reviews", "marketing"],
  ["/admin/phone-orders", "phoneOrders"],
  ["/admin/fees", "pricing"],
  ["/admin/addons", "pricing"],
  ["/admin/contracts", "pricing"],
  ["/admin/schedule", "ops"],
  ["/admin/incidents", "ops"],
  ["/admin/maintenance", "ops"],
  ["/admin/boats", "ops"],
  ["/admin/customers", "ops"],
  ["/admin/messages", "ops"],
  ["/admin/bookings", "ops"],
  ["/admin/calendar", "ops"],
];

/** API endpoints the dock (crew) app calls. Anyone with dock access may use them. */
const DOCK_APIS = ["/api/admin/photos", "/api/admin/dock", "/api/admin/incidents/photos"];

function under(path: string, prefix: string) {
  return path === prefix || path.startsWith(prefix + "/");
}

export function requiredPermission(pathname: string): Permission | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (under(path, "/admin/login") || under(path, "/dock/login")) return null;
  if (under(path, "/dock")) return "dock";
  if (DOCK_APIS.some((p) => under(path, p))) return "dock";
  const isApi = under(path, "/api/admin");
  const p = isApi ? path.slice(4) : path;
  if (!under(p, "/admin")) return null;
  for (const [prefix, perm] of PREFIXES) if (under(p, prefix)) return perm;
  // /admin itself, and anything not listed: office operations.
  return "ops";
}

export type AccessResult = { ok: true } | { ok: false; redirectTo: string; api: boolean };

/** Decide what to do with a signed-in user of `role` at `pathname`. */
export function checkAccess(role: string, pathname: string): AccessResult {
  const perm = requiredPermission(pathname);
  if (!perm || can(role, perm)) return { ok: true };
  return { ok: false, redirectTo: homeFor(role), api: pathname.startsWith("/api/") };
}

/** Is it OK to send a freshly signed-in `role` to `next`? */
export function allowedNext(role: string, next: string): boolean {
  if (!next.startsWith("/admin") && !next.startsWith("/dock")) return false;
  if (next.startsWith("//")) return false;
  return checkAccess(role, next.split("?")[0]).ok;
}

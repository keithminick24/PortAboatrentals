/**
 * Roles and what each can do. Edge-safe (no server imports) so middleware and
 * client components can use it too.
 *
 *   owner      = Admin: everything
 *   manager    = runs operations, pricing, crew schedule, marketing
 *   accounting = money: expenses, Xero, profitability, budgets, payroll export
 *   staff      = Office: bookings, customers, texts, check-in/out
 *   dock       = Crew: dock app, own schedule, time clock, incident reports
 */
export const ROLES = [
  { key: "owner", label: "Admin" },
  { key: "manager", label: "Manager" },
  { key: "accounting", label: "Accounting" },
  { key: "staff", label: "Office" },
  { key: "dock", label: "Crew" },
] as const;
export type Role = (typeof ROLES)[number]["key"];
export const ROLE_LABELS: Record<string, string> = Object.fromEntries(ROLES.map((r) => [r.key, r.label]));

export const PERMISSIONS = {
  ops: ["owner", "manager", "staff"], // bookings, calendar, customers, check-in/out, messages
  money: ["owner", "manager"], // refunds, deposit capture
  pricing: ["owner", "manager"], // boats, rates, fees, add-ons, contracts, insurance, tow
  settings: ["owner"], // settings and staff logins
  marketing: ["owner", "manager"], // campaigns, reviews
  phoneOrders: ["owner", "manager", "staff"],
  schedule: ["owner", "manager"], // build schedule, approve time off, edit time
  payroll: ["owner", "accounting", "manager"], // hours & tips export
  accounting: ["owner", "accounting"], // expenses, Xero, cost assumptions, budgets
  reports: ["owner", "manager", "accounting"],
  incidents: ["owner", "manager"], // review/close incidents
  dock: ["owner", "manager", "staff", "dock"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export function can(role: string | undefined | null, perm: Permission): boolean {
  return !!role && (PERMISSIONS[perm] as readonly string[]).includes(role);
}

/** Where each role lands after signing in. */
export function homeFor(role: string): string {
  if (role === "dock") return "/dock";
  if (role === "accounting") return "/admin/accounting";
  return "/admin";
}

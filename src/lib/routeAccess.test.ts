import { describe, expect, it } from "vitest";
import { allowedNext, checkAccess, requiredPermission } from "./routeAccess";

describe("requiredPermission", () => {
  it.each([
    ["/admin", "ops"],
    ["/admin/", "ops"],
    ["/admin/settings", "settings"],
    ["/admin/accounting/xero", "accounting"],
    ["/admin/profit", "reports"],
    ["/admin/budget", "reports"],
    ["/admin/reports", "reports"],
    ["/admin/payroll", "payroll"],
    ["/admin/campaigns/new", "marketing"],
    ["/admin/reviews", "marketing"],
    ["/admin/phone-orders", "phoneOrders"],
    ["/admin/fees", "pricing"],
    ["/admin/addons", "pricing"],
    ["/admin/contracts", "pricing"],
    ["/admin/schedule", "ops"],
    ["/admin/incidents/abc", "ops"],
    ["/admin/boats/abc", "ops"],
    ["/admin/bookings/new", "ops"],
    ["/admin/calendar", "ops"],
    ["/admin/somethingnew", "ops"],
    ["/dock", "dock"],
    ["/dock/incidents/new", "dock"],
    ["/api/admin/photos", "dock"],
    ["/api/admin/photos/123", "dock"],
    ["/api/admin/dock/123/status", "dock"],
    ["/api/admin/incidents/photos", "dock"],
    ["/api/admin/accounting/export", "accounting"],
    ["/api/admin/insurance/1/document", "ops"],
  ])("%s -> %s", (path, perm) => {
    expect(requiredPermission(path)).toBe(perm);
  });

  it("does not confuse similar prefixes", () => {
    expect(requiredPermission("/admin/settingsx")).toBe("ops");
    expect(requiredPermission("/admin/feesy")).toBe("ops");
  });

  it("leaves login pages open", () => {
    expect(requiredPermission("/admin/login")).toBeNull();
    expect(requiredPermission("/dock/login")).toBeNull();
  });
});

describe("checkAccess", () => {
  it("lets the owner go anywhere", () => {
    for (const p of ["/admin", "/admin/settings", "/admin/accounting", "/dock", "/api/admin/photos"]) {
      expect(checkAccess("owner", p).ok).toBe(true);
    }
  });

  it("keeps crew on the dock app", () => {
    expect(checkAccess("dock", "/dock").ok).toBe(true);
    expect(checkAccess("dock", "/api/admin/photos").ok).toBe(true);
    expect(checkAccess("dock", "/api/admin/dock/x/status").ok).toBe(true);
    expect(checkAccess("dock", "/admin")).toEqual({ ok: false, redirectTo: "/dock", api: false });
    expect(checkAccess("dock", "/api/admin/insurance/x/document")).toEqual({ ok: false, redirectTo: "/dock", api: true });
  });

  it("sends accounting to the money pages", () => {
    expect(checkAccess("accounting", "/admin/accounting").ok).toBe(true);
    expect(checkAccess("accounting", "/admin/reports").ok).toBe(true);
    expect(checkAccess("accounting", "/admin/payroll").ok).toBe(true);
    expect(checkAccess("accounting", "/admin")).toEqual({ ok: false, redirectTo: "/admin/accounting", api: false });
    expect(checkAccess("accounting", "/dock").ok).toBe(false);
  });

  it("limits office staff", () => {
    expect(checkAccess("staff", "/admin/bookings").ok).toBe(true);
    expect(checkAccess("staff", "/admin/phone-orders").ok).toBe(true);
    expect(checkAccess("staff", "/admin/settings")).toEqual({ ok: false, redirectTo: "/admin", api: false });
    expect(checkAccess("staff", "/admin/fees").ok).toBe(false);
    expect(checkAccess("staff", "/admin/reports").ok).toBe(false);
  });

  it("lets managers run the business but not settings or accounting", () => {
    expect(checkAccess("manager", "/admin/fees").ok).toBe(true);
    expect(checkAccess("manager", "/admin/payroll").ok).toBe(true);
    expect(checkAccess("manager", "/admin/settings").ok).toBe(false);
    expect(checkAccess("manager", "/admin/accounting").ok).toBe(false);
  });

  it("never redirects a role to a page it can't open", () => {
    for (const role of ["owner", "manager", "accounting", "staff", "dock"]) {
      const r = checkAccess(role, "/admin/settings");
      if (!r.ok) expect(checkAccess(role, r.redirectTo).ok).toBe(true);
    }
  });
});

describe("allowedNext", () => {
  it("checks the destination", () => {
    expect(allowedNext("staff", "/admin/bookings?x=1")).toBe(true);
    expect(allowedNext("staff", "/admin/settings")).toBe(false);
    expect(allowedNext("dock", "/admin")).toBe(false);
    expect(allowedNext("owner", "https://evil.com")).toBe(false);
    expect(allowedNext("owner", "")).toBe(false);
  });
});

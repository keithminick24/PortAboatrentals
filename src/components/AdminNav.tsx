"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { can, ROLE_LABELS, type Permission } from "@/lib/permissions";

type Item = { href: string; label: string; perm: Permission };
type Group = { label: string; items: Item[] };

/** Office menu, grouped. Items a role can't use are hidden. */
const MENU: (Item | Group)[] = [
  { href: "/admin", label: "Today", perm: "ops" },
  { href: "/admin/calendar", label: "Calendar", perm: "ops" },
  {
    label: "Bookings",
    items: [
      { href: "/admin/bookings", label: "All bookings", perm: "ops" },
      { href: "/admin/phone-orders", label: "Phone requests", perm: "phoneOrders" },
      { href: "/admin/messages", label: "Messages", perm: "ops" },
      { href: "/admin/incidents", label: "Incidents", perm: "ops" },
    ],
  },
  {
    label: "Customers",
    items: [
      { href: "/admin/customers", label: "Customers", perm: "ops" },
      { href: "/admin/campaigns", label: "Campaigns", perm: "marketing" },
      { href: "/admin/reviews", label: "Reviews", perm: "marketing" },
    ],
  },
  {
    label: "Crew",
    items: [
      { href: "/admin/schedule", label: "Schedule", perm: "ops" },
      { href: "/admin/payroll", label: "Hours & tips", perm: "payroll" },
    ],
  },
  {
    label: "Fleet",
    items: [
      { href: "/admin/boats", label: "Boats", perm: "ops" },
      { href: "/admin/maintenance", label: "Maintenance", perm: "ops" },
      { href: "/admin/addons", label: "Add-ons", perm: "pricing" },
      { href: "/admin/fees", label: "Fees", perm: "pricing" },
      { href: "/admin/contracts", label: "Contracts", perm: "pricing" },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/admin/reports", label: "Sales reports", perm: "reports" },
      { href: "/admin/profit", label: "Profit & breakeven", perm: "reports" },
      { href: "/admin/budget", label: "Budget & forecast", perm: "reports" },
      { href: "/admin/accounting", label: "Expenses & Xero", perm: "accounting" },
    ],
  },
  { href: "/admin/settings", label: "Settings", perm: "settings" },
];

const isGroup = (x: Item | Group): x is Group => "items" in x;

export default function AdminNav({ userName, role, logout }: { userName: string; role: string; logout: () => Promise<void> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const active = (href: string) => (href === "/admin" ? path === "/admin" : path.startsWith(href));
  const visible = MENU.map((m) => (isGroup(m) ? { ...m, items: m.items.filter((i) => can(role, i.perm)) } : m)).filter((m) =>
    isGroup(m) ? m.items.length > 0 : can(role, m.perm),
  );

  return (
    <header className="sticky top-0 z-30 bg-brand text-white shadow">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/admin" className="font-bold tracking-wide">PORT A · OPS</Link>
        <nav className="hidden items-center gap-0.5 lg:flex" onMouseLeave={() => setMenu(null)}>
          {visible.map((m) =>
            isGroup(m) ? (
              <div key={m.label} className="relative" onMouseEnter={() => setMenu(m.label)}>
                <button
                  type="button"
                  onClick={() => setMenu((x) => (x === m.label ? null : m.label))}
                  className={`rounded-md px-3 py-1.5 text-sm ${m.items.some((i) => active(i.href)) ? "bg-white/20 font-semibold" : "hover:bg-white/10"}`}
                >
                  {m.label} ▾
                </button>
                {menu === m.label && (
                  <div className="absolute left-0 top-full z-40 min-w-48 rounded-lg bg-white py-1 text-sm text-slate-800 shadow-lg">
                    {m.items.map((i) => (
                      <Link key={i.href} href={i.href} onClick={() => setMenu(null)} className={`block px-4 py-2 hover:bg-slate-50 ${active(i.href) ? "font-semibold text-brand" : ""}`}>
                        {i.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <Link key={m.href} href={m.href} className={`rounded-md px-3 py-1.5 text-sm ${active(m.href) ? "bg-white/20 font-semibold" : "hover:bg-white/10"}`}>
                {m.label}
              </Link>
            ),
          )}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/dock" className="hidden rounded-md border border-white/40 px-2.5 py-1.5 text-[13px] hover:bg-white/10 sm:block">Dock app</Link>
          {can(role, "ops") && (
            <Link href="/admin/bookings/new" className="rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-brand hover:bg-brand-sand">
              + Booking
            </Link>
          )}
          <form action={logout} className="hidden lg:block">
            <button className="text-sm opacity-80 hover:opacity-100" title={`${userName} · ${ROLE_LABELS[role] ?? role}`}>Sign out</button>
          </form>
          <button className="lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">☰</button>
        </div>
      </div>
      {open && (
        <nav className="space-y-2 border-t border-white/20 px-4 py-3 lg:hidden">
          {visible.map((m) =>
            isGroup(m) ? (
              <div key={m.label}>
                <div className="px-3 text-xs uppercase tracking-wide text-white/60">{m.label}</div>
                <div className="grid grid-cols-2 gap-1">
                  {m.items.map((i) => (
                    <Link key={i.href} href={i.href} onClick={() => setOpen(false)} className={`rounded-md px-3 py-2 text-sm ${active(i.href) ? "bg-white/20" : ""}`}>{i.label}</Link>
                  ))}
                </div>
              </div>
            ) : (
              <Link key={m.href} href={m.href} onClick={() => setOpen(false)} className={`block rounded-md px-3 py-2 text-sm ${active(m.href) ? "bg-white/20" : ""}`}>{m.label}</Link>
            ),
          )}
          <form action={logout}>
            <button className="px-3 py-2 text-sm opacity-80">Sign out ({userName} · {ROLE_LABELS[role] ?? role})</button>
          </form>
        </nav>
      )}
    </header>
  );
}

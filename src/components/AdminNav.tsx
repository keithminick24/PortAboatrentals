"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  ["/admin", "Today"],
  ["/admin/calendar", "Calendar"],
  ["/admin/bookings", "Bookings"],
  ["/admin/messages", "Messages"],
  ["/admin/customers", "Customers"],
  ["/admin/boats", "Fleet"],
  ["/admin/maintenance", "Maintenance"],
  ["/admin/addons", "Add-ons"],
  ["/admin/fees", "Fees"],
  ["/admin/contracts", "Contracts"],
  ["/admin/reports", "Reports"],
  ["/admin/settings", "Settings"],
] as const;

export default function AdminNav({ userName, logout }: { userName: string; logout: () => Promise<void> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/admin" ? path === "/admin" : path.startsWith(href));
  return (
    <header className="sticky top-0 z-30 bg-brand text-white shadow">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/admin" className="font-bold tracking-wide">PORT A · OPS</Link>
        <nav className="hidden items-center gap-0.5 xl:flex">
          {LINKS.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={`rounded-md px-2.5 py-1.5 text-[13px] ${active(href) ? "bg-white/20 font-semibold" : "hover:bg-white/10"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/dock" className="hidden rounded-md border border-white/40 px-2.5 py-1.5 text-[13px] hover:bg-white/10 sm:block">Dock app</Link>
          <Link href="/admin/bookings/new" className="rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-brand hover:bg-brand-sand">
            + Booking
          </Link>
          <form action={logout} className="hidden xl:block">
            <button className="text-sm opacity-80 hover:opacity-100" title={`Signed in as ${userName}`}>Sign out</button>
          </form>
          <button className="xl:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">☰</button>
        </div>
      </div>
      {open && (
        <nav className="grid grid-cols-2 gap-1 border-t border-white/20 px-4 py-3 xl:hidden">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)} className={`rounded-md px-3 py-2 text-sm ${active(href) ? "bg-white/20" : ""}`}>
              {label}
            </Link>
          ))}
          <form action={logout}>
            <button className="px-3 py-2 text-sm opacity-80">Sign out ({userName})</button>
          </form>
        </nav>
      )}
    </header>
  );
}

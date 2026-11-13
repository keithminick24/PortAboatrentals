import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { dockLogout } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dock", robots: { index: false } };
export const viewport = { width: "device-width", initialScale: 1, themeColor: "#0B2E4F" };

export default async function DockLayout({ children }: { children: React.ReactNode }) {
  const s = await requireStaff();
  return (
    <div className="min-h-screen bg-slate-100 pb-16">
      <header className="sticky top-0 z-30 bg-brand text-white shadow">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
          <Link href="/dock" className="font-bold tracking-wide">PORT A · DOCK</Link>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/dock/boats" className="rounded-md bg-white/15 px-2.5 py-1">Boats</Link>
            <Link href="/dock/schedule" className="rounded-md bg-white/15 px-2.5 py-1">Schedule</Link>
            {s.role !== "dock" && <Link href="/admin" className="rounded-md bg-white/15 px-2.5 py-1">Office</Link>}
            <form action={dockLogout}><button className="text-white/80">Sign out</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-4">{children}</main>
    </div>
  );
}

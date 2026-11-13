import Link from "next/link";
import { getSettings } from "@/lib/db";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const s = await getSettings();
  return (
    <div className="flex min-h-screen flex-col bg-brand-sand/40">
      <header className="bg-brand text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link href="/" className="text-lg font-bold tracking-wide">
            PORT A BOAT RENTALS
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <a href="https://www.portaboatrentals.com" className="hidden opacity-90 hover:opacity-100 sm:inline">
              Main site
            </a>
            <a href={`tel:${s.phone.replace(/[^0-9]/g, "")}`} className="hidden opacity-90 hover:opacity-100 sm:inline">
              {s.phone}
            </a>
            <Link href="/book" className="rounded-lg bg-white px-4 py-2 font-semibold text-brand hover:bg-brand-sand">
              Book now
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-6 text-sm text-slate-500">
          <span>© {new Date().getFullYear()} {s.businessName} · {s.address}</span>
          <span>
            Questions? Call <a className="text-brand" href={`tel:${s.phone.replace(/[^0-9]/g, "")}`}>{s.phone}</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

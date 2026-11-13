import Link from "next/link";
import { getSettings } from "@/lib/db";
import { SITE } from "@/lib/siteConfig";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const s = await getSettings();
  const tel = `tel:${s.phone.replace(/[^0-9]/g, "")}`;
  const half = Math.ceil(SITE.nav.length / 2);
  return (
    <div className="site flex min-h-screen flex-col bg-brand-sand">
      <header className="relative z-20 bg-white shadow-sm">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-4 px-4 md:h-24">
          <nav className="hidden flex-1 items-center gap-7 font-display text-[15px] font-semibold text-brand lg:flex">
            {SITE.nav.slice(0, half).map((l) => (
              <a key={l.href} href={l.href} className="hover:text-teal">{l.label}</a>
            ))}
          </nav>
          <Link href="/" className="shrink-0 lg:-mb-10" aria-label={s.businessName}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SITE.logo} alt={s.businessName} className="h-16 w-auto rounded-full bg-white md:h-20 lg:h-[108px] lg:p-1 lg:shadow-md" />
          </Link>
          <nav className="flex flex-1 items-center justify-end gap-7 font-display text-[15px] font-semibold text-brand">
            {SITE.nav.slice(half).map((l) => (
              <a key={l.href} href={l.href} className="hidden hover:text-teal lg:inline">{l.label}</a>
            ))}
            <a href={tel} className="hidden text-brand hover:text-teal sm:inline lg:hidden">{s.phone}</a>
            <Link href="/book" className="rounded-lg bg-cta px-5 py-2.5 font-button text-[15px] font-semibold text-white shadow-sm hover:bg-cta-dark md:px-8 md:py-3">
              Reserve Now
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="bg-brand-dark text-white">
        <div className="mx-auto max-w-6xl px-4 py-10 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SITE.logo} alt={s.businessName} className="mx-auto h-28 w-auto rounded-full bg-white p-1" />
          <p className="mt-4 text-lg">{SITE.tagline}</p>
          <nav className="mt-5 flex flex-wrap justify-center gap-x-1 gap-y-2 text-[15px]">
            {SITE.footer.map((l, i) => (
              <span key={l.href} className="flex items-center">
                {i > 0 && <span className="mx-3 h-4 w-px bg-white/40" />}
                <a href={l.href} className="hover:text-teal">{l.label}</a>
              </span>
            ))}
          </nav>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-8">
            <div className="flex gap-3">
              {SITE.social.map((x) => (
                <a key={x.label} href={x.href} aria-label={x.label} className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-brand-dark hover:bg-teal">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden><path d={x.icon} /></svg>
                </a>
              ))}
            </div>
            <a href={tel} className="flex items-center gap-2 text-lg hover:text-teal">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-cta" fill="currentColor" aria-hidden><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8Z" /></svg>
              {s.phone} (BOAT)
            </a>
          </div>
        </div>
        <div className="border-t border-white/15">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-2 px-4 py-4 text-sm font-semibold">
            <span>© {new Date().getFullYear()} {s.businessName.toUpperCase()} All rights reserved.</span>
            <span className="flex gap-3">
              <a href="/my-bookings" className="hover:text-teal">My bookings</a>
              <span className="h-4 w-px self-center bg-white/40" />
              <a href={SITE.footer[6].href} className="hover:text-teal">Privacy Policy</a>
              <span className="h-4 w-px self-center bg-white/40" />
              <a href={SITE.footer[7].href} className="hover:text-teal">Terms of Service</a>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

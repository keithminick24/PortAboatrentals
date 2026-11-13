import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/money";
import { fmtDuration } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function Home() {
  const boats = await prisma.boat.findMany({
    where: { status: "available" },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { rates: { where: { active: true }, orderBy: { minutes: "asc" } } },
  });
  return (
    <>
      <section className="bg-gradient-to-b from-brand to-brand-light text-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <h1 className="max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">Your day on the bay starts here.</h1>
          <p className="mt-4 max-w-xl text-lg opacity-90">
            Clean, fueled tritoon pontoons with full shade. Pick your date, sign your agreement, and pay online in a few minutes.
          </p>
          <Link href="/book" className="mt-8 inline-block rounded-lg bg-white px-6 py-3 text-lg font-semibold text-brand hover:bg-brand-sand">
            Check availability
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="mb-6 text-2xl font-bold text-slate-900">Our fleet</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {boats.map((b) => (
            <div key={b.id} className="card overflow-hidden">
              {b.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.imageUrl} alt={b.name} className="h-48 w-full object-cover" />
              ) : (
                <div className="flex h-48 items-center justify-center bg-gradient-to-br from-sky-200 to-brand-light text-5xl">⛵</div>
              )}
              <div className="card-pad">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-lg font-semibold">{b.name}</h3>
                  <span className="muted">Up to {b.capacity} guests</span>
                </div>
                <p className="mt-2 line-clamp-3 text-sm text-slate-600">{b.description}</p>
                <ul className="mt-3 space-y-1 text-sm">
                  {b.rates.map((r) => (
                    <li key={r.id} className="flex justify-between">
                      <span>{r.label}</span>
                      <span className="font-medium">
                        {fmtMoney(r.priceCents)}
                        <span className="muted"> · {fmtDuration(r.minutes)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <Link href={`/book?boat=${b.id}`} className="btn-primary mt-4 w-full">
                  Book {b.name}
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-12 sm:grid-cols-3">
          {[
            ["1. Reserve", "Choose your boat, date, and time. Add floats, paddle boards, or a cooler."],
            ["2. Sign & pay", "Sign the rental agreement online and pay securely. Guests can sign their waivers from their phones."],
            ["3. Hit the water", "Arrive 20 minutes early for a quick safety briefing and we'll get you on your way."],
          ].map(([t, d]) => (
            <div key={t}>
              <h3 className="text-lg font-semibold text-brand">{t}</h3>
              <p className="mt-1 text-sm text-slate-600">{d}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

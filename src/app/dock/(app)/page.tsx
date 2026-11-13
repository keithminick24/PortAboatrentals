import Link from "next/link";
import { prisma } from "@/lib/db";
import { addDays, fmtTime, todayLocal, zonedToUtc, fmtDateStr } from "@/lib/time";
import FlashMessage from "@/components/FlashMessage";
import ClockCard from "@/components/crew/ClockCard";

export default async function DockHome({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const today = todayLocal();
  const start = zonedToUtc(today, "00:00");
  const end = zonedToUtc(addDays(today, 1), "00:00");
  const now = new Date();
  const include = { boat: true, customer: true, rate: true, _count: { select: { damage: { where: { status: "needs_check" } } } } } as const;

  const [departing, onWater, returned] = await Promise.all([
    prisma.booking.findMany({ where: { status: "confirmed", startsAt: { gte: start, lt: end } }, include, orderBy: { startsAt: "asc" } }),
    prisma.booking.findMany({ where: { status: "checked_out" }, include, orderBy: { endsAt: "asc" } }),
    prisma.booking.findMany({ where: { status: "returned", returnedAt: { gte: start } }, include, orderBy: { returnedAt: "desc" } }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Today</h1>
        <div className="text-sm text-slate-500">{fmtDateStr(today, { weekday: "long", month: "long" })}</div>
      </div>
      <FlashMessage msg={sp.msg} err={sp.err} />
      <ClockCard />
      <Link href="/dock/incidents/new" className="block rounded-xl border border-rose-200 bg-rose-50 p-3 text-center font-semibold text-rose-800">⚠ Report incident</Link>

      <Section title="On the water" empty="No boats out right now.">
        {onWater.map((b) => {
          const overdue = b.endsAt < now;
          return (
            <Card key={b.id} href={`/dock/b/${b.id}`} tone={overdue ? "red" : "blue"}>
              <Row boat={b.boat.name} who={`${b.customer.firstName} ${b.customer.lastName}`} />
              <div className={`text-sm ${overdue ? "font-semibold text-rose-700" : "text-slate-600"}`}>
                {overdue ? `⚠ Overdue, was due ${fmtTime(b.endsAt)}` : `Due back ${fmtTime(b.endsAt)}`}
              </div>
              <Cta>Check in →</Cta>
            </Card>
          );
        })}
      </Section>

      <Section title="Going out today" empty="No more departures today.">
        {departing.map((b) => (
          <Card key={b.id} href={`/dock/b/${b.id}`} tone="slate">
            <Row boat={b.boat.name} who={`${b.customer.firstName} ${b.customer.lastName}`} />
            <div className="text-sm text-slate-600">
              {fmtTime(b.startsAt)} – {fmtTime(b.endsAt)} · {b.partySize} guests · {b.rate?.label}
            </div>
            {b._count.damage > 0 && <div className="text-sm font-semibold text-amber-700">⚠ {b._count.damage} spot(s) to check</div>}
            <Cta>Check out →</Cta>
          </Card>
        ))}
      </Section>

      <Section title="Back today" empty="Nothing returned yet.">
        {returned.map((b) => (
          <Card key={b.id} href={`/dock/b/${b.id}`} tone="green">
            <Row boat={b.boat.name} who={`${b.customer.firstName} ${b.customer.lastName}`} />
            <div className="text-sm text-slate-600">Returned {b.returnedAt ? fmtTime(b.returnedAt) : ""}</div>
          </Card>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-500">{empty}</div> : <div className="space-y-2">{children}</div>}
    </section>
  );
}

function Card({ href, tone, children }: { href: string; tone: "slate" | "blue" | "red" | "green"; children: React.ReactNode }) {
  const tones = { slate: "border-l-slate-400", blue: "border-l-sky-500", red: "border-l-rose-500", green: "border-l-emerald-500" };
  return (
    <Link href={href} className={`block rounded-xl border border-l-4 border-slate-200 bg-white p-4 shadow-sm active:bg-slate-50 ${tones[tone]}`}>
      {children}
    </Link>
  );
}

function Row({ boat, who }: { boat: string; who: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="text-lg font-bold">{boat}</div>
      <div className="truncate text-sm text-slate-600">{who}</div>
    </div>
  );
}

function Cta({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 text-right text-sm font-semibold text-brand">{children}</div>;
}

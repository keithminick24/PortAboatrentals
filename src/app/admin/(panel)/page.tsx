import Link from "next/link";
import { prisma } from "@/lib/db";
import { activeTemplates, occupyingWhere } from "@/lib/bookings";
import { fmtMoney } from "@/lib/money";
import { addDays, fmtDateStr, fmtTime, isValidDateStr, todayLocal, zonedToUtc } from "@/lib/time";
import { DEPOSIT_LABELS } from "@/lib/constants";
import { PageHeader, Pill, Stat, StatusBadge, Empty } from "@/components/ui";
import PhoneOrdersAlert from "@/components/admin/PhoneOrdersAlert";
import RiskAlerts from "@/components/admin/RiskAlerts";
import TelemetryAlerts from "@/components/admin/TelemetryAlerts";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  const date = isValidDateStr(sp.date) ? sp.date : todayLocal();
  const start = zonedToUtc(date, "00:00");
  const end = zonedToUtc(addDays(date, 1), "00:00");
  const now = new Date();

  const [bookings, onWater, weekCount, paymentsToday, needsDeposit, returnedOpen, templates] = await Promise.all([
    prisma.booking.findMany({
      where: { AND: [occupyingWhere(now), { startsAt: { gte: start, lt: end } }] },
      orderBy: { startsAt: "asc" },
      include: {
        boat: true,
        customer: true,
        rate: true,
        signatures: { include: { template: true } },
        _count: { select: { photos: true } },
        addOns: { include: { addOn: true } },
      },
    }),
    prisma.booking.count({ where: { status: "checked_out" } }),
    prisma.booking.count({
      where: { startsAt: { gte: start, lt: zonedToUtc(addDays(date, 7), "00:00") }, status: { in: ["confirmed", "pending"] } },
    }),
    prisma.payment.findMany({ where: { createdAt: { gte: start, lt: end }, kind: { in: ["charge", "refund", "deposit_capture"] } } }),
    prisma.booking.count({ where: { status: "confirmed", depositStatus: { in: ["none", "card_saved"] }, startsAt: { gte: now, lt: new Date(now.getTime() + 48 * 3600000) } } }),
    prisma.booking.findMany({ where: { status: "returned" }, include: { boat: true, customer: true }, orderBy: { returnedAt: "asc" } }),
    activeTemplates(),
  ]);
  const requiredNames = templates.filter((t) => t.required).map((t) => t.name);
  const revenue = paymentsToday.reduce((s, p) => s + (p.kind === "refund" ? -p.amountCents : p.amountCents), 0);
  const overdue = await prisma.booking.findMany({
    where: { status: "checked_out", endsAt: { lt: now } },
    include: { boat: true, customer: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={date === todayLocal() ? "Today" : fmtDateStr(date, { year: "numeric" })}
        subtitle={fmtDateStr(date, { weekday: "long", month: "long", year: "numeric" })}
        actions={
          <>
            <Link className="btn-secondary btn-sm" href={`/admin?date=${addDays(date, -1)}`}>← Prev</Link>
            <Link className="btn-secondary btn-sm" href="/admin">Today</Link>
            <Link className="btn-secondary btn-sm" href={`/admin?date=${addDays(date, 1)}`}>Next →</Link>
          </>
        }
      />
      <PhoneOrdersAlert />
      <RiskAlerts />
      <TelemetryAlerts />

      {overdue.length > 0 && (
        <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-4">
          <div className="font-semibold text-rose-900">⚠ Overdue returns</div>
          <ul className="mt-1 text-sm">
            {overdue.map((b) => (
              <li key={b.id}>
                <Link className="underline" href={`/admin/bookings/${b.id}`}>{b.boat.name}</Link> — {b.customer.firstName}{" "}
                {b.customer.lastName} ({b.customer.phone}), due {fmtTime(b.endsAt)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Trips this day" value={bookings.length} />
        <Stat label="On the water now" value={onWater} />
        <Stat label="Collected this day (net)" value={fmtMoney(revenue)} href="/admin/reports" />
        <Stat label="Upcoming 7 days" value={weekCount} href="/admin/calendar?view=week" />
      </div>

      {(needsDeposit > 0 || returnedOpen.length > 0) && (
        <div className="card card-pad space-y-2 text-sm">
          <div className="font-semibold">Needs attention</div>
          {needsDeposit > 0 && <div>💳 {needsDeposit} trip(s) in the next 48 hrs without a deposit hold yet (auto-holds run 24 hrs before).</div>}
          {returnedOpen.map((b) => (
            <div key={b.id}>
              🔍 <Link className="text-brand underline" href={`/admin/bookings/${b.id}`}>{b.boat.name} · {b.customer.lastName}</Link> returned — review
              after-photos and release/capture deposit.
            </div>
          ))}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3 font-semibold">Schedule</div>
        {bookings.length === 0 ? (
          <div className="p-5"><Empty>No trips booked for this day.</Empty></div>
        ) : (
          <div className="divide-y divide-slate-100">
            {bookings.map((b) => {
              const signed = requiredNames.every((n) => b.signatures.some((s) => s.isPrimary && s.template.name === n));
              const guests = b.signatures.filter((s) => !s.isPrimary).length;
              return (
                <Link key={b.id} href={`/admin/bookings/${b.id}`} className="flex flex-wrap items-center gap-4 px-5 py-3 hover:bg-slate-50">
                  <div className="w-28 shrink-0">
                    <div className="font-semibold">{fmtTime(b.startsAt)}</div>
                    <div className="muted">to {fmtTime(b.endsAt)}</div>
                  </div>
                  <div className="min-w-40 flex-1">
                    <div className="font-medium">{b.customer.firstName} {b.customer.lastName} · {b.partySize} guests</div>
                    <div className="muted">
                      {b.boat.name} · {b.rate?.label}
                      {b.addOns.length > 0 && ` · ${b.addOns.map((a) => `${a.quantity}× ${a.addOn.name}`).join(", ")}`}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge status={b.status} />
                    <Pill tone={signed ? "green" : "red"}>{signed ? "Agreement ✓" : "Not signed"}</Pill>
                    <Pill tone="slate">Waivers {guests}/{Math.max(0, b.partySize - 1)}</Pill>
                    <Pill tone={b.paidCents >= b.totalCents ? "green" : "amber"}>
                      {b.paidCents >= b.totalCents ? "Paid" : `Owes ${fmtMoney(b.totalCents - b.paidCents)}`}
                    </Pill>
                    <Pill tone={b.depositStatus === "held" ? "green" : "slate"}>{DEPOSIT_LABELS[b.depositStatus]}</Pill>
                    <Pill tone="blue">📷 {b._count.photos}</Pill>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

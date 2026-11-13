import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/money";
import { addDays, isValidDateStr, localDate, minutesFromHHMM, todayLocal, zonedToUtc } from "@/lib/time";
import { getSettings } from "@/lib/db";
import { PageHeader, Stat } from "@/components/ui";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const today = todayLocal();
  const from = isValidDateStr(sp.from) ? sp.from : today.slice(0, 8) + "01";
  const to = isValidDateStr(sp.to) ? sp.to : today;
  const start = zonedToUtc(from, "00:00");
  const end = zonedToUtc(addDays(to, 1), "00:00");
  const settings = await getSettings();

  const [payments, bookings, boats] = await Promise.all([
    prisma.payment.findMany({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.booking.findMany({
      where: { startsAt: { gte: start, lt: end }, status: { notIn: ["cancelled"] } },
      include: { boat: true, addOns: { include: { addOn: true } }, fees: true },
    }),
    prisma.boat.findMany({ where: { status: { not: "retired" } }, orderBy: { sortOrder: "asc" } }),
  ]);
  const sum = (k: string) => payments.filter((p) => p.kind === k).reduce((s, p) => s + p.amountCents, 0);
  const gross = sum("charge");
  const refunds = sum("refund");
  const damage = sum("deposit_capture");
  const tax = bookings.reduce((s, b) => s + b.taxCents, 0);

  let days = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) days++;
  const openMin = minutesFromHHMM(settings.closeTime) - minutesFromHHMM(settings.openTime);

  const byBoat = boats.map((boat) => {
    const bs = bookings.filter((b) => b.boatId === boat.id);
    const minutes = bs.reduce((s, b) => s + (b.endsAt.getTime() - b.startsAt.getTime()) / 60000, 0);
    return {
      boat,
      trips: bs.length,
      revenue: bs.reduce((s, b) => s + b.subtotalCents + b.addOnsCents, 0),
      utilization: days && openMin ? minutes / (days * openMin) : 0,
    };
  });
  const addOnTotals = new Map<string, { qty: number; cents: number }>();
  for (const b of bookings)
    for (const a of b.addOns) {
      const cur = addOnTotals.get(a.addOn.name) ?? { qty: 0, cents: 0 };
      addOnTotals.set(a.addOn.name, { qty: cur.qty + a.quantity, cents: cur.cents + a.quantity * a.priceCents });
    }
  // Fee revenue by fee name (added fees on top; included fees carved out of rental)
  const feeTotals = new Map<string, { mode: string; cents: number }>();
  for (const b of bookings)
    for (const fl of b.fees) {
      const cur = feeTotals.get(fl.name) ?? { mode: fl.mode, cents: 0 };
      feeTotals.set(fl.name, { mode: fl.mode, cents: cur.cents + fl.amountCents });
    }
  const convenience = bookings.reduce((s, b) => s + b.convenienceFeeCents, 0);
  const rentalNet = bookings.reduce((s, b) => s + b.subtotalCents - b.includedFeesCents, 0);
  const byDow = [0, 0, 0, 0, 0, 0, 0];
  for (const b of bookings) byDow[new Date(localDate(b.startsAt) + "T12:00:00Z").getUTCDay()]++;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        actions={
          <form className="flex gap-2">
            <input type="date" name="from" defaultValue={from} className="input" />
            <input type="date" name="to" defaultValue={to} className="input" />
            <button className="btn-secondary">Run</button>
          </form>
        }
      />
      <div className="-mt-3 flex flex-wrap gap-2">
        <a href={`/admin/profit?from=${from}&to=${to}`} className="btn-secondary btn-sm">Profit &amp; breakeven →</a>
        <a href="/admin/budget" className="btn-secondary btn-sm">Budget &amp; forecast →</a>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Trips" value={bookings.length} />
        <Stat label="Collected" value={fmtMoney(gross)} />
        <Stat label="Refunded" value={fmtMoney(refunds)} />
        <Stat label="Deposit captures" value={fmtMoney(damage)} />
        <Stat label="Sales tax (trips in range)" value={fmtMoney(tax)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card card-pad">
          <h2 className="h2 mb-3">By boat</h2>
          <table className="table">
            <thead><tr><th>Boat</th><th className="text-right">Trips</th><th className="text-right">Revenue</th><th>Utilization</th></tr></thead>
            <tbody>
              {byBoat.map((r) => (
                <tr key={r.boat.id}>
                  <td>{r.boat.name}</td>
                  <td className="text-right">{r.trips}</td>
                  <td className="text-right">{fmtMoney(r.revenue)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 rounded bg-slate-100"><div className="h-2 rounded bg-brand" style={{ width: `${Math.min(100, r.utilization * 100)}%` }} /></div>
                      <span className="text-xs">{Math.round(r.utilization * 100)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted mt-2">Utilization = booked hours ÷ open hours in range.</p>
        </div>
        <div className="space-y-6">
          <div className="card card-pad">
            <h2 className="h2 mb-3">Revenue breakdown (trips in range)</h2>
            <table className="table">
              <tbody>
                <tr><td>Boat rental (excluding included fees)</td><td className="text-right">{fmtMoney(rentalNet)}</td></tr>
                {[...feeTotals].map(([name, v]) => (
                  <tr key={name}><td>{name} <span className="muted text-xs">({v.mode === "included" ? "included in price" : "added"})</span></td><td className="text-right">{fmtMoney(v.cents)}</td></tr>
                ))}
                <tr><td>Add-ons</td><td className="text-right">{fmtMoney(bookings.reduce((s, b) => s + b.addOnsCents, 0))}</td></tr>
                <tr><td>Card convenience fees</td><td className="text-right">{fmtMoney(convenience)}</td></tr>
                <tr><td>Sales tax</td><td className="text-right">{fmtMoney(tax)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card card-pad">
            <h2 className="h2 mb-3">Add-ons sold</h2>
            {addOnTotals.size === 0 ? <p className="muted">None in range.</p> : (
              <table className="table">
                <tbody>
                  {[...addOnTotals].map(([name, v]) => (
                    <tr key={name}><td>{name}</td><td className="text-right">{v.qty}</td><td className="text-right">{fmtMoney(v.cents)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card card-pad">
            <h2 className="h2 mb-3">Trips by day of week</h2>
            <div className="flex h-32 items-end gap-2">
              {byDow.map((n, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <div className="text-xs">{n}</div>
                  <div className="w-full rounded-t bg-brand-light" style={{ height: `${(n / Math.max(1, ...byDow)) * 90}px` }} />
                  <div className="text-xs text-slate-500">{"SMTWTFS"[i]}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

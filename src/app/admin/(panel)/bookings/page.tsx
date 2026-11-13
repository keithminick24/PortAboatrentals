import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BOOKING_STATUSES, STATUS_LABELS } from "@/lib/constants";
import { fmtMoney } from "@/lib/money";
import { addDays, fmtRange, isValidDateStr, todayLocal, zonedToUtc } from "@/lib/time";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; from?: string; to?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const from = isValidDateStr(sp.from) ? sp.from : todayLocal();
  const to = isValidDateStr(sp.to) ? sp.to : addDays(from, 30);
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim();
  const where: Prisma.BookingWhereInput = {
    ...(q
      ? {
          OR: [
            { code: { contains: q.toUpperCase() } },
            { customer: { email: { contains: q.toLowerCase() } } },
            { customer: { lastName: { contains: q } } },
            { customer: { firstName: { contains: q } } },
            { customer: { phone: { contains: q } } },
          ],
        }
      : { startsAt: { gte: zonedToUtc(from, "00:00"), lt: zonedToUtc(addDays(to, 1), "00:00") } }),
    ...(sp.status ? { status: sp.status } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: { boat: true, customer: true, rate: true },
      orderBy: { startsAt: q ? "desc" : "asc" },
      take: 50,
      skip: (page - 1) * 50,
    }),
    prisma.booking.count({ where }),
  ]);

  return (
    <div>
      <PageHeader title="Bookings" subtitle={`${total} found`} actions={<Link href="/admin/bookings/new" className="btn-primary">New booking</Link>} />
      <form className="card card-pad mb-4 grid gap-3 sm:grid-cols-5">
        <input name="q" defaultValue={q} placeholder="Name, email, phone, or code" className="input sm:col-span-2" />
        <select name="status" defaultValue={sp.status ?? ""} className="input">
          <option value="">All statuses</option>
          {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <div className="flex gap-2 sm:col-span-2">
          <input type="date" name="from" defaultValue={from} className="input" />
          <input type="date" name="to" defaultValue={to} className="input" />
          <button className="btn-secondary">Filter</button>
        </div>
      </form>
      {rows.length === 0 ? (
        <Empty>No bookings match.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr><th>When</th><th>Customer</th><th>Boat</th><th>Status</th><th className="text-right">Total</th><th className="text-right">Paid</th><th>Code</th></tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td><Link href={`/admin/bookings/${b.id}`} className="font-medium text-brand hover:underline">{fmtRange(b.startsAt, b.endsAt)}</Link></td>
                  <td>{b.customer.firstName} {b.customer.lastName}<div className="muted">{b.customer.phone}</div></td>
                  <td>{b.boat.name}<div className="muted">{b.rate?.label}</div></td>
                  <td><StatusBadge status={b.status} /></td>
                  <td className="text-right">{fmtMoney(b.totalCents)}</td>
                  <td className="text-right">{fmtMoney(b.paidCents - b.refundedCents)}</td>
                  <td className="font-mono text-xs">{b.code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > page * 50 && (
        <div className="mt-4 text-center">
          <Link className="btn-secondary" href={`/admin/bookings?${new URLSearchParams({ ...(sp as Record<string, string>), page: String(page + 1) })}`}>Next page</Link>
        </div>
      )}
    </div>
  );
}

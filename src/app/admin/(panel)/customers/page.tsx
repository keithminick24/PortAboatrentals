import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/time";
import { fmtMoney } from "@/lib/money";
import { PageHeader } from "@/components/ui";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const term = q?.trim();
  const customers = await prisma.customer.findMany({
    where: term
      ? { OR: [{ firstName: { contains: term } }, { lastName: { contains: term } }, { email: { contains: term.toLowerCase() } }, { phone: { contains: term } }] }
      : {},
    include: { bookings: { select: { paidCents: true, refundedCents: true, startsAt: true, status: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return (
    <div>
      <PageHeader title="Customers" subtitle={`${customers.length} shown`} />
      <form className="mb-4 flex gap-2">
        <input name="q" defaultValue={term} placeholder="Search name, email, phone" className="input max-w-sm" />
        <button className="btn-secondary">Search</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Name</th><th>Contact</th><th className="text-right">Trips</th><th className="text-right">Lifetime spend</th><th>Last trip</th></tr></thead>
          <tbody>
            {customers.map((c) => {
              const trips = c.bookings.filter((b) => b.status !== "cancelled");
              const spend = c.bookings.reduce((s, b) => s + b.paidCents - b.refundedCents, 0);
              const last = trips.map((b) => b.startsAt).sort((a, b) => +b - +a)[0];
              return (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td><Link href={`/admin/customers/${c.id}`} className="font-medium text-brand hover:underline">{c.firstName} {c.lastName}</Link></td>
                  <td>{c.email}<div className="muted">{c.phone}</div></td>
                  <td className="text-right">{trips.length}</td>
                  <td className="text-right">{fmtMoney(spend)}</td>
                  <td>{last ? fmtDate(last) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

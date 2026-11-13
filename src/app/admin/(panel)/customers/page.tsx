import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/time";
import { fmtMoney } from "@/lib/money";
import { PageHeader, Pill } from "@/components/ui";
import { parseTags } from "@/lib/campaignLogic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string; optin?: string }> }) {
  const { q, tag, optin } = await searchParams;
  const term = q?.trim();
  const tagFilter = tag?.trim().toLowerCase() || "";
  const tagRows = await prisma.customer.findMany({ where: { tags: { not: "" } }, select: { tags: true } });
  const allTags = [...new Set(tagRows.flatMap((r) => parseTags(r.tags)))].sort();
  const found = await prisma.customer.findMany({
    where: {
      AND: [
        term
          ? { OR: [{ firstName: { contains: term } }, { lastName: { contains: term } }, { email: { contains: term.toLowerCase() } }, { phone: { contains: term } }] }
          : {},
        // Rough DB filter; exact tag match is checked below
        tagFilter ? { tags: { contains: tagFilter } } : {},
        optin === "yes" ? { marketingOptIn: true } : optin === "no" ? { marketingOptIn: false } : {},
      ],
    },
    include: { bookings: { select: { paidCents: true, refundedCents: true, startsAt: true, status: true } } },
    orderBy: { createdAt: "desc" },
    take: tagFilter ? 1000 : 200,
  });
  const customers = (tagFilter ? found.filter((c) => parseTags(c.tags).includes(tagFilter)) : found).slice(0, 200);
  return (
    <div>
      <PageHeader title="Customers" subtitle={`${customers.length} shown`} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={term} placeholder="Search name, email, phone" className="input max-w-sm" />
        <select name="tag" defaultValue={tagFilter} className="input w-auto">
          <option value="">All tags</option>
          {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select name="optin" defaultValue={optin ?? ""} className="input w-auto">
          <option value="">Promotions: any</option>
          <option value="yes">Opted in</option>
          <option value="no">Not opted in</option>
        </select>
        <button className="btn-secondary">Search</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Name</th><th>Contact</th><th className="text-right">Trips</th><th className="text-right">Lifetime spend</th><th>Last trip</th><th>Tags</th><th>Promotions</th></tr></thead>
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
                  <td><div className="flex flex-wrap gap-1">{parseTags(c.tags).map((t) => <Pill key={t}>{t}</Pill>)}</div></td>
                  <td>
                    {c.marketingOptIn ? <Pill tone="green">Opted in</Pill> : <span className="muted">—</span>}
                    {c.smsOptOut && <div className="text-xs text-rose-700">No texts</div>}
                    {c.emailOptOut && <div className="text-xs text-amber-800">No email</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

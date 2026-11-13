import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { fmtRange } from "@/lib/time";
import { fmtMoney } from "@/lib/money";
import { PageHeader, StatusBadge } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import { saveCustomer } from "../../../actions";

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const c = await prisma.customer.findUnique({
    where: { id },
    include: { bookings: { include: { boat: true }, orderBy: { startsAt: "desc" } } },
  });
  if (!c) notFound();
  const damageHistory = c.bookings.filter((b) => b.damageNotes || b.depositCapturedCents > 0);
  return (
    <div className="space-y-6">
      <PageHeader title={`${c.firstName} ${c.lastName}`} subtitle={<Link href="/admin/customers" className="hover:underline">← Customers</Link>} />
      <FlashMessage msg={sp.msg} />
      <div className="grid gap-6 lg:grid-cols-3">
        <form action={saveCustomer} className="card card-pad space-y-3">
          <input type="hidden" name="id" value={c.id} />
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">First</label><input name="firstName" className="input" defaultValue={c.firstName} /></div>
            <div><label className="label">Last</label><input name="lastName" className="input" defaultValue={c.lastName} /></div>
          </div>
          <div><label className="label">Phone</label><input name="phone" className="input" defaultValue={c.phone} /></div>
          <div className="text-sm">Email: {c.email}</div>
          <div><label className="label">Staff notes (e.g. repeat guest, do-not-rent)</label><textarea name="notes" rows={4} className="input" defaultValue={c.notes} /></div>
          <button className="btn-secondary btn-sm">Save</button>
        </form>
        <div className="space-y-4 lg:col-span-2">
          {damageHistory.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
              <b>Damage / deposit history</b>
              <ul className="mt-1 list-disc pl-5">
                {damageHistory.map((b) => <li key={b.id}>{b.code}: {b.damageNotes || "—"} {b.depositCapturedCents > 0 && `(captured ${fmtMoney(b.depositCapturedCents)})`}</li>)}
              </ul>
            </div>
          )}
          <div className="card overflow-x-auto">
            <table className="table">
              <thead><tr><th>When</th><th>Boat</th><th>Status</th><th className="text-right">Paid</th></tr></thead>
              <tbody>
                {c.bookings.map((b) => (
                  <tr key={b.id}>
                    <td><Link className="text-brand hover:underline" href={`/admin/bookings/${b.id}`}>{fmtRange(b.startsAt, b.endsAt)}</Link></td>
                    <td>{b.boat.name}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td className="text-right">{fmtMoney(b.paidCents - b.refundedCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

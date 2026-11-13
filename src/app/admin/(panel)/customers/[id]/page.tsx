import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { fmtDateTime, fmtRange } from "@/lib/time";
import { parseTags } from "@/lib/campaignLogic";
import { saveCustomerCrm } from "../actions";
import { fmtMoney } from "@/lib/money";
import { PageHeader, Pill, StatusBadge } from "@/components/ui";
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
  const [sends, texts, allTags] = await Promise.all([
    prisma.campaignSend.findMany({ where: { customerId: c.id }, orderBy: { createdAt: "desc" }, take: 30, include: { campaign: { select: { name: true } } } }),
    prisma.message.findMany({ where: { customerId: c.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.customer.findMany({ where: { tags: { not: "" } }, select: { tags: true }, take: 500 }),
  ]);
  const tagSuggestions = [...new Set(allTags.flatMap((x) => parseTags(x.tags)))].sort();
  const timeline = [
    ...sends.map((s) => ({ id: `c${s.id}`, at: s.createdAt, kind: s.channel === "sms" ? "Text" : "Email", what: `Campaign: ${s.campaign.name}`, status: s.status, note: s.error ?? "" })),
    ...texts.map((m) => ({ id: `m${m.id}`, at: m.createdAt, kind: m.direction === "in" ? "Text in" : "Text out", what: m.body, status: m.status, note: m.error ?? (m.sentBy ? `by ${m.sentBy}` : "") })),
  ]
    .sort((x, y) => +y.at - +x.at)
    .slice(0, 40);
  const damageHistory = c.bookings.filter((b) => b.damageNotes || b.depositCapturedCents > 0);
  return (
    <div className="space-y-6">
      <PageHeader title={`${c.firstName} ${c.lastName}`} subtitle={<Link href="/admin/customers" className="hover:underline">← Customers</Link>} />
      <FlashMessage msg={sp.msg} />
      {(c.smsOptOut || c.emailOptOut) && (
        <div className="flex flex-wrap gap-2">
          {c.smsOptOut && <Pill tone="red">No texts (replied STOP)</Pill>}
          {c.emailOptOut && <Pill tone="amber">Unsubscribed from email</Pill>}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
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
        <form action={saveCustomerCrm} className="card card-pad space-y-3">
          <input type="hidden" name="id" value={c.id} />
          <h2 className="h2">Tags &amp; messages</h2>
          <div>
            <label className="label">Tags (comma separated)</label>
            <input name="tags" className="input" defaultValue={parseTags(c.tags).join(", ")} placeholder="vip, local, repeat" list="tag-suggestions" />
            <datalist id="tag-suggestions">{tagSuggestions.map((t) => <option key={t} value={t} />)}</datalist>
            {tagSuggestions.length > 0 && <p className="muted mt-1 text-xs">In use: {tagSuggestions.join(", ")}</p>}
          </div>
          <div><label className="label">How they found us</label><input name="source" className="input" defaultValue={c.source} placeholder="Google, friend, hotel…" /></div>
          <div className="space-y-1 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="marketingOptIn" defaultChecked={c.marketingOptIn} /> OK to send deals &amp; promotions</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="smsOptOut" defaultChecked={c.smsOptOut} /> Stopped texts (replied STOP)</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="emailOptOut" defaultChecked={c.emailOptOut} /> Unsubscribed from email</label>
          </div>
          <p className="muted text-xs">Only turn on promotions if the guest asked for them. If they replied STOP, only un-check it if they texted START.</p>
          <button className="btn-secondary btn-sm">Save</button>
        </form>
        </div>
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
          <div className="card overflow-x-auto">
            <div className="card-pad pb-0"><h2 className="h2">Messages &amp; campaigns</h2></div>
            {timeline.length ? (
              <table className="table">
                <thead><tr><th>When</th><th>Type</th><th>Message</th><th>Result</th></tr></thead>
                <tbody>
                  {timeline.map((t) => (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap">{fmtDateTime(t.at)}</td>
                      <td>{t.kind}</td>
                      <td className="max-w-md"><div className="line-clamp-2 whitespace-pre-wrap">{t.what}</div></td>
                      <td>
                        <Pill tone={["sent", "delivered", "received"].includes(t.status) ? "green" : ["failed", "undelivered"].includes(t.status) ? "red" : "slate"}>{t.status}</Pill>
                        {t.note && <div className="muted text-xs">{t.note}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="card-pad muted">No texts or campaign messages yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

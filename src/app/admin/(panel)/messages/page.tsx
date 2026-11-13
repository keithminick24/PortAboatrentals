import Link from "next/link";
import { prisma, getSettings } from "@/lib/db";
import { isQuoEnabled, templates, toE164 } from "@/lib/messaging";
import { appUrl } from "@/lib/mail";
import { fmtDateTime, fmtRange } from "@/lib/time";
import { PageHeader, Notice } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import Thread from "@/components/messages/Thread";
import ReplyBox from "@/components/messages/ReplyBox";
import AutoRefresh from "@/components/messages/AutoRefresh";
import { sendMessageAction } from "../../actions";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ phone?: string; to?: string; err?: string }> }) {
  const sp = await searchParams;
  const recent = await prisma.message.findMany({ orderBy: { createdAt: "desc" }, take: 500, include: { customer: true } });
  const convos = new Map<string, { phone: string; last: (typeof recent)[number]; unread: number; name: string | null }>();
  for (const m of recent) {
    const c = convos.get(m.phone) ?? { phone: m.phone, last: m, unread: 0, name: null };
    if (m.direction === "in" && !m.readAt) c.unread++;
    c.name ??= m.customer ? `${m.customer.firstName} ${m.customer.lastName}` : null;
    convos.set(m.phone, c);
  }
  const selected = sp.phone ? toE164(sp.phone) ?? sp.phone : [...convos.keys()][0];
  const thread = selected ? await prisma.message.findMany({ where: { phone: selected }, orderBy: { createdAt: "asc" } }) : [];
  if (selected) await prisma.message.updateMany({ where: { phone: selected, direction: "in", readAt: null }, data: { readAt: new Date() } });
  const customerId = thread.find((m) => m.customerId)?.customerId;
  const booking = customerId
    ? await prisma.booking.findFirst({
        where: { customerId, status: { in: ["pending", "confirmed", "checked_out", "returned"] } },
        orderBy: { startsAt: "asc" },
        include: { boat: true, customer: true },
      })
    : null;
  const settings = await getSettings();
  const tpl = booking
    ? templates(
        {
          code: booking.code,
          boatName: booking.boat.name,
          when: fmtRange(booking.startsAt, booking.endsAt),
          manageUrl: await appUrl(`/b/${booking.accessToken}`),
          waiverUrl: await appUrl(`/w/${booking.waiverToken}`),
          firstName: booking.customer.firstName,
        },
        settings.businessName,
      )
    : [];
  const name = selected ? convos.get(selected)?.name : null;

  return (
    <div className="space-y-4">
      <AutoRefresh seconds={10} />
      <PageHeader title="Messages" subtitle="Texts with guests through your Quo number. Replies from the Quo app show up here too." />
      <FlashMessage err={sp.err} />
      {!isQuoEnabled() && (
        <Notice tone="warn">Test mode: texts are saved here but not sent. Add your Quo API key and phone number ID to send for real (see README).</Notice>
      )}
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="card overflow-hidden">
          <form className="flex gap-2 border-b border-slate-200 p-3">
            <input name="phone" className="input" placeholder="New text to phone #" defaultValue={sp.to ?? ""} />
            <button className="btn-secondary btn-sm">Open</button>
          </form>
          <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
            {[...convos.values()].map((c) => (
              <li key={c.phone}>
                <Link href={`/admin/messages?phone=${encodeURIComponent(c.phone)}`} className={`block px-4 py-3 hover:bg-slate-50 ${c.phone === selected ? "bg-sky-50" : ""}`}>
                  <div className="flex justify-between gap-2">
                    <span className="truncate font-medium">{c.name ?? c.phone}</span>
                    {c.unread > 0 && <span className="rounded-full bg-rose-600 px-2 text-xs font-semibold text-white">{c.unread}</span>}
                  </div>
                  <div className="truncate text-xs text-slate-500">{c.last.direction === "out" ? "You: " : ""}{c.last.body}</div>
                  <div className="text-[10px] text-slate-400">{fmtDateTime(c.last.createdAt)}</div>
                </Link>
              </li>
            ))}
            {convos.size === 0 && <li className="p-4 text-sm text-slate-500">No conversations yet.</li>}
          </ul>
        </div>
        <div className="card card-pad flex flex-col gap-4">
          {selected ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
                <div className="font-semibold">{name ?? selected} <span className="muted font-normal">{name ? selected : ""}</span></div>
                {booking && <Link className="text-sm text-brand underline" href={`/admin/bookings/${booking.id}`}>{booking.boat.name} · {fmtRange(booking.startsAt, booking.endsAt)}</Link>}
              </div>
              <div className="flex max-h-[55vh] flex-col-reverse overflow-y-auto pr-1"><Thread messages={thread} /></div>
              <ReplyBox
                action={sendMessageAction}
                hidden={{ phone: selected, customerId: customerId ?? "", bookingId: booking?.id ?? "", returnTo: `/admin/messages?phone=${encodeURIComponent(selected)}` }}
                templates={tpl}
              />
            </>
          ) : (
            <div className="py-10 text-center text-sm text-slate-500">Pick a conversation, or type a phone number to start one.</div>
          )}
        </div>
      </div>
    </div>
  );
}

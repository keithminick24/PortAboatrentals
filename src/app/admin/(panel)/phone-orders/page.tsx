import Link from "next/link";
import { prisma, getSettings } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getAvailabilityForDate } from "@/lib/bookings";
import { isPhoneAiEnabled } from "@/lib/phoneOrders";
import { matchAddOn, parseExtracted } from "@/lib/phoneOrderHelpers";
import { isQuoEnabled } from "@/lib/messaging";
import { fmtDateTime, fmtHHMM, isValidDateStr, todayLocal } from "@/lib/time";
import { PageHeader, Pill, Empty, Notice } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import ReviewForm from "./ReviewForm";
import { pasteCallAction, reopenPhoneOrderAction, savePhoneHoldHours } from "./actions";

export const dynamic = "force-dynamic";

function confidenceTone(c: number | null | undefined) {
  if (c == null) return "slate" as const;
  return c >= 0.8 ? ("green" as const) : c >= 0.5 ? ("amber" as const) : ("red" as const);
}

export default async function PhoneOrdersPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const session = await requirePermission("phoneOrders");
  const sp = await searchParams;
  const [settings, open, history, addOns] = await Promise.all([
    getSettings(),
    prisma.phoneOrder.findMany({ where: { status: { in: ["needs_review", "failed"] } }, orderBy: { createdAt: "desc" } }),
    prisma.phoneOrder.findMany({
      where: { status: { in: ["approved", "rejected"] } },
      orderBy: { reviewedAt: "desc" },
      take: 30,
      include: { booking: { select: { id: true, code: true, status: true } } },
    }),
    prisma.addOn.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  // Availability for each date we need to show, loaded once per date.
  const slotCache = new Map<string, Awaited<ReturnType<typeof getAvailabilityForDate>>["boats"]>();
  const slotsFor = async (date: string) => {
    if (!slotCache.has(date)) slotCache.set(date, (await getAvailabilityForDate(date)).boats);
    return slotCache.get(date)!.map((b) => ({
      boatId: b.boatId,
      name: b.name,
      capacity: b.capacity,
      rates: b.rates.map((r) => ({ id: r.id, label: r.label, priceCents: r.priceCents, startTimes: r.startTimes })),
    }));
  };

  const forms = await Promise.all(
    open.map(async (o) => {
      const x = parseExtracted(o.extracted);
      const date = isValidDateStr(x.date) ? x.date : todayLocal();
      const slots = await slotsFor(date);
      const boat = slots.find((b) => b.boatId === x.boatId) ?? slots[0];
      const rate = boat?.rates.find((r) => r.id === x.rateId) ?? boat?.rates[0];
      const times = rate?.startTimes ?? [];
      const wanted = x.startTime && times.includes(x.startTime) ? x.startTime : (x.suggestions ?? []).find((t) => times.includes(t)) ?? times[0] ?? "";
      const qty = new Map<string, number>();
      for (const a of x.addOns ?? []) {
        const m = matchAddOn(a.name, addOns);
        if (m) qty.set(m.id, (qty.get(m.id) ?? 0) + a.quantity);
      }
      return {
        order: o,
        x,
        props: {
          id: o.id,
          customerName: o.customerName,
          phone: o.phone,
          email: o.email,
          date,
          boatRate: boat && rate ? `${boat.boatId}|${rate.id}` : "",
          startTime: wanted,
          partySize: x.partySize ?? 1,
          notes: [x.notes, x.timePreference && !x.startTime ? `Asked for: ${x.timePreference}` : ""].filter(Boolean).join("\n"),
          addOns: addOns.map((a) => ({ id: a.id, name: a.name, priceCents: a.priceCents, quantity: qty.get(a.id) ?? 0 })),
          slots,
          businessName: settings.businessName,
        },
      };
    }),
  );

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Phone booking requests"
        subtitle="When Quo's AI answers a call and the caller wants a boat, the request lands here. Check it, then approve to hold the boat and text the guest a link to sign and pay."
      />
      <FlashMessage msg={sp.msg} err={sp.err} />
      {!isPhoneAiEnabled() && (
        <Notice tone="warn">AI reading is off (no ANTHROPIC_API_KEY). Calls still show up here with Quo&apos;s summary and transcript; fill in the details by hand.</Notice>
      )}
      {!isQuoEnabled() && <Notice tone="info">Quo isn&apos;t connected, so texts are saved in Messages but not actually sent.</Notice>}

      <section className="space-y-4">
        <h2 className="h2">Needs review ({open.length})</h2>
        {!forms.length && <Empty>No phone requests waiting. New ones from Quo&apos;s AI show up here automatically.</Empty>}
        {forms.map(({ order: o, x, props }) => (
          <div key={o.id} id={`order-${o.id}`} className="card card-pad space-y-3 scroll-mt-20">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1">
                <div className="font-semibold">{o.customerName || "Unknown caller"} · {o.phone}</div>
                <div className="muted text-xs">Called {fmtDateTime(o.createdAt)}{o.callId.startsWith("manual-") ? " · pasted by staff" : ""}</div>
              </div>
              {x.confidence != null && <Pill tone={confidenceTone(x.confidence)}>AI {Math.round(x.confidence * 100)}% sure</Pill>}
              {o.status === "failed" && <Pill tone="red">AI couldn&apos;t read it</Pill>}
              {o.problem && <Pill tone="amber">Check this</Pill>}
            </div>
            {o.summary && <p className="whitespace-pre-line text-sm text-slate-700">{o.summary}</p>}
            {o.problem && <Notice tone="warn">{o.problem}</Notice>}
            {(x.date || x.startTime || x.boatName || x.rateLabel) && (
              <div className="muted text-xs">
                Caller asked for: {[x.rateLabel, x.boatName, x.date, x.startTime ? fmtHHMM(x.startTime) : x.timePreference, x.partySize ? `${x.partySize} people` : ""].filter(Boolean).join(" · ")}
              </div>
            )}
            {o.transcript && (
              <details className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <summary className="cursor-pointer font-medium">Transcript</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap font-sans text-slate-700">{o.transcript}</pre>
              </details>
            )}
            <ReviewForm {...props} />
          </div>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <form action={pasteCallAction} className="card card-pad space-y-3">
          <h2 className="h2">Paste a call</h2>
          <p className="muted text-sm">Took a call yourself, or testing? Paste what was said and the AI fills in the request.</p>
          <div><label className="label">Caller&apos;s phone</label><input name="phone" className="input" placeholder="361-555-0123" required /></div>
          <div><label className="label">What was said</label><textarea name="transcript" rows={6} className="input" placeholder="Caller: Hi, can I get a half day boat this Saturday morning for 8 people? My name's Jane Smith…" required /></div>
          <button className="btn-primary btn-sm">Add request</button>
        </form>
        <div className="space-y-4">
          {can(session.role, "pricing") && (
            <form action={savePhoneHoldHours} className="card card-pad space-y-3">
              <h2 className="h2">Phone booking hold</h2>
              <p className="muted text-sm">After you approve, the boat is held this long for the guest to sign and pay. Then it&apos;s released.</p>
              <div className="flex items-end gap-2">
                <div><label className="label">Hours</label><input name="phoneHoldHours" type="number" min={1} max={168} className="input w-24" defaultValue={settings.phoneHoldHours} /></div>
                <button className="btn-primary btn-sm">Save</button>
              </div>
            </form>
          )}
          <div className="card card-pad space-y-2 text-sm">
            <h2 className="h2">How to connect Quo</h2>
            <ol className="list-decimal space-y-1 pl-5 text-slate-700">
              <li>In Quo, turn on the AI agent for your number and have it collect: name, date, start time, half/full day or sunset, how many people, extras, and email.</li>
              <li>In Quo → Webhooks, send <b>call.summary.completed</b> and <b>call.transcript.completed</b> to <code>/api/quo/webhook</code> (same webhook as texts is fine).</li>
              <li>Set ANTHROPIC_API_KEY so the app can read each call. Requests then appear here within a minute of the call ending.</li>
            </ol>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="h2">Recent</h2>
        {!history.length ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <div className="card divide-y divide-slate-100">
            {history.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{o.customerName || "Unknown caller"} · {o.phone}</div>
                  <div className="muted truncate text-xs">
                    {o.reviewedAt ? fmtDateTime(o.reviewedAt) : fmtDateTime(o.createdAt)}
                    {o.reviewedBy ? ` · ${o.reviewedBy === "AI" ? "skipped by AI" : o.reviewedBy}` : ""}
                    {o.status === "rejected" && o.problem ? ` · ${o.problem}` : ""}
                  </div>
                </div>
                {o.status === "approved" ? (
                  <>
                    <Pill tone="green">Approved</Pill>
                    {o.booking && <Link className="text-sky-700 underline" href={`/admin/bookings/${o.booking.id}`}>{o.booking.code}</Link>}
                  </>
                ) : (
                  <>
                    <Pill tone={o.reviewedBy === "AI" ? "slate" : "red"}>{o.reviewedBy === "AI" ? "Not a booking" : "Rejected"}</Pill>
                    <form action={reopenPhoneOrderAction}>
                      <input type="hidden" name="id" value={o.id} />
                      <button className="btn-secondary btn-sm">Review anyway</button>
                    </form>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

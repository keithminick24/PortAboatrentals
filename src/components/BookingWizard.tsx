"use client";

import { useEffect, useMemo, useState } from "react";
import { computeQuote, type FeeDef, type Quote } from "@/lib/pricing";

type Rate = { id: string; label: string; minutes: number; priceCents: number; startTimes: string[] };
type Boat = {
  boatId: string;
  name: string;
  type: string;
  capacity: number;
  description: string;
  imageUrl: string | null;
  depositCents: number;
  rates: Rate[];
};
type AddOn = { id: string; name: string; description: string; priceCents: number; max: number };

const money = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);
const fmtTime = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};
const addMinutes = (t: string, mins: number) => {
  const [h, m] = t.split(":").map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const fmtDate = (d: string) => {
  const [y, mo, da] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(
    new Date(Date.UTC(y, mo - 1, da)),
  );
};

export default function BookingWizard(props: {
  minDate: string;
  maxDate: string;
  initialDate?: string;
  initialBoatId?: string;
  addOns: AddOn[];
  taxRateBps: number;
  fees: FeeDef[];
  convenience: { bps: number; cents: number; label: string } | null;
  embedded?: boolean;
}) {
  const [date, setDate] = useState(props.initialDate && props.initialDate >= props.minDate ? props.initialDate : props.minDate);
  const [party, setParty] = useState(2);
  const [boats, setBoats] = useState<Boat[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<{ boatId: string; rateId: string; time: string } | null>(null);
  const [addOnQty, setAddOnQty] = useState<Record<string, number>>({});
  const [step, setStep] = useState<"choose" | "details">("choose");
  const [customer, setCustomer] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [notes, setNotes] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSel(null);
    fetch(`/api/availability?date=${date}&party=${party}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setBoats(d.boats ?? []))
      .catch(() => !cancelled && setBoats([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [date, party]);

  const sortedBoats = useMemo(() => {
    if (!boats) return null;
    if (!props.initialBoatId) return boats;
    return [...boats].sort((a, b) => (a.boatId === props.initialBoatId ? -1 : b.boatId === props.initialBoatId ? 1 : 0));
  }, [boats, props.initialBoatId]);

  const selBoat = boats?.find((b) => b.boatId === sel?.boatId);
  const selRate = selBoat?.rates.find((r) => r.id === sel?.rateId);

  const quote = useMemo(() => {
    if (!selRate) return null;
    return computeQuote({
      rentalCents: selRate.priceCents,
      minutes: selRate.minutes,
      addOns: props.addOns.map((a) => ({ priceCents: a.priceCents, quantity: addOnQty[a.id] ?? 0 })),
      fees: props.fees,
      taxRateBps: props.taxRateBps,
      convenience: props.convenience,
    });
  }, [selRate, addOnQty, props.addOns, props.taxRateBps, props.fees, props.convenience]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sel) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boatId: sel.boatId,
          rateId: sel.rateId,
          date,
          startTime: sel.time,
          partySize: party,
          customer,
          addOns: Object.entries(addOnQty).map(([addOnId, quantity]) => ({ addOnId, quantity })),
          customerNotes: notes || undefined,
          marketingOptIn: optIn,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Booking failed");
      const target = data.next as string;
      if (props.embedded && window.top && window.top !== window) {
        window.top.location.href = new URL(target, window.location.origin).toString();
      } else {
        window.location.href = target;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card card-pad">
        <h1 className="h1 mb-4">Book your boat</h1>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="date">Date</label>
            <input
              id="date"
              type="date"
              className="input"
              min={props.minDate}
              max={props.maxDate}
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              disabled={step === "details"}
            />
          </div>
          <div>
            <label className="label" htmlFor="party">Guests (including you)</label>
            <input
              id="party"
              type="number"
              min={1}
              max={30}
              className="input"
              value={party}
              onChange={(e) => setParty(Math.max(1, Number(e.target.value) || 1))}
              disabled={step === "details"}
            />
          </div>
        </div>
      </div>

      {step === "choose" && (
        <>
          <div className="space-y-4">
            <h2 className="h2">Available on {fmtDate(date)}</h2>
            {loading && <div className="muted">Checking availability…</div>}
            {!loading && sortedBoats?.length === 0 && (
              <div className="card card-pad text-sm text-slate-600">
                No boats fit {party} guests on this date. Try another date or a smaller group, or call us.
              </div>
            )}
            {!loading &&
              sortedBoats?.map((boat) => {
                const any = boat.rates.some((r) => r.startTimes.length > 0);
                return (
                  <div key={boat.boatId} className={`card overflow-hidden ${sel?.boatId === boat.boatId ? "ring-2 ring-brand" : ""}`}>
                    <div className="flex flex-col sm:flex-row">
                      {boat.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={boat.imageUrl} alt={boat.name} className="h-40 w-full object-cover sm:h-auto sm:w-48" />
                      ) : (
                        <div className="flex h-32 items-center justify-center bg-gradient-to-br from-sky-200 to-brand-light text-4xl sm:h-auto sm:w-48">⛵</div>
                      )}
                      <div className="flex-1 p-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="text-lg font-semibold">{boat.name}</h3>
                          <span className="muted">{boat.type} · up to {boat.capacity} guests</span>
                        </div>
                        {!any && <p className="mt-2 text-sm text-slate-500">Fully booked this day.</p>}
                        <div className="mt-3 space-y-3">
                          {boat.rates.map((rate) => (
                            <div key={rate.id}>
                              <div className="flex items-baseline justify-between text-sm">
                                <span className="font-medium">{rate.label}</span>
                                <span className="font-semibold">{money(rate.priceCents)}</span>
                              </div>
                              {rate.startTimes.length > 0 ? (
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                  {rate.startTimes.map((t) => {
                                    const active = sel?.boatId === boat.boatId && sel.rateId === rate.id && sel.time === t;
                                    return (
                                      <button
                                        key={t}
                                        type="button"
                                        onClick={() => setSel({ boatId: boat.boatId, rateId: rate.id, time: t })}
                                        className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                                          active ? "border-brand bg-brand text-white" : "border-slate-300 bg-white hover:border-brand hover:text-brand"
                                        }`}
                                      >
                                        {fmtTime(t)}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="mt-1 text-xs text-slate-400">No times left</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>

          {sel && selBoat && selRate && (
            <div className="card card-pad space-y-4">
              <h2 className="h2">Extras</h2>
              {props.addOns.length === 0 && <p className="muted">No extras available.</p>}
              {props.addOns.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium">{a.name} <span className="muted">· {money(a.priceCents)} each</span></div>
                    {a.description && <div className="muted">{a.description}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setAddOnQty((q) => ({ ...q, [a.id]: Math.max(0, (q[a.id] ?? 0) - 1) }))}
                      aria-label={`Remove ${a.name}`}
                    >−</button>
                    <span className="w-6 text-center">{addOnQty[a.id] ?? 0}</span>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setAddOnQty((q) => ({ ...q, [a.id]: Math.min(a.max, (q[a.id] ?? 0) + 1) }))}
                      aria-label={`Add ${a.name}`}
                    >+</button>
                  </div>
                </div>
              ))}
              <Summary boat={selBoat} rate={selRate} time={sel.time} date={date} quote={quote!} convenienceLabel={props.convenience?.label ?? ""} />
              <button className="btn-primary w-full py-3 text-base" onClick={() => setStep("details")}>
                Continue
              </button>
            </div>
          )}
        </>
      )}

      {step === "details" && sel && selBoat && selRate && quote && (
        <form onSubmit={submit} className="card card-pad space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="h2">Your details</h2>
            <button type="button" className="text-sm text-brand underline" onClick={() => setStep("choose")}>
              Change selection
            </button>
          </div>
          <Summary boat={selBoat} rate={selRate} time={sel.time} date={date} quote={quote} convenienceLabel={props.convenience?.label ?? ""} />
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["firstName", "First name", "text", "given-name"],
                ["lastName", "Last name", "text", "family-name"],
                ["email", "Email", "email", "email"],
                ["phone", "Mobile phone", "tel", "tel"],
              ] as const
            ).map(([k, label, type, ac]) => (
              <div key={k}>
                <label className="label" htmlFor={k}>{label}</label>
                <input
                  id={k}
                  required
                  type={type}
                  autoComplete={ac}
                  className="input"
                  value={customer[k]}
                  onChange={(e) => setCustomer((c) => ({ ...c, [k]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div>
            <label className="label" htmlFor="notes">Anything we should know? (optional)</label>
            <textarea id="notes" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-1" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
            <span>Send me occasional deals and news by text and email. Msg &amp; data rates may apply. Reply STOP to opt out anytime. (Optional)</span>
          </label>
          <p className="muted">
            Next you&apos;ll sign the rental agreement and pay. A refundable {money(selBoat.depositCents)} security deposit is
            authorized on your card shortly before your trip and released after the boat is returned.
          </p>
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
          <button className="btn-primary w-full py-3 text-base" disabled={submitting}>
            {submitting ? "Reserving…" : "Reserve & continue to agreement"}
          </button>
        </form>
      )}
    </div>
  );
}

function Summary({
  boat,
  rate,
  time,
  date,
  quote,
  convenienceLabel,
}: {
  boat: Boat;
  rate: Rate;
  time: string;
  date: string;
  quote: Quote;
  convenienceLabel: string;
}) {
  return (
    <div className="rounded-lg bg-slate-50 p-4 text-sm">
      <div className="font-semibold">{boat.name} · {rate.label}</div>
      <div className="text-slate-600">
        {fmtDate(date)} · {fmtTime(time)} – {fmtTime(addMinutes(time, rate.minutes))}
      </div>
      <dl className="mt-3 space-y-1">
        <div className="flex justify-between"><dt>Boat rental</dt><dd>{money(quote.subtotalCents)}</dd></div>
        {quote.feeLines.filter((l) => l.mode === "included").map((l) => (
          <div key={l.feeId} className="flex justify-between pl-3 text-xs text-slate-500"><dt>Includes {l.name.toLowerCase()}</dt><dd>{money(l.amountCents)}</dd></div>
        ))}
        {quote.addOnsCents > 0 && <div className="flex justify-between"><dt>Extras</dt><dd>{money(quote.addOnsCents)}</dd></div>}
        {quote.feeLines.filter((l) => l.mode !== "included").map((l) => (
          <div key={l.feeId} className="flex justify-between"><dt>{l.name}</dt><dd>{money(l.amountCents)}</dd></div>
        ))}
        <div className="flex justify-between"><dt>Tax</dt><dd>{money(quote.taxCents)}</dd></div>
        {quote.convenienceFeeCents > 0 && (
          <div className="flex justify-between"><dt>{convenienceLabel}</dt><dd>{money(quote.convenienceFeeCents)}</dd></div>
        )}
        <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>Total due today</dt><dd>{money(quote.totalCents)}</dd></div>
      </dl>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { fmtHHMM } from "@/lib/time";
import { fmtMoney } from "@/lib/money";
import { approvePhoneOrderAction, phoneOrderSlots, rejectPhoneOrderAction } from "./actions";

type Slots = Awaited<ReturnType<typeof phoneOrderSlots>>;

export type ReviewFormProps = {
  id: string;
  customerName: string;
  phone: string;
  email: string;
  date: string;
  boatRate: string; // "boatId|rateId"
  startTime: string;
  partySize: number;
  notes: string;
  addOns: { id: string; name: string; priceCents: number; quantity: number }[];
  slots: Slots;
  businessName: string;
};

export default function ReviewForm(p: ReviewFormProps) {
  const [date, setDate] = useState(p.date);
  const [slots, setSlots] = useState<Slots>(p.slots);
  const [boatRate, setBoatRate] = useState(p.boatRate);
  const [time, setTime] = useState(p.startTime);
  const [partySize, setPartySize] = useState(p.partySize || 1);
  const [loading, start] = useTransition();
  const [showReject, setShowReject] = useState(false);
  const [textCaller, setTextCaller] = useState(false);

  const [boatId, rateId] = boatRate.split("|");
  const boat = slots.find((b) => b.boatId === boatId);
  const times = boat?.rates.find((r) => r.id === rateId)?.startTimes ?? [];
  const tooSmall = boat && partySize > boat.capacity;

  function pickTime(list: string[], keep: string) {
    setTime(list.includes(keep) ? keep : (list[0] ?? ""));
  }
  function changeDate(d: string) {
    setDate(d);
    if (!d) return;
    start(async () => {
      const next = await phoneOrderSlots(d);
      setSlots(next);
      const [b, r] = boatRate.split("|");
      pickTime(next.find((x) => x.boatId === b)?.rates.find((x) => x.id === r)?.startTimes ?? [], time);
    });
  }
  function changeBoatRate(v: string) {
    setBoatRate(v);
    const [b, r] = v.split("|");
    pickTime(slots.find((x) => x.boatId === b)?.rates.find((x) => x.id === r)?.startTimes ?? [], time);
  }

  const firstName = p.customerName.trim().split(/\s+/)[0] || "there";
  return (
    <div className="space-y-3">
      <form action={approvePhoneOrderAction} className="space-y-3">
        <input type="hidden" name="id" value={p.id} />
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-12 sm:col-span-4"><label className="label">Name</label><input name="customerName" className="input" defaultValue={p.customerName} required /></div>
          <div className="col-span-6 sm:col-span-3"><label className="label">Phone</label><input name="phone" className="input" defaultValue={p.phone} required /></div>
          <div className="col-span-6 sm:col-span-5">
            <label className="label">Email (optional)</label>
            <input name="email" type="email" className="input" defaultValue={p.email} placeholder="Leave blank: guest adds it on their page" />
          </div>
          <div className="col-span-6 sm:col-span-3">
            <label className="label">Date</label>
            <input name="date" type="date" className="input" value={date} onChange={(e) => changeDate(e.target.value)} required />
          </div>
          <div className="col-span-6 sm:col-span-2">
            <label className="label">Party size</label>
            <input name="partySize" type="number" min={1} className="input" value={partySize} onChange={(e) => setPartySize(Number(e.target.value) || 1)} />
          </div>
          <div className="col-span-12 sm:col-span-4">
            <label className="label">Boat and package</label>
            <select name="boatRate" className="input" value={boatRate} onChange={(e) => changeBoatRate(e.target.value)} required>
              <option value="">Choose…</option>
              {slots.map((b) =>
                b.rates.map((r) => (
                  <option key={`${b.boatId}|${r.id}`} value={`${b.boatId}|${r.id}`}>
                    {b.name}: {r.label} ({fmtMoney(r.priceCents)}){r.startTimes.length ? "" : " · full"}
                  </option>
                )),
              )}
            </select>
          </div>
          <div className="col-span-12 sm:col-span-3">
            <label className="label">Start time {loading && <span className="muted text-xs">checking…</span>}</label>
            <select name="startTime" className="input" value={time} onChange={(e) => setTime(e.target.value)} required>
              {!times.length && <option value="">Nothing open</option>}
              {times.map((t) => (
                <option key={t} value={t}>{fmtHHMM(t)}</option>
              ))}
            </select>
          </div>
        </div>
        {tooSmall && <p className="text-sm text-rose-700">{boat!.name} holds up to {boat!.capacity} people.</p>}
        {p.addOns.length > 0 && (
          <div>
            <div className="label">Add-ons</div>
            <div className="flex flex-wrap gap-3">
              {p.addOns.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <input name={`addon_${a.id}`} type="number" min={0} className="input w-16" defaultValue={a.quantity} />
                  {a.name} <span className="muted">{fmtMoney(a.priceCents)}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        <div><label className="label">Notes for the booking</label><textarea name="notes" rows={2} className="input" defaultValue={p.notes} /></div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={loading || !time || !boatRate}>Approve &amp; text link</button>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="sendText" defaultChecked /> Text the guest their sign &amp; pay link</label>
          <button type="button" className="btn-secondary btn-sm ml-auto" onClick={() => setShowReject((v) => !v)}>Reject…</button>
        </div>
      </form>
      {showReject && (
        <form action={rejectPhoneOrderAction} className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3">
          <input type="hidden" name="id" value={p.id} />
          <div><label className="label">Reason (for your records)</label><input name="reason" className="input" placeholder="e.g. Fully booked, called back instead" /></div>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="textCaller" checked={textCaller} onChange={(e) => setTextCaller(e.target.checked)} /> Text the caller</label>
          {textCaller && (
            <textarea
              name="message"
              rows={3}
              className="input"
              defaultValue={`Hi ${firstName}, thanks for calling ${p.businessName}! Sorry, we can't book that trip. Give us a call back and we'll help you find another time.`}
            />
          )}
          <button className="btn-danger btn-sm">Reject request</button>
        </form>
      )}
    </div>
  );
}

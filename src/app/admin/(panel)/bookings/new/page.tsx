import { prisma } from "@/lib/db";
import { isValidDateStr, todayLocal } from "@/lib/time";
import { fmtMoney } from "@/lib/money";
import { PageHeader } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import { adminCreateBooking } from "../../../actions";

export default async function NewBooking({ searchParams }: { searchParams: Promise<{ boat?: string; date?: string; err?: string }> }) {
  const sp = await searchParams;
  const boats = await prisma.boat.findMany({
    where: { status: { not: "retired" } },
    orderBy: { sortOrder: "asc" },
    include: { rates: { where: { active: true }, orderBy: { minutes: "asc" } } },
  });
  const addOns = await prisma.addOn.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const preBoat = boats.find((b) => b.id === sp.boat && b.rates.length > 0);
  const defaultBoatRate = preBoat ? `${preBoat.id}|${preBoat.rates[0].id}` : "";
  return (
    <div className="max-w-3xl">
      <PageHeader title="New booking" subtitle="Phone, walk-in, or comp booking. Staff bookings skip the online notice/hours rules but still prevent double-booking." />
      <FlashMessage err={sp.err} />
      <form action={adminCreateBooking} className="card card-pad space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Boat & package</label>
            <select name="boatRate" required className="input" defaultValue={defaultBoatRate}>
              <option value="" disabled>Choose…</option>
              {boats.map((b) => (
                <optgroup key={b.id} label={`${b.name}${b.status !== "available" ? ` (${b.status})` : ""}`}>
                  {b.rates.map((r) => (
                    <option key={r.id} value={`${b.id}|${r.id}`}>
                      {b.name} — {r.label} ({fmtMoney(r.priceCents)})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div><label className="label">Date</label><input name="date" type="date" required className="input" defaultValue={isValidDateStr(sp.date) ? sp.date : todayLocal()} /></div>
          <div><label className="label">Start time</label><input name="startTime" type="time" required step={900} className="input" defaultValue="09:00" /></div>
          <div><label className="label">Guests</label><input name="partySize" type="number" min={1} defaultValue={2} className="input" /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label">First name</label><input name="firstName" required className="input" /></div>
          <div><label className="label">Last name</label><input name="lastName" required className="input" /></div>
          <div><label className="label">Email</label><input name="email" type="email" required className="input" /></div>
          <div><label className="label">Phone</label><input name="phone" type="tel" required className="input" /></div>
        </div>
        {addOns.length > 0 && (
          <div>
            <div className="label">Add-ons</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {addOns.map((a) => (
                <label key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span>{a.name} <span className="muted">{fmtMoney(a.priceCents)}</span></span>
                  <input name={`addon_${a.id}`} type="number" min={0} max={a.quantity} defaultValue={0} className="input w-20" />
                </label>
              ))}
            </div>
          </div>
        )}
        <div><label className="label">Notes</label><textarea name="notes" rows={2} className="input" /></div>
        <fieldset>
          <legend className="label">Payment</legend>
          <div className="space-y-1 text-sm">
            <label className="flex gap-2"><input type="radio" name="payment" value="link" defaultChecked /> Email the customer a link to sign & pay online (recommended — saves card for deposit)</label>
            <label className="flex gap-2"><input type="radio" name="payment" value="cash" /> Paid in full — cash</label>
            <label className="flex gap-2"><input type="radio" name="payment" value="card_terminal" /> Paid in full — card terminal / other</label>
            <label className="flex gap-2"><input type="radio" name="payment" value="none" /> Leave unpaid for now</label>
          </div>
        </fieldset>
        <button className="btn-primary">Create booking</button>
      </form>
    </div>
  );
}

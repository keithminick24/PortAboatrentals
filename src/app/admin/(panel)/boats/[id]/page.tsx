import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { centsToInput, fmtMoney } from "@/lib/money";
import { fmtDate, fmtDateTime, todayLocal } from "@/lib/time";
import { PageHeader } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import { addBlock, addMaintenance, copyRatesToAllBoats, deleteBlock, saveBoat, saveRate } from "../../../actions";

export default async function BoatEdit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const isNew = id === "new";
  const boat = isNew
    ? null
    : await prisma.boat.findUnique({
        where: { id },
        include: {
          rates: { orderBy: [{ sortOrder: "asc" }, { minutes: "asc" }] },
          maintenance: { orderBy: { performedAt: "desc" } },
          blocks: { where: { endsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } },
          _count: { select: { bookings: true } },
        },
      });
  if (!isNew && !boat) notFound();

  return (
    <div className="space-y-6">
      <PageHeader title={boat?.name ?? "New boat"} subtitle={<Link href="/admin/boats" className="hover:underline">← Fleet</Link>} />
      <FlashMessage msg={sp.msg} err={sp.err} />
      <div className="grid gap-6 lg:grid-cols-2">
        <form action={saveBoat} className="card card-pad space-y-4">
          <input type="hidden" name="id" value={boat?.id ?? ""} />
          <h2 className="h2">Details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Name</label><input name="name" required className="input" defaultValue={boat?.name} /></div>
            <div><label className="label">Type</label><input name="type" className="input" defaultValue={boat?.type ?? "Tritoon Pontoon"} /></div>
            <div><label className="label">Capacity (people)</label><input name="capacity" type="number" min={1} className="input" defaultValue={boat?.capacity ?? 10} /></div>
            <div><label className="label">Security deposit $</label><input name="deposit" className="input" defaultValue={centsToInput(boat?.depositCents ?? 50000)} /></div>
            <div><label className="label">Length (ft)</label><input name="lengthFt" type="number" className="input" defaultValue={boat?.lengthFt ?? ""} /></div>
            <div><label className="label">Horsepower</label><input name="horsepower" type="number" className="input" defaultValue={boat?.horsepower ?? ""} /></div>
            <div>
              <label className="label">Status</label>
              <select name="status" className="input" defaultValue={boat?.status ?? "available"}>
                <option value="available">Available (bookable)</option>
                <option value="maintenance">In maintenance (hidden online)</option>
                <option value="retired">Retired</option>
              </select>
            </div>
            <div><label className="label">Display order</label><input name="sortOrder" type="number" className="input" defaultValue={boat?.sortOrder ?? 0} /></div>
            <div><label className="label">TX registration #</label><input name="registration" className="input" defaultValue={boat?.registration ?? ""} /></div>
            <div><label className="label">Hull ID (HIN)</label><input name="hullId" className="input" defaultValue={boat?.hullId ?? ""} /></div>
            <div><label className="label">Engine hours</label><input name="engineHours" type="number" step="0.1" className="input" defaultValue={boat?.engineHours ?? 0} /></div>
          </div>
          <div><label className="label">Photo URL</label><input name="imageUrl" className="input" placeholder="https://www.portaboatrentals.com/wp-content/uploads/…" defaultValue={boat?.imageUrl ?? ""} /></div>
          <div><label className="label">Description (shown to customers)</label><textarea name="description" rows={3} className="input" defaultValue={boat?.description} /></div>
          <div><label className="label">Internal notes</label><textarea name="notes" rows={2} className="input" defaultValue={boat?.notes} /></div>
          <button className="btn-primary">{isNew ? "Create boat" : "Save"}</button>
        </form>

        {boat && (
          <div className="space-y-6">
            <div className="card card-pad space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="h2">Rates / packages</h2>
                {boat.rates.length > 0 && (
                  <form action={copyRatesToAllBoats}>
                    <input type="hidden" name="boatId" value={boat.id} />
                    <button className="text-xs text-brand hover:underline">Copy these rates to all boats</button>
                  </form>
                )}
              </div>
              {[...boat.rates, null].map((r) => (
                <form key={r?.id ?? "new"} action={saveRate} className={`grid grid-cols-12 items-end gap-2 rounded-lg p-2 ${r ? "bg-slate-50" : "border border-dashed border-slate-300"}`}>
                  <input type="hidden" name="boatId" value={boat.id} />
                  <input type="hidden" name="id" value={r?.id ?? ""} />
                  <div className="col-span-12 sm:col-span-4"><label className="label text-xs">Label</label><input name="label" className="input" defaultValue={r?.label} placeholder="Half Day (4 hrs)" /></div>
                  <div className="col-span-3 sm:col-span-2"><label className="label text-xs">Hours</label><input name="hours" type="number" step="0.5" className="input" defaultValue={r ? r.minutes / 60 : ""} /></div>
                  <div className="col-span-4 sm:col-span-2"><label className="label text-xs">Price $</label><input name="price" className="input" defaultValue={centsToInput(r?.priceCents)} /></div>
                  <div className="col-span-5 sm:col-span-2"><label className="label text-xs">Weekend $</label><input name="weekendPrice" className="input" placeholder="same" defaultValue={centsToInput(r?.weekendPriceCents)} /></div>
                  <input type="hidden" name="sortOrder" value={r?.sortOrder ?? boat.rates.length + 1} />
                  <div className="col-span-12 flex items-center gap-2 sm:col-span-2">
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="active" defaultChecked={r?.active ?? true} />On</label>
                    <button className="btn-secondary btn-sm">{r ? "Save" : "Add"}</button>
                  </div>
                </form>
              ))}
              <p className="muted">Uncheck “On” to stop offering a rate (past bookings keep their price).</p>
            </div>

            <div className="card card-pad space-y-3">
              <h2 className="h2">Upcoming blocks</h2>
              {boat.blocks.length === 0 && <p className="muted">None.</p>}
              {boat.blocks.map((bl) => (
                <form key={bl.id} action={deleteBlock} className="flex items-center justify-between text-sm">
                  <input type="hidden" name="id" value={bl.id} />
                  <input type="hidden" name="returnTo" value={`/admin/boats/${boat.id}`} />
                  <span>{fmtDateTime(bl.startsAt)} → {fmtDateTime(bl.endsAt)} {bl.reason && <span className="muted">· {bl.reason}</span>}</span>
                  <button className="text-xs text-rose-600">Remove</button>
                </form>
              ))}
              <form action={addBlock} className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
                <input type="hidden" name="boatId" value={boat.id} />
                <input type="hidden" name="returnTo" value={`/admin/boats/${boat.id}`} />
                <input name="startDate" type="date" required className="input" defaultValue={todayLocal()} />
                <input name="startTime" type="time" className="input" defaultValue="00:00" />
                <input name="endDate" type="date" className="input" defaultValue={todayLocal()} />
                <input name="endTime" type="time" className="input" defaultValue="23:59" />
                <input name="reason" placeholder="Reason" className="input col-span-2" />
                <button className="btn-secondary btn-sm col-span-2">Block this boat</button>
              </form>
            </div>

            <div className="card card-pad space-y-3">
              <h2 className="h2">Maintenance log</h2>
              <form action={addMaintenance} className="grid grid-cols-2 gap-2">
                <input type="hidden" name="boatId" value={boat.id} />
                <input name="description" placeholder="Work performed (oil change, impeller, prop swap…)" className="input col-span-2" required />
                <input name="date" type="date" className="input" defaultValue={todayLocal()} />
                <input name="engineHours" type="number" step="0.1" placeholder="Engine hrs" className="input" defaultValue={boat.engineHours} />
                <input name="cost" placeholder="Cost $" className="input" />
                <button className="btn-secondary btn-sm">Log service</button>
              </form>
              <ul className="divide-y divide-slate-100 text-sm">
                {boat.maintenance.map((m) => (
                  <li key={m.id} className="py-2">
                    <div className="flex justify-between"><span className="font-medium">{m.description}</span>{m.costCents != null && <span>{fmtMoney(m.costCents)}</span>}</div>
                    <div className="muted">{fmtDate(m.performedAt)}{m.engineHours != null && ` · ${m.engineHours} hrs`}{m.createdBy && ` · ${m.createdBy}`}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

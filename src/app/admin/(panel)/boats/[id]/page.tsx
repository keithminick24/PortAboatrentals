import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { centsToInput, fmtMoney } from "@/lib/money";
import { fmtDate, fmtDateTime, todayLocal } from "@/lib/time";
import { PageHeader } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import { addBlock, addMaintenance, copyRatesToAllBoats, deleteBlock, saveBoat, saveRate, saveSchedule } from "../../../actions";
import { dueStatus } from "@/lib/maintenance";
import { ANGLE_LABELS } from "@/lib/constants";
import BoatInsuranceTow from "@/components/admin/BoatInsuranceTow";

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
          schedules: { orderBy: { name: "asc" } },
          damage: { where: { status: "confirmed" }, orderBy: { createdAt: "desc" } },
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
              <h2 className="h2">Service schedule</h2>
              <p className="muted text-xs">Due when either the hours or the days run out. Dock crew see these on the dock app and can mark them done.</p>
              <ul className="divide-y divide-slate-100 text-sm">
                {boat.schedules.map((sch) => {
                  const d = dueStatus(sch, boat.engineHours);
                  return (
                    <li key={sch.id} className="py-2">
                      <form action={saveSchedule} className="grid grid-cols-12 items-center gap-2">
                        <input type="hidden" name="id" value={sch.id} />
                        <input type="hidden" name="boatId" value={boat.id} />
                        <input name="name" className="input col-span-12 sm:col-span-5" defaultValue={sch.name} />
                        <input name="everyHours" type="number" step="1" className="input col-span-4 sm:col-span-2" defaultValue={sch.everyHours ?? ""} placeholder="hrs" title="Every N engine hours" />
                        <input name="everyDays" type="number" step="1" className="input col-span-4 sm:col-span-2" defaultValue={sch.everyDays ?? ""} placeholder="days" title="Every N days" />
                        <label className="col-span-2 flex items-center gap-1 text-xs sm:col-span-1"><input type="checkbox" name="active" defaultChecked={sch.active} />On</label>
                        <button className="btn-secondary btn-sm col-span-2">Save</button>
                      </form>
                      <div className={`mt-1 text-xs ${d.state === "due" ? "font-semibold text-rose-700" : d.state === "soon" ? "text-amber-700" : "text-emerald-700"}`}>
                        {sch.active ? d.label : "Off"}{sch.lastDoneAt ? ` · last done ${fmtDate(sch.lastDoneAt)}${sch.lastDoneHours != null ? ` at ${sch.lastDoneHours} hrs` : ""}` : " · never logged"}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <form action={saveSchedule} className="grid grid-cols-12 gap-2 border-t border-slate-100 pt-3">
                <input type="hidden" name="boatId" value={boat.id} />
                <input name="name" className="input col-span-12 sm:col-span-6" placeholder="New interval, e.g. Spark plugs" />
                <input name="everyHours" type="number" className="input col-span-4 sm:col-span-2" placeholder="every hrs" />
                <input name="everyDays" type="number" className="input col-span-4 sm:col-span-2" placeholder="every days" />
                <input type="hidden" name="active" value="on" />
                <button className="btn-secondary btn-sm col-span-4 sm:col-span-2">Add</button>
              </form>
            </div>

            <div className="card card-pad space-y-3">
              <h2 className="h2">Maintenance log</h2>
              <form action={addMaintenance} className="grid grid-cols-2 gap-2">
                <input type="hidden" name="boatId" value={boat.id} />
                <input name="description" placeholder="Work performed (oil change, impeller, prop swap…)" className="input col-span-2" required />
                <select name="category" className="input">
                  <option value="service">Service</option><option value="repair">Repair</option><option value="inspection">Inspection</option><option value="cleaning">Cleaning</option><option value="issue">Issue to fix</option>
                </select>
                <select name="scheduleId" className="input" defaultValue="">
                  <option value="">Not a scheduled item</option>
                  {boat.schedules.map((sch) => <option key={sch.id} value={sch.id}>Completes: {sch.name}</option>)}
                </select>
                <input name="date" type="date" className="input" defaultValue={todayLocal()} />
                <input name="engineHours" type="number" step="0.1" placeholder="Engine hrs" className="input" defaultValue={boat.engineHours} />
                <input name="vendor" placeholder="Vendor / who" className="input" />
                <input name="cost" placeholder="Cost $" className="input" />
                <button className="btn-secondary btn-sm col-span-2">Log work</button>
              </form>
              <ul className="divide-y divide-slate-100 text-sm">
                {boat.maintenance.map((m) => (
                  <li key={m.id} className="py-2">
                    <div className="flex justify-between"><span className="font-medium">{m.description}</span>{m.costCents != null && <span>{fmtMoney(m.costCents)}</span>}</div>
                    <div className="muted">{m.category} · {fmtDate(m.performedAt)}{m.engineHours != null && ` · ${m.engineHours} hrs`}{m.vendor && ` · ${m.vendor}`}{m.createdBy && ` · ${m.createdBy}`}</div>
                  </li>
                ))}
              </ul>
              {boat.maintenance.length > 0 && (
                <div className="text-right text-sm font-medium">
                  Total spent: {fmtMoney(boat.maintenance.reduce((t, m) => t + (m.costCents ?? 0), 0))}
                </div>
              )}
            </div>

            <div className="card card-pad space-y-2">
              <h2 className="h2">Damage on record</h2>
              {boat.damage.length === 0 ? <p className="muted">None.</p> : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {boat.damage.map((d) => (
                    <li key={d.id} className="py-2">
                      <div>{ANGLE_LABELS[d.angle] ?? d.angle}{d.location ? `, ${d.location}` : ""}: {d.description}</div>
                      <div className="muted">{d.severity} · {d.source === "ai" ? "flagged by photo check, confirmed by " + (d.reviewedBy ?? "crew") : d.createdBy} · {fmtDate(d.createdAt)}{d.bookingId && <> · <Link className="text-brand underline" href={`/admin/bookings/${d.bookingId}`}>trip</Link></>}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
      {boat && <BoatInsuranceTow boatId={boat.id} />}
    </div>
  );
}

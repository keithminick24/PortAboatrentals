import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { dueStatus } from "@/lib/maintenance";
import { ANGLE_LABELS } from "@/lib/constants";
import { fmtDate } from "@/lib/time";
import FlashMessage from "@/components/FlashMessage";
import TowInfo from "@/components/dock/TowInfo";
import { dockLogMaintenance, logDamage, markRepaired } from "../../../actions";

export default async function DockBoat({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const boat = await prisma.boat.findUnique({
    where: { id },
    include: {
      schedules: { where: { active: true }, orderBy: { name: "asc" } },
      maintenance: { orderBy: { performedAt: "desc" }, take: 15 },
      damage: { where: { status: "confirmed" }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!boat) notFound();
  const returnTo = `/dock/boats/${boat.id}`;
  const tone = { ok: "text-emerald-700", soon: "text-amber-700", due: "font-semibold text-rose-700" } as const;

  return (
    <div className="space-y-4">
      <Link href="/dock/boats" className="text-sm text-brand">← Boats</Link>
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h1 className="text-2xl font-bold">{boat.name}</h1>
        <div className="text-sm text-slate-500">{boat.engineHours.toFixed(1)} engine hours{boat.registration ? ` · ${boat.registration}` : ""}</div>
        <div className="mt-3"><TowInfo boat={boat} /></div>
        <Link href={`/dock/incidents/new?boatId=${boat.id}`} className="mt-2 block text-center text-sm font-semibold text-rose-700">⚠ Report incident</Link>
      </div>
      <FlashMessage msg={sp.msg} err={sp.err} />

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-bold">Service schedule</h2>
        {boat.schedules.length === 0 && <p className="text-sm text-slate-500">No service intervals set. The office can add them under Fleet.</p>}
        <div className="divide-y divide-slate-100">
          {boat.schedules.map((s) => {
            const d = dueStatus(s, boat.engineHours);
            return (
              <details key={s.id} className="py-2">
                <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{s.name}</span>
                  <span className={tone[d.state]}>{d.label}</span>
                </summary>
                <form action={dockLogMaintenance} className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
                  <input type="hidden" name="boatId" value={boat.id} />
                  <input type="hidden" name="scheduleId" value={s.id} />
                  <input type="hidden" name="description" value={s.name} />
                  <div className="grid grid-cols-2 gap-2">
                    <input name="engineHours" type="number" step="0.1" inputMode="decimal" className="input" defaultValue={boat.engineHours} placeholder="Engine hrs" />
                    <input name="vendor" className="input" placeholder="Done by" />
                  </div>
                  <button className="btn-primary w-full">Mark done</button>
                </form>
              </details>
            );
          })}
        </div>
      </section>

      <details className="rounded-xl bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-lg font-bold">+ Log work or report an issue</summary>
        <form action={dockLogMaintenance} className="mt-3 space-y-2">
          <input type="hidden" name="boatId" value={boat.id} />
          <select name="category" className="input">
            <option value="repair">Repair</option>
            <option value="service">Service</option>
            <option value="inspection">Inspection</option>
            <option value="cleaning">Cleaning</option>
            <option value="issue">Issue to fix</option>
          </select>
          <textarea name="description" rows={2} className="input" placeholder="What was done, or what needs fixing?" required />
          <div className="grid grid-cols-3 gap-2">
            <input name="engineHours" type="number" step="0.1" inputMode="decimal" className="input" placeholder="Hrs" />
            <input name="vendor" className="input" placeholder="Who" />
            <input name="cost" className="input" placeholder="Cost $" />
          </div>
          <button className="btn-primary w-full">Save</button>
        </form>
      </details>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-bold">Damage on record ({boat.damage.length})</h2>
        {boat.damage.length === 0 && <p className="text-sm text-slate-500">None.</p>}
        <ul className="space-y-2 text-sm">
          {boat.damage.map((d) => (
            <li key={d.id} className="flex items-start justify-between gap-2">
              <div>
                <div>{ANGLE_LABELS[d.angle]}{d.location ? `, ${d.location}` : ""}: {d.description}</div>
                <div className="text-xs text-slate-500">{d.severity} · {fmtDate(d.createdAt)}{d.bookingId ? " · from a trip" : ""}</div>
              </div>
              <form action={markRepaired}>
                <input type="hidden" name="id" value={d.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button className="btn-secondary btn-sm">Repaired</button>
              </form>
            </li>
          ))}
        </ul>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-brand">+ Log damage (not tied to a trip)</summary>
          <form action={logDamage} className="mt-2 space-y-2">
            <input type="hidden" name="boatId" value={boat.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <input name="location" className="input" placeholder="Where" />
            <textarea name="description" rows={2} className="input" placeholder="What's wrong?" required />
            <select name="severity" className="input"><option value="minor">Minor</option><option value="moderate">Moderate</option><option value="major">Major</option></select>
            <button className="btn-secondary w-full">Log damage</button>
          </form>
        </details>
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-bold">Recent work</h2>
        {boat.maintenance.length === 0 && <p className="text-sm text-slate-500">Nothing logged yet.</p>}
        <ul className="space-y-1 text-sm">
          {boat.maintenance.map((m) => (
            <li key={m.id}>
              <span className="text-slate-500">{fmtDate(m.performedAt)}</span> · {m.description}
              {m.engineHours != null ? ` · ${m.engineHours} hrs` : ""}
              {m.createdBy ? <span className="text-xs text-slate-500"> ({m.createdBy})</span> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/money";
import { fmtDateTime } from "@/lib/time";
import { hasCardOnFile, TIP_SOURCE_LABELS, tipShares, tripCrew } from "@/lib/tips";
import { addBookingCrew, addBookingTip, deleteBookingTip, removeBookingCrew } from "@/app/admin/crew-actions";

const ROLE_LABELS: Record<string, string> = { check_out: "Checked out", check_in: "Checked in", captain: "Captain", assigned: "Added" };
const METHOD_LABELS: Record<string, string> = { card: "Card", cash: "Cash", mock: "Card (test)" };

/** Crew on this trip + tips and each person's share (admin booking page). */
export default async function BookingCrewCard({ bookingId }: { bookingId: string }) {
  const [booking, crew, tips, staff] = await Promise.all([
    prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { id: true, stripePaymentMethodId: true, customer: { select: { stripeCustomerId: true } } },
    }),
    tripCrew([bookingId]),
    prisma.tip.findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } }),
    prisma.adminUser.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const { byPerson, perTip } = tipShares(tips, crew);
  const notOnTrip = staff.filter((u) => !crew.some((c) => c.userId === u.id));
  const card = hasCardOnFile(booking);
  const total = tips.reduce((n, t) => n + t.amountCents, 0);

  return (
    <div className="card card-pad space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="h2">Crew &amp; tips</h2>
        {total > 0 && <span className="text-sm font-semibold">{fmtMoney(total)} in tips</span>}
      </div>

      <div>
        <div className="label">Crew on this trip</div>
        {crew.length === 0 && <p className="muted">No one yet. Whoever checks the boat out or in is added automatically.</p>}
        <ul className="space-y-1 text-sm">
          {crew.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <span>
                {c.name} <span className="muted">· {ROLE_LABELS[c.role] ?? c.role}</span>
              </span>
              <form action={removeBookingCrew}>
                <input type="hidden" name="bookingId" value={bookingId} />
                <input type="hidden" name="id" value={c.id} />
                <button className="text-xs text-rose-700 underline">Remove</button>
              </form>
            </li>
          ))}
        </ul>
        {notOnTrip.length > 0 && (
          <form action={addBookingCrew} className="mt-2 flex gap-2">
            <input type="hidden" name="bookingId" value={bookingId} />
            <select name="userId" className="input flex-1" defaultValue="">
              <option value="" disabled>Add a crew member…</option>
              {notOnTrip.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button className="btn-secondary btn-sm">Add</button>
          </form>
        )}
      </div>

      <div>
        <div className="label">Tips</div>
        {tips.length === 0 && <p className="muted">No tips yet.</p>}
        <ul className="space-y-2 text-sm">
          {tips.map((t) => {
            const shares = perTip.find((p) => p.tipId === t.id)?.shares ?? [];
            return (
              <li key={t.id} className="rounded-lg bg-slate-50 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{fmtMoney(t.amountCents)}</span>
                  <span className="muted text-xs">
                    {METHOD_LABELS[t.method] ?? t.method} · {TIP_SOURCE_LABELS[t.source] ?? t.source} · {fmtDateTime(t.createdAt)}
                  </span>
                </div>
                <div className="text-xs text-slate-600">{shares.map((s) => `${s.name} ${fmtMoney(s.cents)}`).join(" · ")}</div>
                {t.method !== "card" && (
                  <form action={deleteBookingTip} className="text-right">
                    <input type="hidden" name="bookingId" value={bookingId} />
                    <input type="hidden" name="id" value={t.id} />
                    <button className="text-xs text-rose-700 underline">Delete</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
        {byPerson.length > 0 && tips.length > 1 && (
          <div className="mt-2 text-xs text-slate-600">
            <b>Each person&apos;s share:</b> {byPerson.map((p) => `${p.name} ${fmtMoney(p.totalCents)}`).join(" · ")}
          </div>
        )}
      </div>

      <form action={addBookingTip} className="space-y-2">
        <input type="hidden" name="bookingId" value={bookingId} />
        <div className="label">Add a tip</div>
        <div className="flex gap-2">
          <input name="amount" inputMode="decimal" className="input w-28" placeholder="$0.00" required />
          <select name="method" className="input flex-1" defaultValue={card ? "card" : "cash"}>
            {card && <option value="card">Charge card on file</option>}
            <option value="cash">Cash</option>
          </select>
          <button className="btn-secondary btn-sm">Add</button>
        </div>
        <p className="muted text-xs">Tips are split evenly between the crew on this trip.</p>
      </form>
    </div>
  );
}

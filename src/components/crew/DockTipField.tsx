import { hasCardOnFile } from "@/lib/tips";

/** Optional tip field inside the dock check-in form (handled by dockCheckIn). */
export default function DockTipField({
  booking,
}: {
  booking: { stripePaymentMethodId: string | null; customer: { stripeCustomerId: string | null } };
}) {
  const card = hasCardOnFile(booking);
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <label className="label" htmlFor="tip">Tip for the crew (optional)</label>
      <div className="flex gap-2">
        <input id="tip" name="tip" inputMode="decimal" className="input w-28 text-lg" placeholder="$0" />
        <select name="tipMethod" className="input flex-1 text-lg" defaultValue={card ? "card" : "cash"}>
          {card && <option value="card">Card on file</option>}
          <option value="cash">Cash</option>
        </select>
      </div>
      <p className="mt-1 text-xs text-slate-500">Split evenly with everyone who worked this trip.</p>
    </div>
  );
}

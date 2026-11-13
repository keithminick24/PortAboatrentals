import { prisma } from "@/lib/db";
import { centsToInput, fmtMoney } from "@/lib/money";
import { PageHeader, Pill } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import { saveFee } from "../../actions";

const TIER_ROWS = 4;

export default async function FeesPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const fees = await prisma.fee.findMany({ include: { tiers: { orderBy: { minMinutes: "asc" } } }, orderBy: { sortOrder: "asc" } });
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader
        title="Mandatory fees"
        subtitle="Applied automatically to every booking. Use “by trip length” for amounts that depend on how long the trip is."
      />
      <FlashMessage msg={sp.msg} err={sp.err} />
      <div className="card card-pad text-sm">
        <div className="font-semibold">Two kinds of fee</div>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-600">
          <li><b>Added on top</b>: charged in addition to the boat price, shown as its own line (e.g. Damage Waiver).</li>
          <li><b>Included in boat price</b>: doesn&apos;t change what the guest pays, shows as &ldquo;includes fuel $X&rdquo; on the receipt and is reported separately (e.g. Fuel).</li>
        </ul>
      </div>
      {[...fees, null].map((fee) => {
        const tiers = [...(fee?.tiers ?? [])];
        while (tiers.length < TIER_ROWS) tiers.push(null as never);
        return (
          <form key={fee?.id ?? "new"} action={saveFee} className={`card card-pad space-y-3 ${fee ? "" : "border-dashed"}`}>
            <input type="hidden" name="id" value={fee?.id ?? ""} />
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="h2 flex-1">{fee ? fee.name : "Add a fee"}</h2>
              {fee && <Pill tone={fee.active ? "green" : "slate"}>{fee.active ? "Active" : "Off"}</Pill>}
              {fee && <Pill tone="blue">{fee.mode === "included" ? "Included in price" : "Added on top"}</Pill>}
            </div>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-12 sm:col-span-4"><label className="label">Name</label><input name="name" className="input" defaultValue={fee?.name} placeholder="e.g. Damage Waiver" /></div>
              <div className="col-span-12 sm:col-span-8"><label className="label">Description (shown to guests)</label><input name="description" className="input" defaultValue={fee?.description} /></div>
              <div className="col-span-6 sm:col-span-4">
                <label className="label">How it&apos;s charged</label>
                <select name="mode" className="input" defaultValue={fee?.mode ?? "added"}>
                  <option value="added">Added on top</option>
                  <option value="included">Included in boat price</option>
                </select>
              </div>
              <div className="col-span-6 sm:col-span-4">
                <label className="label">Amount</label>
                <select name="calc" className="input" defaultValue={fee?.calc ?? "flat"}>
                  <option value="flat">By trip length (table below)</option>
                  <option value="percent">Percent of boat price</option>
                </select>
              </div>
              <div className="col-span-6 sm:col-span-2"><label className="label">Percent</label><input name="percent" type="number" step="0.01" min="0" className="input" defaultValue={(fee?.percentBps ?? 0) / 100} /></div>
              <div className="col-span-6 flex flex-col justify-end gap-1 text-sm sm:col-span-2">
                <label className="flex items-center gap-1"><input type="checkbox" name="taxable" defaultChecked={fee?.taxable ?? false} /> Taxable</label>
                <label className="flex items-center gap-1"><input type="checkbox" name="active" defaultChecked={fee?.active ?? true} /> Active</label>
              </div>
            </div>
            <div>
              <div className="label">By trip length</div>
              <p className="muted mb-2 text-xs">The highest row that the trip reaches applies. E.g. 0 hrs → $50 and 5 hrs → $100 means trips under 5 hours pay $50, longer trips pay $100.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {tiers.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="w-24 shrink-0 text-slate-600">Trips of at least</span>
                    <input name="tierHours" type="number" step="0.5" min="0" className="input w-20" defaultValue={t ? t.minMinutes / 60 : ""} />
                    <span className="text-slate-600">hrs →&nbsp;$</span>
                    <input name="tierAmount" className="input w-24" defaultValue={t ? centsToInput(t.amountCents) : ""} />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div><label className="label text-xs">Order</label><input name="sortOrder" type="number" className="input w-20" defaultValue={fee?.sortOrder ?? fees.length + 1} /></div>
              <button className="btn-primary btn-sm mt-5">{fee ? "Save" : "Add fee"}</button>
              {fee && fee.calc === "flat" && (
                <span className="muted mt-5 text-xs">
                  {fee.tiers.map((t) => `${t.minMinutes / 60}+ hrs: ${fmtMoney(t.amountCents)}`).join(" · ")}
                </span>
              )}
            </div>
          </form>
        );
      })}
    </div>
  );
}

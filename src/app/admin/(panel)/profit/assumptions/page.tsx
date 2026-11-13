import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { COST_CATEGORIES } from "@/lib/constants";
import { centsToInput, fmtMoney } from "@/lib/money";
import { BASIS_LABELS, PLACEHOLDER_PREFIX } from "@/lib/profit";
import { Empty, Notice, PageHeader, Pill } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import { addSampleCosts, copyCostsToAllBoats, deleteCost, saveCost } from "./actions";

type CostRow = { id: string; boatId: string | null; name: string; category: string; basis: string; amountCents: number; percentBps: number; active: boolean };

const BASIS_HELP: [string, string][] = [
  ["monthly", "A bill you pay every month no matter how busy you are. Example: boat lift $400/month, insurance $250/month, boat payment $900/month. Spread over that month's trips by trip hours."],
  ["per_engine_hour", "Cost for each hour the engine runs (from check-out/check-in engine hours; scheduled hours if not recorded). Example: fuel $18/engine hour, maintenance reserve $8/engine hour."],
  ["per_trip", "A flat cost every trip. Example: cleaning $25/trip, card processing 30¢/trip."],
  ["per_trip_hour", "Cost for each booked hour. Example: dock crew labor $20/trip hour."],
  ["percent_revenue", "A percent of what the trip brought in. Example: card processing 2.9%."],
];

function describe(c: CostRow) {
  if (c.basis === "percent_revenue") return `${c.percentBps / 100}% of trip revenue`;
  const unit = { monthly: "/month", per_trip: "/trip", per_trip_hour: "/trip hour", per_engine_hour: "/engine hour" }[c.basis] ?? "";
  return `${fmtMoney(c.amountCents)}${unit}`;
}

export default async function AssumptionsPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  if (!can(s?.role, "reports")) return <Notice tone="warn">You don&apos;t have access to reports.</Notice>;
  const canEdit = can(s?.role, "accounting");

  const [boats, costs] = await Promise.all([
    prisma.boat.findMany({ where: { status: { not: "retired" } }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.boatCost.findMany({ orderBy: [{ category: "asc" }, { createdAt: "asc" }] }),
  ]);
  const hasPlaceholders = costs.some((c) => c.name.startsWith(PLACEHOLDER_PREFIX));
  const groups: { key: string; title: string; boatId: string | null; rows: CostRow[] }[] = [
    { key: "fleet", title: "Whole fleet (shared costs)", boatId: null, rows: costs.filter((c) => !c.boatId) },
    ...boats.map((b) => ({ key: b.id, title: b.name, boatId: b.id as string | null, rows: costs.filter((c) => c.boatId === b.id) })),
  ];

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Cost assumptions"
        subtitle="Your best guess at what each trip costs to run. Used for gross profit and breakeven until real expenses come in from Xero."
        actions={<Link href="/admin/profit" className="btn-secondary">Back to profit</Link>}
      />
      <FlashMessage msg={sp.msg} err={sp.err} />
      {!canEdit && <Notice tone="info">You can view these. Only Admin and Accounting logins can change them.</Notice>}
      {hasPlaceholders && <Notice tone="warn">Some costs are PLACEHOLDER sample numbers. Replace them with your real costs (and remove “PLACEHOLDER:” from the name) so profit is accurate.</Notice>}

      <div className="card card-pad text-sm">
        <div className="font-semibold">How costs are charged</div>
        <ul className="mt-2 space-y-1 text-slate-700">
          {BASIS_HELP.map(([k, help]) => <li key={k}><b>{BASIS_LABELS[k]}:</b> {help}</li>)}
        </ul>
        <p className="muted mt-2 text-xs">
          <b>Real expenses win.</b> If a boat has real expenses of a cost type in a month (from Xero, CSV, or typed in), those replace the estimate for that type in that month.
          Whole-fleet monthly costs are split evenly across your boats; whole-fleet per-trip, per-hour and percent costs apply to every trip.
        </p>
        {canEdit && costs.length === 0 && (
          <form action={addSampleCosts} className="mt-3">
            <button className="btn-secondary btn-sm">Add sample costs to every boat (placeholders)</button>
          </form>
        )}
      </div>

      {groups.map((g) => (
        <div key={g.key} className="card card-pad space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="h2 flex-1">{g.title}</h2>
            {canEdit && g.boatId && g.rows.length > 0 && boats.length > 1 && (
              <form action={copyCostsToAllBoats}>
                <input type="hidden" name="boatId" value={g.boatId} />
                <button className="btn-secondary btn-sm">Copy these to the other boats</button>
              </form>
            )}
          </div>
          {g.rows.length === 0 && !canEdit && <Empty>No costs here.</Empty>}
          {!canEdit ? (
            g.rows.length > 0 && (
              <ul className="divide-y divide-slate-100 text-sm">
                {g.rows.map((c) => (
                  <li key={c.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>{c.name} <span className="muted">· {COST_CATEGORIES.find((x) => x.key === c.category)?.label ?? c.category}</span></span>
                    <span>{describe(c)} {!c.active && <Pill>Off</Pill>}</span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="space-y-2">
              {[...g.rows, null].map((c) => (
                <CostForm key={c?.id ?? "new"} cost={c} boatId={g.boatId} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CostForm({ cost, boatId }: { cost: CostRow | null; boatId: string | null }) {
  return (
    <div className={`rounded-lg border p-3 ${cost ? "border-slate-200" : "border-dashed border-slate-300"} ${cost && !cost.active ? "opacity-60" : ""}`}>
      <form action={saveCost} className="grid grid-cols-12 items-end gap-2">
        <input type="hidden" name="id" value={cost?.id ?? ""} />
        <input type="hidden" name="boatId" value={boatId ?? ""} />
        <div className="col-span-12 sm:col-span-3">
          <label className="label text-xs">{cost ? "Name" : "Add a cost"}</label>
          <input name="name" className="input" defaultValue={cost?.name} placeholder="e.g. Fuel" />
        </div>
        <div className="col-span-6 sm:col-span-3">
          <label className="label text-xs">Cost type</label>
          <select name="category" className="input" defaultValue={cost?.category ?? "fuel"}>
            {COST_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div className="col-span-6 sm:col-span-2">
          <label className="label text-xs">Charged</label>
          <select name="basis" className="input" defaultValue={cost?.basis ?? "per_trip"}>
            {Object.entries(BASIS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="col-span-4 sm:col-span-1">
          <label className="label text-xs">$ amount</label>
          <input name="amount" className="input" defaultValue={cost && cost.basis !== "percent_revenue" ? centsToInput(cost.amountCents) : ""} placeholder="18.00" />
        </div>
        <div className="col-span-4 sm:col-span-1">
          <label className="label text-xs">or %</label>
          <input name="percent" type="number" step="0.01" min="0" max="100" className="input" defaultValue={cost?.basis === "percent_revenue" ? cost.percentBps / 100 : ""} placeholder="2.9" />
        </div>
        <div className="col-span-4 flex items-center gap-2 sm:col-span-2">
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="active" defaultChecked={cost?.active ?? true} /> On</label>
          <button className="btn-primary btn-sm">{cost ? "Save" : "Add"}</button>
        </div>
      </form>
      {cost && (
        <form action={deleteCost} className="mt-1 text-right">
          <input type="hidden" name="id" value={cost.id} />
          <span className="muted mr-3 text-xs">{describe(cost)}</span>
          <button className="text-xs text-rose-700 hover:underline">Remove</button>
        </form>
      )}
    </div>
  );
}

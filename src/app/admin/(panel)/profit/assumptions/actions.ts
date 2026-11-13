"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { COST_LABELS } from "@/lib/constants";
import { parseMoney } from "@/lib/money";
import { BASIS_LABELS, seedCostAssumptions } from "@/lib/profit";

const PATH = "/admin/profit/assumptions";
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (msg?: string, err?: string): never => {
  const q = new URLSearchParams();
  if (msg) q.set("msg", msg);
  if (err) q.set("err", err);
  revalidatePath(PATH);
  revalidatePath("/admin/profit");
  redirect(`${PATH}${q.size ? `?${q}` : ""}`);
};

export async function saveCost(f: FormData) {
  await requirePermission("accounting");
  const id = str(f, "id");
  const name = str(f, "name");
  const basis = str(f, "basis");
  const category = str(f, "category");
  const boatId = str(f, "boatId") || null;
  if (!name) back(undefined, "Give the cost a name, e.g. “Boat lift”.");
  if (!BASIS_LABELS[basis]) back(undefined, "Pick how the cost is charged.");
  let amountCents = 0;
  let percentBps = 0;
  if (basis === "percent_revenue") {
    const p = Number(str(f, "percent"));
    if (!Number.isFinite(p) || p < 0 || p > 100) back(undefined, "Enter a percent between 0 and 100, e.g. 2.9.");
    percentBps = Math.round(p * 100);
  } else {
    const c = parseMoney(str(f, "amount"));
    if (c == null || c < 0) back(undefined, "Enter an amount, e.g. 18.00.");
    amountCents = c!;
  }
  if (boatId && !(await prisma.boat.findUnique({ where: { id: boatId } }))) back(undefined, "That boat wasn't found.");
  const data = {
    name,
    basis,
    category: COST_LABELS[category] ? category : "other",
    boatId,
    amountCents,
    percentBps,
    active: f.get("active") === "on",
  };
  if (id) await prisma.boatCost.update({ where: { id }, data });
  else await prisma.boatCost.create({ data });
  back(id ? "Saved." : "Cost added.");
}

export async function deleteCost(f: FormData) {
  await requirePermission("accounting");
  await prisma.boatCost.deleteMany({ where: { id: str(f, "id") } });
  back("Cost removed.");
}

export async function addSampleCosts() {
  await requirePermission("accounting");
  const n = await seedCostAssumptions();
  back(n ? `Added ${n} PLACEHOLDER sample costs. Replace the amounts with your real numbers.` : "Sample costs are already there.");
}

/** Copy one boat's rows to every other active boat (skips names a boat already has). */
export async function copyCostsToAllBoats(f: FormData) {
  await requirePermission("accounting");
  const fromId = str(f, "boatId");
  const rows = await prisma.boatCost.findMany({ where: { boatId: fromId } });
  const boats = await prisma.boat.findMany({ where: { status: { not: "retired" }, id: { not: fromId } } });
  let n = 0;
  for (const b of boats)
    for (const r of rows) {
      if (await prisma.boatCost.findFirst({ where: { boatId: b.id, name: r.name } })) continue;
      await prisma.boatCost.create({ data: { boatId: b.id, name: r.name, category: r.category, basis: r.basis, amountCents: r.amountCents, percentBps: r.percentBps, active: r.active } });
      n++;
    }
  back(`Copied ${n} cost${n === 1 ? "" : "s"} to the other boats.`);
}

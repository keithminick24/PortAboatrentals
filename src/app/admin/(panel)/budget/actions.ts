"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { parseMoney } from "@/lib/money";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Save the 12-month grid. Inputs: month (repeated), rev_<m>, trips_<m>, exp_<m>, notes_<m>. */
export async function saveBudget(f: FormData) {
  await requirePermission("accounting");
  const year = str(f, "year");
  const boatId = str(f, "boatId") || null;
  const q = new URLSearchParams({ year });
  if (boatId) q.set("boat", boatId);
  const done = (key: "msg" | "err", text: string): never => {
    q.set(key, text);
    revalidatePath("/admin/budget");
    redirect(`/admin/budget?${q}`);
  };
  if (boatId && !(await prisma.boat.findUnique({ where: { id: boatId } }))) done("err", "That boat wasn't found.");

  const bad: string[] = [];
  let saved = 0;
  for (const month of f.getAll("month").map(String)) {
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const money = (k: string) => {
      const v = str(f, `${k}_${month}`);
      if (v === "") return 0;
      const c = parseMoney(v);
      if (c == null || c < 0) {
        bad.push(month);
        return null;
      }
      return c;
    };
    const revenueGoalCents = money("rev");
    const expenseBudgetCents = money("exp");
    const tripsRaw = str(f, `trips_${month}`);
    const tripsGoal = tripsRaw === "" ? 0 : Math.max(0, Math.round(Number(tripsRaw)) || 0);
    if (revenueGoalCents == null || expenseBudgetCents == null) continue;
    const data = { revenueGoalCents, tripsGoal, expenseBudgetCents, notes: str(f, `notes_${month}`) };
    // Budget is unique on (month, boatId) but boatId can be null, so find first then write.
    const existing = await prisma.budget.findFirst({ where: { month, boatId } });
    if (existing) await prisma.budget.update({ where: { id: existing.id }, data });
    else if (revenueGoalCents || tripsGoal || expenseBudgetCents || data.notes) await prisma.budget.create({ data: { ...data, month, boatId } });
    saved++;
  }
  if (bad.length) done("err", `Couldn't read some amounts (${[...new Set(bad)].join(", ")}). Use numbers like 12500 or 12,500.00.`);
  done("msg", `Saved ${saved} months.`);
}

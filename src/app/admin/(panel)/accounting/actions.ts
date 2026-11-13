"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { COST_LABELS } from "@/lib/constants";
import { parseMoney } from "@/lib/money";
import { isValidDateStr, zonedToUtc } from "@/lib/time";
import { parseExpenseCsv } from "@/lib/expenseCsv";
import { disconnectXero, reapplyMapping, syncXeroAccounts, syncXeroExpenses } from "@/lib/xero";

const PATH = "/admin/accounting";
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (msg?: string, err?: string, extra = ""): never => {
  const q = new URLSearchParams(extra);
  if (msg) q.set("msg", msg);
  if (err) q.set("err", err);
  revalidatePath(PATH);
  redirect(`${PATH}${q.size ? `?${q}` : ""}`);
};
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function xeroSyncNow() {
  await requirePermission("accounting");
  let note = "";
  try {
    note = await syncXeroExpenses();
  } catch (e) {
    back(undefined, errMsg(e));
  }
  back(note);
}

/** Pull the last 13 months again (e.g. after un-ignoring an account). */
export async function xeroFullResync() {
  await requirePermission("accounting");
  await prisma.xeroConnection.updateMany({ where: { id: 1 }, data: { lastSyncAt: null } });
  return xeroSyncNow();
}

export async function xeroRefreshAccounts() {
  await requirePermission("accounting");
  let r = { added: 0, total: 0 };
  try {
    r = await syncXeroAccounts();
  } catch (e) {
    back(undefined, errMsg(e));
  }
  back(`Found ${r.total} expense accounts in Xero (${r.added} new).`);
}

export async function xeroDisconnect() {
  await requirePermission("accounting");
  await disconnectXero();
  back("Xero disconnected. Expenses already pulled in are kept.");
}

/** Save the whole mapping table at once. Inputs are named `<field>_<mappingId>`. */
export async function saveMappings(f: FormData) {
  await requirePermission("accounting");
  const ids = f.getAll("mappingId").map(String);
  const boatIds = new Set((await prisma.boat.findMany({ select: { id: true } })).map((b) => b.id));
  let changed = 0;
  for (const id of ids) {
    const m = await prisma.expenseMapping.findUnique({ where: { id } });
    if (!m) continue;
    const category = str(f, `category_${id}`);
    const boatId = str(f, `boat_${id}`);
    const ignore = f.get(`ignore_${id}`) === "on";
    const data = {
      category: COST_LABELS[category] ? category : "other",
      boatId: boatIds.has(boatId) ? boatId : null,
      ignore,
    };
    if (data.category === m.category && data.boatId === m.boatId && data.ignore === m.ignore) continue;
    await prisma.expenseMapping.update({ where: { id }, data });
    await reapplyMapping(m.xeroAccountCode);
    changed++;
  }
  back(changed ? `Saved ${changed} account mapping${changed === 1 ? "" : "s"}. Pulled-in expenses were updated.` : "No changes.");
}

export async function addExpense(f: FormData) {
  const s = await requirePermission("accounting");
  const date = str(f, "date");
  const amountCents = parseMoney(str(f, "amount"));
  const category = str(f, "category");
  const boatId = str(f, "boatId") || null;
  if (!isValidDateStr(date)) back(undefined, "Pick a date.");
  if (amountCents == null || amountCents === 0) back(undefined, "Enter an amount, e.g. 125.50.");
  await prisma.expense.create({
    data: {
      date: zonedToUtc(date, "12:00"),
      amountCents: Math.abs(amountCents!),
      category: COST_LABELS[category] ? category : "other",
      boatId,
      vendor: str(f, "vendor"),
      description: str(f, "description"),
      source: "manual",
      createdBy: s.name,
    },
  });
  back("Expense added.");
}

export async function deleteExpense(f: FormData) {
  await requirePermission("accounting");
  const id = str(f, "id");
  const e = await prisma.expense.findUnique({ where: { id } });
  if (!e) back(undefined, "That expense is already gone.");
  if (e!.source === "xero") back(undefined, "That one came from Xero. Change or delete it in Xero, or mark its account as Ignore.");
  await prisma.expense.delete({ where: { id } });
  back("Expense deleted.", undefined, str(f, "keep"));
}

export async function importExpensesCsv(f: FormData) {
  const s = await requirePermission("accounting");
  let text = str(f, "csv");
  const file = f.get("file");
  if (file && typeof file === "object" && "text" in file && (file as File).size > 0) text = await (file as File).text();
  if (!text) back(undefined, "Choose a CSV file or paste the rows.");
  const { rows, errors } = parseExpenseCsv(text);
  const boats = await prisma.boat.findMany({ select: { id: true, name: true } });
  const byName = new Map(boats.map((b) => [b.name.trim().toLowerCase(), b.id]));
  const unknownBoats = new Set<string>();
  for (const r of rows) {
    const boatId = r.boatName ? byName.get(r.boatName.toLowerCase()) ?? null : null;
    if (r.boatName && !boatId) unknownBoats.add(r.boatName);
    await prisma.expense.create({
      data: {
        date: zonedToUtc(r.date, "12:00"),
        amountCents: r.amountCents,
        category: r.category,
        boatId,
        vendor: r.vendor,
        description: r.description,
        source: "csv",
        createdBy: s.name,
      },
    });
  }
  const notes = [...errors.slice(0, 5)];
  if (errors.length > 5) notes.push(`…and ${errors.length - 5} more lines skipped.`);
  if (unknownBoats.size) notes.push(`Boat names not found (saved as fleet-wide): ${[...unknownBoats].join(", ")}.`);
  if (!rows.length) back(undefined, `Nothing imported. ${notes.join(" ")}`);
  back(`Imported ${rows.length} expense${rows.length === 1 ? "" : "s"}.${notes.length ? " " + notes.join(" ") : ""}`);
}

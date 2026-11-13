"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { parseMoney } from "@/lib/money";
import { zonedToUtc } from "@/lib/time";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (f: FormData, msg?: string, err?: string): never => {
  const q = new URLSearchParams(str(f, "query"));
  q.delete("msg");
  q.delete("err");
  if (msg) q.set("msg", msg);
  if (err) q.set("err", err);
  redirect(`/admin/payroll?${q}`);
};

/** "YYYY-MM-DDTHH:MM" (local business time) → UTC Date. */
function parseLocal(v: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(v);
  return m ? zonedToUtc(m[1], m[2]) : null;
}

export async function saveTimeEntry(f: FormData) {
  const s = await requirePermission("schedule");
  const id = str(f, "id");
  const userId = str(f, "userId");
  const clockIn = parseLocal(str(f, "clockIn"));
  const clockOut = str(f, "clockOut") ? parseLocal(str(f, "clockOut")) : null;
  if (!clockIn) back(f, undefined, "Enter a clock-in time.");
  if (str(f, "clockOut") && !clockOut) back(f, undefined, "Clock-out time isn't valid.");
  if (clockOut && clockOut <= clockIn!) back(f, undefined, "Clock-out must be after clock-in.");
  if (clockOut && clockOut.getTime() - clockIn!.getTime() > 24 * 3600000) back(f, undefined, "That entry is longer than 24 hours. Check the dates.");
  const data = { clockIn: clockIn!, clockOut, notes: str(f, "notes").slice(0, 500), editedBy: s.name };
  if (id) await prisma.timeEntry.update({ where: { id }, data });
  else {
    if (!userId) back(f, undefined, "Pick a crew member.");
    await prisma.timeEntry.create({ data: { ...data, userId } });
  }
  back(f, id ? "Time entry updated" : "Time entry added");
}

export async function deleteTimeEntry(f: FormData) {
  await requirePermission("schedule");
  await prisma.timeEntry.deleteMany({ where: { id: str(f, "id") } });
  back(f, "Time entry deleted");
}

export async function saveCrewDetails(f: FormData) {
  await requirePermission("payroll");
  const id = str(f, "userId");
  const rateRaw = str(f, "hourlyRate");
  const rate = rateRaw ? parseMoney(rateRaw) : 0;
  if (rate == null || rate < 0 || rate > 100000) back(f, undefined, "Hourly rate should look like 15.00.");
  const color = /^#[0-9a-fA-F]{6}$/.test(str(f, "color")) ? str(f, "color") : "#1E6286";
  await prisma.adminUser.update({
    where: { id },
    data: { phone: str(f, "phone").slice(0, 30), hourlyRateCents: rate!, gustoEmployeeId: str(f, "gustoEmployeeId") || null, color },
  });
  back(f, "Crew details saved");
}

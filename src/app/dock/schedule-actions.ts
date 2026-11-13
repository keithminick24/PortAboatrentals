"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { isValidDateStr, todayLocal } from "@/lib/time";

/** Crew self-service: time clock and time-off requests (dock app). */

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, msg?: string, err?: string): never => {
  const q = new URLSearchParams();
  if (msg) q.set("msg", msg);
  if (err) q.set("err", err);
  redirect(`${path}${q.size ? `?${q}` : ""}`);
};
const safePath = (p: string) => (p.startsWith("/dock") ? p : "/dock");

export async function clockIn(f: FormData) {
  const s = await requireStaff();
  const path = safePath(str(f, "returnTo"));
  const open = await prisma.timeEntry.findFirst({ where: { userId: s.uid, clockOut: null } });
  if (open) back(path, "You're already clocked in.");
  await prisma.timeEntry.create({ data: { userId: s.uid, clockIn: new Date() } });
  back(path, "Clocked in. Have a good shift!");
}

export async function clockOut(f: FormData) {
  const s = await requireStaff();
  const path = safePath(str(f, "returnTo"));
  const open = await prisma.timeEntry.findFirst({ where: { userId: s.uid, clockOut: null }, orderBy: { clockIn: "desc" } });
  if (!open) back(path, undefined, "You're not clocked in.");
  const notes = str(f, "notes").slice(0, 500);
  await prisma.timeEntry.update({ where: { id: open!.id }, data: { clockOut: new Date(), ...(notes ? { notes } : {}) } });
  back(path, "Clocked out. Thanks!");
}

export async function requestTimeOff(f: FormData) {
  const s = await requireStaff();
  const startDate = str(f, "startDate");
  const endDate = str(f, "endDate") || startDate;
  if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) back("/dock/schedule", undefined, "Pick the day(s) you need off.");
  if (endDate < startDate) back("/dock/schedule", undefined, "The last day can't be before the first day.");
  if (startDate < todayLocal()) back("/dock/schedule", undefined, "Pick a day in the future.");
  await prisma.timeOffRequest.create({ data: { userId: s.uid, startDate, endDate, reason: str(f, "reason").slice(0, 300) } });
  back("/dock/schedule", "Request sent. A manager will approve or deny it.");
}

export async function cancelTimeOff(f: FormData) {
  const s = await requireStaff();
  await prisma.timeOffRequest.deleteMany({ where: { id: str(f, "id"), userId: s.uid, status: "pending" } });
  back("/dock/schedule", "Request cancelled");
}

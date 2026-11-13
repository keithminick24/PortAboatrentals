"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { sendText } from "@/lib/messaging";
import { addDays, isValidDateStr, localDate, localTime, zonedToUtc } from "@/lib/time";
import { mondayOf } from "@/lib/crewMath";
import { POSITIONS, weekText } from "@/lib/schedule";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (week: string, msg?: string, err?: string): never => {
  const q = new URLSearchParams();
  if (week) q.set("week", week);
  if (msg) q.set("msg", msg);
  if (err) q.set("err", err);
  redirect(`/admin/schedule?${q}`);
};
const weekOf = (f: FormData) => (isValidDateStr(str(f, "week")) ? mondayOf(str(f, "week")) : "");

export async function saveShift(f: FormData) {
  await requirePermission("schedule");
  const id = str(f, "id");
  const date = str(f, "date");
  const start = str(f, "start");
  const end = str(f, "end");
  const week = isValidDateStr(date) ? mondayOf(date) : weekOf(f);
  const userId = str(f, "userId");
  if (!userId) back(week, undefined, "Pick a crew member.");
  if (!isValidDateStr(date) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) back(week, undefined, "Enter a date, start and end time.");
  const startsAt = zonedToUtc(date, start);
  // An end time earlier than the start means the shift runs past midnight
  const endsAt = zonedToUtc(end <= start ? addDays(date, 1) : date, end);
  const position = (POSITIONS as readonly string[]).includes(str(f, "position")) ? str(f, "position") : "dock";
  const data = { userId, startsAt, endsAt, position, notes: str(f, "notes").slice(0, 500), published: str(f, "published") === "on" };
  if (id) await prisma.shift.update({ where: { id }, data });
  else await prisma.shift.create({ data });
  back(week, id ? "Shift updated" : "Shift added");
}

export async function deleteShift(f: FormData) {
  await requirePermission("schedule");
  await prisma.shift.deleteMany({ where: { id: str(f, "id") } });
  back(weekOf(f), "Shift deleted");
}

export async function copyLastWeek(f: FormData) {
  await requirePermission("schedule");
  const week = weekOf(f);
  if (!week) back("", undefined, "Pick a week.");
  const prevStart = zonedToUtc(addDays(week, -7), "00:00");
  const prevEnd = zonedToUtc(week, "00:00");
  const [prev, existing] = await Promise.all([
    prisma.shift.findMany({ where: { startsAt: { gte: prevStart, lt: prevEnd } } }),
    prisma.shift.findMany({ where: { startsAt: { gte: prevEnd, lt: zonedToUtc(addDays(week, 7), "00:00") } } }),
  ]);
  const seen = new Set(existing.map((s) => `${s.userId}|${s.startsAt.getTime()}`));
  let added = 0;
  for (const s of prev) {
    // Same local wall-clock times one week later (safe across daylight saving changes)
    const startsAt = zonedToUtc(addDays(localDate(s.startsAt), 7), localTime(s.startsAt));
    const endsAt = zonedToUtc(addDays(localDate(s.endsAt), 7), localTime(s.endsAt));
    if (seen.has(`${s.userId}|${startsAt.getTime()}`)) continue;
    await prisma.shift.create({ data: { userId: s.userId, startsAt, endsAt, position: s.position, notes: s.notes, published: false } });
    added++;
  }
  back(week, added ? `Copied ${added} shift(s) from last week as a draft. Publish when ready.` : "Nothing new to copy from last week.");
}

export async function setWeekPublished(f: FormData) {
  await requirePermission("schedule");
  const week = weekOf(f);
  const published = str(f, "published") === "1";
  const r = await prisma.shift.updateMany({
    where: { startsAt: { gte: zonedToUtc(week, "00:00"), lt: zonedToUtc(addDays(week, 7), "00:00") } },
    data: { published },
  });
  back(week, published ? `Published ${r.count} shift(s). Crew can see them in the dock app.` : "Week moved back to draft.");
}

export async function decideTimeOff(f: FormData) {
  const s = await requirePermission("schedule");
  const status = str(f, "decision") === "approve" ? "approved" : "denied";
  const req = await prisma.timeOffRequest.update({ where: { id: str(f, "id") }, data: { status, decidedBy: s.name }, include: { user: true } });
  if (req.user.phone) {
    await sendText({
      to: req.user.phone,
      body: `Your time off ${req.startDate === req.endDate ? `on ${req.startDate}` : `${req.startDate} to ${req.endDate}`} was ${status}.`,
      sentBy: s.name,
    });
  }
  back(weekOf(f), `Time off ${status}`);
}

export async function textWeek(f: FormData) {
  const s = await requirePermission("schedule");
  const week = weekOf(f);
  const user = await prisma.adminUser.findUniqueOrThrow({ where: { id: str(f, "userId") } });
  if (!user.phone) back(week, undefined, `Add a phone number for ${user.name} first (Hours & tips → Crew details).`);
  const shifts = await prisma.shift.findMany({
    where: { userId: user.id, published: true, startsAt: { gte: zonedToUtc(week, "00:00"), lt: zonedToUtc(addDays(week, 7), "00:00") } },
    orderBy: { startsAt: "asc" },
  });
  if (shifts.length === 0) back(week, undefined, `${user.name} has no published shifts this week.`);
  const r = await sendText({ to: user.phone, body: weekText(user.name, week, shifts), sentBy: s.name });
  if (r.ok) back(week, `Texted ${user.name} their week`);
  else back(week, undefined, r.error);
}

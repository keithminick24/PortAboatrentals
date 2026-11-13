import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { addDays, fmtTime, fmtDuration, todayLocal, zonedToUtc } from "@/lib/time";
import { shiftLabel, POSITION_LABELS } from "@/lib/schedule";
import { clockIn, clockOut } from "@/app/dock/schedule-actions";

/** Clock In / Clock Out card at the top of the dock home page. */
export default async function ClockCard({ returnTo = "/dock" }: { returnTo?: string }) {
  const s = await getSession();
  if (!s) return null;
  const today = todayLocal();
  const [open, shift] = await Promise.all([
    prisma.timeEntry.findFirst({ where: { userId: s.uid, clockOut: null }, orderBy: { clockIn: "desc" } }),
    prisma.shift.findFirst({
      where: { userId: s.uid, published: true, startsAt: { gte: zonedToUtc(today, "00:00"), lt: zonedToUtc(addDays(today, 1), "00:00") } },
      orderBy: { startsAt: "asc" },
    }),
  ]);
  const shiftLine = shift ? `Today: ${shiftLabel(shift)} · ${POSITION_LABELS[shift.position] ?? shift.position}` : "No shift scheduled today";

  return (
    <div className={`rounded-xl p-4 shadow-sm ${open ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-white"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{open ? `Clocked in since ${fmtTime(open.clockIn)}` : "You're clocked out"}</div>
          <div className="text-sm text-slate-600">
            {open ? `${fmtDuration(Math.max(0, Math.round((Date.now() - open.clockIn.getTime()) / 60000)))} so far · ` : ""}
            {shiftLine}
          </div>
        </div>
        <Link href="/dock/schedule" className="shrink-0 text-sm text-brand">My schedule →</Link>
      </div>
      <form action={open ? clockOut : clockIn} className="mt-3">
        <input type="hidden" name="returnTo" value={returnTo} />
        <button className={`w-full rounded-xl py-3 text-lg font-bold text-white ${open ? "bg-slate-700" : "bg-emerald-600"}`}>
          {open ? "Clock out" : "Clock in"}
        </button>
      </form>
    </div>
  );
}

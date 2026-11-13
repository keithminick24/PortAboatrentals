import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { addDays, fmtDateStr, localDate, todayLocal, zonedToUtc } from "@/lib/time";
import { fmtMoney } from "@/lib/money";
import { hours2, mondayOf, weeklyOvertime } from "@/lib/crewMath";
import { POSITION_LABELS, shiftLabel } from "@/lib/schedule";
import { tipsForPeriod } from "@/lib/tips";
import FlashMessage from "@/components/FlashMessage";
import ClockCard from "@/components/crew/ClockCard";
import { cancelTimeOff, requestTimeOff } from "../../schedule-actions";

export default async function MySchedule({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const s = await requireStaff();
  const sp = await searchParams;
  const today = todayLocal();
  const mon = mondayOf(today);
  const weekStart = zonedToUtc(mon, "00:00");
  const weekEnd = zonedToUtc(addDays(mon, 7), "00:00");
  const lastWeekStart = zonedToUtc(addDays(mon, -7), "00:00");

  const [shifts, requests, entries, thisWeekTips, lastWeekTips] = await Promise.all([
    prisma.shift.findMany({
      where: { userId: s.uid, published: true, endsAt: { gte: new Date() }, startsAt: { lt: zonedToUtc(addDays(today, 21), "00:00") } },
      orderBy: { startsAt: "asc" },
    }),
    prisma.timeOffRequest.findMany({ where: { userId: s.uid, endDate: { gte: today } }, orderBy: { startDate: "asc" } }),
    prisma.timeEntry.findMany({ where: { userId: s.uid, clockIn: { gte: weekStart, lt: weekEnd } }, orderBy: { clockIn: "asc" } }),
    tipsForPeriod(weekStart, weekEnd),
    tipsForPeriod(lastWeekStart, weekStart),
  ]);
  // Count the open entry up to now so the total is live
  const live = entries.map((e) => ({ clockIn: e.clockIn, clockOut: e.clockOut ?? new Date() }));
  const hrs = weeklyOvertime(live, weekStart, weekEnd);
  const mine = (t: Awaited<ReturnType<typeof tipsForPeriod>>) => t.byPerson.find((p) => p.userId === s.uid);
  const tw = mine(thisWeekTips);
  const lw = mine(lastWeekTips);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">My schedule</h1>
      <FlashMessage msg={sp.msg} err={sp.err} />
      <ClockCard returnTo="/dock/schedule" />

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">My hours this week</div>
          <div className="text-2xl font-bold">{hours2(hrs.regularMinutes + hrs.overtimeMinutes)}</div>
          {hrs.overtimeMinutes > 0 && <div className="text-xs text-amber-700">{hours2(hrs.overtimeMinutes)} overtime</div>}
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">My tips this week</div>
          <div className="text-2xl font-bold">{fmtMoney(tw?.totalCents ?? 0)}</div>
          <div className="text-xs text-slate-500">
            {tw ? `${fmtMoney(tw.cardCents)} card · ${fmtMoney(tw.cashCents)} cash` : "Mon–Sun"}
            {lw ? ` · last week ${fmtMoney(lw.totalCents)}` : ""}
          </div>
        </div>
      </div>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-bold">Upcoming shifts</h2>
        {shifts.length === 0 ? (
          <p className="text-sm text-slate-500">No shifts posted yet. Check back after the manager publishes the schedule.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shifts.map((x) => (
              <li key={x.id} className="flex items-baseline justify-between gap-3 py-2">
                <div>
                  <div className="font-semibold">{localDate(x.startsAt) === today ? "Today" : fmtDateStr(localDate(x.startsAt))}</div>
                  {x.notes && <div className="text-xs text-slate-500">{x.notes}</div>}
                </div>
                <div className="text-right text-sm">
                  <div>{shiftLabel(x)}</div>
                  <div className="text-xs text-slate-500">{POSITION_LABELS[x.position] ?? x.position}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-bold">Time off</h2>
        {requests.length > 0 && (
          <ul className="mb-3 space-y-1 text-sm">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span>
                  {r.startDate === r.endDate ? fmtDateStr(r.startDate) : `${fmtDateStr(r.startDate)} – ${fmtDateStr(r.endDate)}`}{" "}
                  <span className={r.status === "approved" ? "text-emerald-700" : r.status === "denied" ? "text-rose-700" : "text-amber-700"}>
                    · {r.status === "pending" ? "waiting" : r.status}
                  </span>
                </span>
                {r.status === "pending" && (
                  <form action={cancelTimeOff}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="text-xs text-slate-500 underline">Cancel</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <form action={requestTimeOff} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">First day off</label>
              <input type="date" name="startDate" className="input" min={today} required />
            </div>
            <div>
              <label className="label">Last day off</label>
              <input type="date" name="endDate" className="input" min={today} />
            </div>
          </div>
          <input name="reason" className="input" placeholder="Reason (optional)" />
          <button className="btn-primary w-full">Request time off</button>
        </form>
      </section>
    </div>
  );
}

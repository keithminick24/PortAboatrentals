import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { addDays, fmtDateStr, fmtTime, isValidDateStr, localDate, localTime, todayLocal, zonedToUtc } from "@/lib/time";
import { mondayOf } from "@/lib/crewMath";
import { POSITIONS, POSITION_LABELS, shiftLabel } from "@/lib/schedule";
import { Empty, PageHeader, Pill } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import { copyLastWeek, decideTimeOff, deleteShift, saveShift, setWeekPublished, textWeek } from "./actions";

export const dynamic = "force-dynamic";

const BOOKED = ["confirmed", "checked_out", "returned", "completed"];

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; edit?: string; add?: string; msg?: string; err?: string }>;
}) {
  const s = await requirePermission("ops");
  const canEdit = can(s.role, "schedule");
  const sp = await searchParams;
  const today = todayLocal();
  const week = mondayOf(isValidDateStr(sp.week) ? sp.week : today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const start = zonedToUtc(week, "00:00");
  const end = zonedToUtc(addDays(week, 7), "00:00");

  const [staff, shifts, bookings, timeOff, clockedIn, todayShifts] = await Promise.all([
    prisma.adminUser.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.shift.findMany({ where: { startsAt: { gte: start, lt: end } }, orderBy: { startsAt: "asc" } }),
    prisma.booking.findMany({ where: { status: { in: BOOKED }, startsAt: { gte: start, lt: end } }, select: { startsAt: true } }),
    prisma.timeOffRequest.findMany({
      where: { OR: [{ status: "pending", endDate: { gte: addDays(today, -1) } }, { endDate: { gte: week }, startDate: { lte: days[6] } }] },
      include: { user: true },
      orderBy: { startDate: "asc" },
    }),
    prisma.timeEntry.findMany({ where: { clockOut: null }, include: { user: true } }),
    prisma.shift.findMany({
      where: { startsAt: { gte: zonedToUtc(today, "00:00"), lt: zonedToUtc(addDays(today, 1), "00:00") } },
      include: { user: true },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  const tripsByDay = new Map<string, number>();
  for (const b of bookings) tripsByDay.set(localDate(b.startsAt), (tripsByDay.get(localDate(b.startsAt)) ?? 0) + 1);
  const cell = (userId: string, day: string) => shifts.filter((x) => x.userId === userId && localDate(x.startsAt) === day);
  const offOn = (userId: string, day: string) =>
    timeOff.find((t) => t.userId === userId && t.status === "approved" && t.startDate <= day && t.endDate >= day);
  const drafts = shifts.filter((x) => !x.published).length;
  const pendingOff = timeOff.filter((t) => t.status === "pending");

  const editing = sp.edit ? shifts.find((x) => x.id === sp.edit) : undefined;
  const [addUser, addDate] = (sp.add ?? "").split(":");
  const formDefaults = editing
    ? { id: editing.id, userId: editing.userId, date: localDate(editing.startsAt), start: localTime(editing.startsAt), end: localTime(editing.endsAt), position: editing.position, notes: editing.notes, published: editing.published }
    : { id: "", userId: addUser ?? "", date: isValidDateStr(addDate) ? addDate : week, start: "08:00", end: "16:00", position: "dock", notes: "", published: drafts === 0 && shifts.length > 0 };
  const showForm = canEdit && (!!editing || !!sp.add);
  const href = (q: Record<string, string>) => `/admin/schedule?${new URLSearchParams({ week, ...q })}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Crew schedule"
        subtitle={`Week of ${fmtDateStr(week, { month: "long" })}`}
        actions={
          <>
            <Link href={`/admin/schedule?week=${addDays(week, -7)}`} className="btn-secondary btn-sm">← Prev</Link>
            <Link href="/admin/schedule" className="btn-secondary btn-sm">This week</Link>
            <Link href={`/admin/schedule?week=${addDays(week, 7)}`} className="btn-secondary btn-sm">Next →</Link>
          </>
        }
      />
      <FlashMessage msg={sp.msg} err={sp.err} />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card card-pad md:col-span-2">
          <h2 className="h2 mb-2">Working today</h2>
          {todayShifts.length === 0 ? (
            <p className="muted">No one is scheduled today.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {todayShifts.map((x) => {
                const on = clockedIn.find((c) => c.userId === x.userId);
                return (
                  <li key={x.id} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: x.user.color }} />
                    <span className="font-medium">{x.user.name}</span>
                    <span className="muted">{shiftLabel(x)} · {POSITION_LABELS[x.position] ?? x.position}</span>
                    {on ? <Pill tone="green">Clocked in {fmtTime(on.clockIn)}</Pill> : <Pill>Not clocked in</Pill>}
                  </li>
                );
              })}
            </ul>
          )}
          {clockedIn.filter((c) => !todayShifts.some((x) => x.userId === c.userId)).map((c) => (
            <div key={c.id} className="mt-1 text-sm">
              <span className="font-medium">{c.user.name}</span> <Pill tone="amber">Clocked in {fmtTime(c.clockIn)}, not scheduled</Pill>
            </div>
          ))}
        </div>
        {canEdit && (
          <div className="card card-pad space-y-2">
            <h2 className="h2">This week</h2>
            {shifts.length === 0 ? (
              <p className="muted">No shifts yet.</p>
            ) : drafts > 0 ? (
              <p className="text-sm"><Pill tone="amber">Draft</Pill> {drafts} shift(s) the crew can&apos;t see yet.</p>
            ) : (
              <p className="text-sm"><Pill tone="green">Published</Pill> The crew can see this week.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {shifts.length > 0 && (
                <form action={setWeekPublished}>
                  <input type="hidden" name="week" value={week} />
                  <input type="hidden" name="published" value={drafts > 0 ? "1" : "0"} />
                  <button className={drafts > 0 ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{drafts > 0 ? "Publish week" : "Back to draft"}</button>
                </form>
              )}
              <form action={copyLastWeek}>
                <input type="hidden" name="week" value={week} />
                <button className="btn-secondary btn-sm">Copy last week</button>
              </form>
              <Link href={href({ add: `:${today >= week && today <= days[6] ? today : week}` })} className="btn-secondary btn-sm">+ Shift</Link>
            </div>
          </div>
        )}
      </div>

      {showForm && (
        <form action={saveShift} className="card card-pad space-y-3 border-brand">
          <input type="hidden" name="id" value={formDefaults.id} />
          <input type="hidden" name="week" value={week} />
          <h2 className="h2">{editing ? "Edit shift" : "Add a shift"}</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <div className="col-span-2">
              <label className="label">Who</label>
              <select name="userId" className="input" defaultValue={formDefaults.userId} required>
                <option value="" disabled>Pick…</option>
                {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="label">Date</label>
              <input type="date" name="date" className="input" defaultValue={formDefaults.date} required />
            </div>
            <div>
              <label className="label">Start</label>
              <input type="time" name="start" className="input" defaultValue={formDefaults.start} step={900} required />
            </div>
            <div>
              <label className="label">End</label>
              <input type="time" name="end" className="input" defaultValue={formDefaults.end} step={900} required />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="label">Position</label>
              <select name="position" className="input" defaultValue={formDefaults.position}>
                {POSITIONS.map((p) => <option key={p} value={p}>{POSITION_LABELS[p]}</option>)}
              </select>
            </div>
            <div className="col-span-2 md:col-span-4">
              <label className="label">Notes (optional)</label>
              <input name="notes" className="input" defaultValue={formDefaults.notes} placeholder="e.g. Open the shop, fuel boats" />
            </div>
            <label className="col-span-2 flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" name="published" defaultChecked={formDefaults.published} /> Published (crew can see it)
            </label>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary btn-sm">{editing ? "Save shift" : "Add shift"}</button>
            <Link href={href({})} className="btn-secondary btn-sm">Cancel</Link>
            {editing && (
              <button formAction={deleteShift} name="id" value={editing.id} className="btn-secondary btn-sm ml-auto text-rose-700">
                Delete shift
              </button>
            )}
          </div>
        </form>
      )}

      {staff.length === 0 ? (
        <Empty>Add staff logins in Settings first.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left">
                <th className="sticky left-0 z-10 w-40 bg-slate-50 p-2">Crew</th>
                {days.map((d) => (
                  <th key={d} className={`p-2 font-medium ${d === today ? "bg-sky-50" : ""}`}>
                    <div>{fmtDateStr(d)}</div>
                    <div className="text-xs font-normal text-slate-500">
                      {tripsByDay.get(d) ?? 0} trip{tripsByDay.get(d) === 1 ? "" : "s"} · {shifts.filter((x) => localDate(x.startsAt) === d).length} on
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 align-top">
                  <td className="sticky left-0 z-10 bg-white p-2">
                    <div className="flex items-center gap-2 font-medium">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: u.color }} />
                      {u.name}
                    </div>
                    {canEdit && (
                      <form action={textWeek}>
                        <input type="hidden" name="week" value={week} />
                        <input type="hidden" name="userId" value={u.id} />
                        <button className="text-xs text-brand underline" title={u.phone ? `Text ${u.phone}` : "No phone on file"}>Text their week</button>
                      </form>
                    )}
                  </td>
                  {days.map((d) => {
                    const off = offOn(u.id, d);
                    return (
                      <td key={d} className={`p-1.5 ${d === today ? "bg-sky-50/50" : ""}`}>
                        <div className="space-y-1">
                          {off && <div className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">Off{off.reason ? `: ${off.reason}` : ""}</div>}
                          {cell(u.id, d).map((x) => {
                            const chip = (
                              <div
                                className={`rounded border-l-4 bg-white px-1.5 py-0.5 text-xs shadow-sm ${x.published ? "" : "border-dashed opacity-70"}`}
                                style={{ borderLeftColor: u.color }}
                                title={x.notes || undefined}
                              >
                                <div className="font-semibold">{POSITION_LABELS[x.position] ?? x.position}</div>
                                <div className="text-slate-600">{shiftLabel(x)}{x.published ? "" : " · draft"}</div>
                              </div>
                            );
                            return canEdit ? <Link key={x.id} href={href({ edit: x.id })} className="block hover:opacity-80">{chip}</Link> : <div key={x.id}>{chip}</div>;
                          })}
                          {canEdit && (
                            <Link href={href({ add: `${u.id}:${d}` })} className="block rounded px-1.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-brand">+ add</Link>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card card-pad">
        <h2 className="h2 mb-2">Time off requests</h2>
        {timeOff.length === 0 ? (
          <p className="muted">No requests.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {[...pendingOff, ...timeOff.filter((t) => t.status !== "pending")].map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-medium">{t.user.name}</span>
                <span>{t.startDate === t.endDate ? fmtDateStr(t.startDate) : `${fmtDateStr(t.startDate)} – ${fmtDateStr(t.endDate)}`}</span>
                {t.reason && <span className="muted">“{t.reason}”</span>}
                <Pill tone={t.status === "approved" ? "green" : t.status === "denied" ? "red" : "amber"}>{t.status}</Pill>
                {t.decidedBy && <span className="muted text-xs">by {t.decidedBy}</span>}
                {canEdit && t.status === "pending" && (
                  <span className="ml-auto flex gap-2">
                    {(["approve", "deny"] as const).map((d) => (
                      <form key={d} action={decideTimeOff}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="week" value={week} />
                        <input type="hidden" name="decision" value={d} />
                        <button className={d === "approve" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{d === "approve" ? "Approve" : "Deny"}</button>
                      </form>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {pendingOff.length === 0 && timeOff.length > 0 && <p className="muted mt-2 text-xs">Nothing waiting for a decision.</p>}
      </div>
    </div>
  );
}

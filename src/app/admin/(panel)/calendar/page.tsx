import Link from "next/link";
import { getSettings, prisma } from "@/lib/db";
import { occupyingWhere } from "@/lib/bookings";
import { STATUS_COLORS } from "@/lib/constants";
import {
  addDays,
  fmtDateStr,
  fmtTime,
  isValidDateStr,
  localDate,
  localTime,
  minutesFromHHMM,
  todayLocal,
  weekdayOf,
  zonedToUtc,
} from "@/lib/time";
import { PageHeader } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import { addBlock, deleteBlock } from "../../actions";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; msg?: string; err?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === "day" ? "day" : sp.view === "month" ? "month" : "week";
  const anchor = isValidDateStr(sp.date) ? sp.date : todayLocal();
  const settings = await getSettings();

  let first: string;
  let days: number;
  if (view === "day") {
    first = anchor;
    days = 1;
  } else if (view === "week") {
    first = addDays(anchor, -weekdayOf(anchor)); // Sunday
    days = 7;
  } else {
    const monthStart = anchor.slice(0, 8) + "01";
    first = addDays(monthStart, -weekdayOf(monthStart));
    days = 42;
  }
  const rangeStart = zonedToUtc(first, "00:00");
  const rangeEnd = zonedToUtc(addDays(first, days), "00:00");

  const [boats, bookings, blocks] = await Promise.all([
    prisma.boat.findMany({ where: { status: { not: "retired" } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.booking.findMany({
      where: { AND: [occupyingWhere(), { startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } }] },
      include: { customer: true, boat: true },
      orderBy: { startsAt: "asc" },
    }),
    prisma.boatBlock.findMany({
      where: { startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } },
      include: { boat: true },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  const step = view === "day" ? 1 : view === "week" ? 7 : 0;
  const prev = view === "month" ? addDays(anchor.slice(0, 8) + "01", -1).slice(0, 8) + "01" : addDays(anchor, -step);
  const next = view === "month" ? addDays(anchor.slice(0, 8) + "28", 7).slice(0, 8) + "01" : addDays(anchor, step);
  const dayList = Array.from({ length: days }, (_, i) => addDays(first, i));
  const today = todayLocal();
  const returnTo = `/admin/calendar?view=${view}&date=${anchor}`;

  const title =
    view === "day"
      ? fmtDateStr(anchor, { weekday: "long", month: "long", year: "numeric" })
      : view === "week"
        ? `Week of ${fmtDateStr(first, { year: "numeric" })}`
        : fmtDateStr(anchor, { weekday: undefined, day: undefined, month: "long", year: "numeric" });

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle={title}
        actions={
          <>
            {(["day", "week", "month"] as const).map((v) => (
              <Link key={v} href={`/admin/calendar?view=${v}&date=${anchor}`} className={`btn-sm ${v === view ? "btn-primary" : "btn-secondary"}`}>
                {v[0].toUpperCase() + v.slice(1)}
              </Link>
            ))}
            <Link className="btn-secondary btn-sm" href={`/admin/calendar?view=${view}&date=${prev}`}>←</Link>
            <Link className="btn-secondary btn-sm" href={`/admin/calendar?view=${view}`}>Today</Link>
            <Link className="btn-secondary btn-sm" href={`/admin/calendar?view=${view}&date=${next}`}>→</Link>
          </>
        }
      />
      <FlashMessage msg={sp.msg} err={sp.err} />

      {view === "day" && <DayView date={anchor} boats={boats} bookings={bookings} blocks={blocks} open={settings.openTime} close={settings.closeTime} />}

      {view === "week" && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] table-fixed border-collapse text-xs">
            <thead>
              <tr>
                <th className="w-32 border-b border-r border-slate-200 p-2 text-left">Boat</th>
                {dayList.map((d) => (
                  <th key={d} className={`border-b border-slate-200 p-2 text-left ${d === today ? "bg-sky-50" : ""}`}>
                    <Link href={`/admin/calendar?view=day&date=${d}`} className="hover:underline">{fmtDateStr(d)}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {boats.map((boat) => (
                <tr key={boat.id}>
                  <td className="border-b border-r border-slate-200 p-2 align-top font-medium">
                    {boat.name}
                    {boat.status === "maintenance" && <div className="text-rose-600">In maintenance</div>}
                  </td>
                  {dayList.map((d) => {
                    const items = bookings.filter((b) => b.boatId === boat.id && localDate(b.startsAt) === d);
                    const blks = blocks.filter((b) => (b.boatId === null || b.boatId === boat.id) && localDate(b.startsAt) <= d && localDate(b.endsAt) >= d);
                    return (
                      <td key={d} className={`h-20 border-b border-slate-100 p-1 align-top ${d === today ? "bg-sky-50/50" : ""}`}>
                        <div className="space-y-1">
                          {blks.map((b) => (
                            <div key={b.id} className="rounded border border-slate-300 bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_4px,#e2e8f0_4px,#e2e8f0_8px)] px-1.5 py-0.5 text-slate-600">
                              ⛔ {b.reason || "Blocked"}
                            </div>
                          ))}
                          {items.map((b) => (
                            <Link key={b.id} href={`/admin/bookings/${b.id}`} className={`block rounded border px-1.5 py-0.5 hover:opacity-80 ${STATUS_COLORS[b.status]}`}>
                              <div className="font-semibold">{fmtTime(b.startsAt)}–{fmtTime(b.endsAt)}</div>
                              <div className="truncate">{b.customer.lastName} · {b.partySize}p</div>
                            </Link>
                          ))}
                          {items.length === 0 && blks.length === 0 && (
                            <Link href={`/admin/bookings/new?boat=${boat.id}&date=${d}`} className="block rounded px-1.5 py-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500">
                              + book
                            </Link>
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

      {view === "month" && (
        <div className="card overflow-x-auto">
          <div className="grid min-w-[700px] grid-cols-7 text-xs">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="border-b border-slate-200 p-2 font-semibold text-slate-500">{d}</div>
            ))}
            {dayList.map((d) => {
              const items = bookings.filter((b) => localDate(b.startsAt) === d);
              const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
              const util = boats.length ? new Set(items.map((i) => i.boatId)).size : 0;
              return (
                <Link
                  key={d}
                  href={`/admin/calendar?view=day&date=${d}`}
                  className={`min-h-24 border-b border-r border-slate-100 p-1.5 hover:bg-slate-50 ${inMonth ? "" : "bg-slate-50/70 text-slate-400"} ${d === today ? "bg-sky-50" : ""}`}
                >
                  <div className="flex justify-between">
                    <span className="font-semibold">{Number(d.slice(8))}</span>
                    {items.length > 0 && <span className="text-slate-500">{util}/{boats.length} boats</span>}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {items.slice(0, 4).map((b) => (
                      <div key={b.id} className={`truncate rounded border px-1 ${STATUS_COLORS[b.status]}`}>
                        {fmtTime(b.startsAt)} {b.boat.name}
                      </div>
                    ))}
                    {items.length > 4 && <div className="text-slate-500">+{items.length - 4} more</div>}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <form action={addBlock} className="card card-pad space-y-3">
          <h2 className="h2">Block off time</h2>
          <p className="muted">Maintenance, weather closure, owner use, private events. Blocked time can&apos;t be booked online.</p>
          <input type="hidden" name="returnTo" value={returnTo} />
          <div>
            <label className="label">Boat</label>
            <select name="boatId" className="input">
              <option value="">Entire fleet (e.g. weather closure)</option>
              {boats.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Start date</label><input name="startDate" type="date" defaultValue={anchor} required className="input" /></div>
            <div><label className="label">Start time</label><input name="startTime" type="time" defaultValue={settings.openTime} className="input" /></div>
            <div><label className="label">End date</label><input name="endDate" type="date" defaultValue={anchor} className="input" /></div>
            <div><label className="label">End time</label><input name="endTime" type="time" defaultValue={settings.closeTime} className="input" /></div>
          </div>
          <div><label className="label">Reason</label><input name="reason" className="input" placeholder="e.g. Engine service" /></div>
          <button className="btn-primary">Add block</button>
        </form>
        <div className="card card-pad">
          <h2 className="h2 mb-3">Blocks in this range</h2>
          {blocks.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {blocks.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-2">
                  <span>
                    <b>{b.boat?.name ?? "Whole fleet"}</b> · {fmtDateStr(localDate(b.startsAt))} {localTime(b.startsAt)} → {fmtDateStr(localDate(b.endsAt))} {localTime(b.endsAt)}
                    {b.reason && <span className="muted"> · {b.reason}</span>}
                  </span>
                  <form action={deleteBlock}>
                    <input type="hidden" name="id" value={b.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <button className="text-xs text-rose-600 hover:underline">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

type B = { id: string; boatId: string; startsAt: Date; endsAt: Date; status: string; partySize: number; customer: { firstName: string; lastName: string } };
type Blk = { id: string; boatId: string | null; startsAt: Date; endsAt: Date; reason: string };

function DayView({ date, boats, bookings, blocks, open, close }: { date: string; boats: { id: string; name: string }[]; bookings: B[]; blocks: Blk[]; open: string; close: string }) {
  const startMin = Math.max(0, minutesFromHHMM(open) - 60);
  const endMin = Math.min(24 * 60, minutesFromHHMM(close) + 60);
  const span = endMin - startMin;
  const dayStart = zonedToUtc(date, "00:00").getTime();
  const pos = (d: Date) => Math.min(100, Math.max(0, (((d.getTime() - dayStart) / 60000 - startMin) / span) * 100));
  const hours: number[] = [];
  for (let m = Math.ceil(startMin / 60) * 60; m < endMin; m += 60) hours.push(m);
  const nowPct = localDate(new Date()) === date ? pos(new Date()) : null;

  return (
    <div className="card overflow-x-auto">
      <div className="min-w-[900px]">
        <div className="flex border-b border-slate-200 text-xs text-slate-500">
          <div className="w-32 shrink-0 p-2 font-semibold">Boat</div>
          <div className="relative h-8 flex-1">
            {hours.map((m) => (
              <div key={m} className="absolute top-2 -translate-x-1/2" style={{ left: `${((m - startMin) / span) * 100}%` }}>
                {((m / 60) % 12 || 12) + (m / 60 >= 12 ? "p" : "a")}
              </div>
            ))}
          </div>
        </div>
        {boats.map((boat) => (
          <div key={boat.id} className="flex border-b border-slate-100">
            <div className="w-32 shrink-0 p-2 text-sm font-medium">{boat.name}</div>
            <div className="relative h-16 flex-1">
              {hours.map((m) => (
                <div key={m} className="absolute inset-y-0 border-l border-slate-100" style={{ left: `${((m - startMin) / span) * 100}%` }} />
              ))}
              {blocks
                .filter((b) => b.boatId === null || b.boatId === boat.id)
                .map((b) => (
                  <div
                    key={b.id}
                    className="absolute inset-y-1 rounded border border-slate-300 bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_4px,#e2e8f0_4px,#e2e8f0_8px)] px-1 text-xs text-slate-600"
                    style={{ left: `${pos(b.startsAt)}%`, width: `${pos(b.endsAt) - pos(b.startsAt)}%` }}
                  >
                    ⛔ {b.reason}
                  </div>
                ))}
              {bookings
                .filter((b) => b.boatId === boat.id)
                .map((b) => (
                  <Link
                    key={b.id}
                    href={`/admin/bookings/${b.id}`}
                    className={`absolute inset-y-1 overflow-hidden rounded border px-1.5 py-1 text-xs hover:opacity-80 ${STATUS_COLORS[b.status]}`}
                    style={{ left: `${pos(b.startsAt)}%`, width: `${pos(b.endsAt) - pos(b.startsAt)}%` }}
                  >
                    <div className="truncate font-semibold">{b.customer.firstName} {b.customer.lastName}</div>
                    <div className="truncate">{fmtTime(b.startsAt)}–{fmtTime(b.endsAt)} · {b.partySize}p</div>
                  </Link>
                ))}
              {nowPct !== null && <div className="absolute inset-y-0 w-0.5 bg-rose-500" style={{ left: `${nowPct}%` }} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

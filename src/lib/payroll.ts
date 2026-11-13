import "server-only";
import { prisma } from "./db";
import { estimatedGrossCents, mondayOf, periodBounds, UNASSIGNED, weeklyOvertime } from "./crewMath";
import { zonedToUtc } from "./time";
import { tipsForPeriod } from "./tips";

/** Hours & tips per person for a pay period (inclusive local dates). Used by /admin/payroll and the CSV export. */
export async function payrollReport(from: string, to: string) {
  const { start, end } = periodBounds(from, to);
  // Start at the Monday of the first week so overtime counts the whole week
  const otStart = zonedToUtc(mondayOf(from), "00:00");
  const [users, entries, tips] = await Promise.all([
    prisma.adminUser.findMany({ orderBy: { name: "asc" } }),
    prisma.timeEntry.findMany({ where: { clockIn: { gte: otStart, lt: end } }, orderBy: { clockIn: "asc" } }),
    tipsForPeriod(start, end),
  ]);

  const rows = users
    .map((u) => {
      const mine = entries.filter((e) => e.userId === u.id);
      const { regularMinutes, overtimeMinutes } = weeklyOvertime(mine, start, end);
      const t = tips.byPerson.find((p) => p.userId === u.id);
      const openEntries = mine.filter((e) => !e.clockOut && e.clockIn >= start).length;
      return {
        user: u,
        regularMinutes,
        overtimeMinutes,
        cardTipsCents: t?.cardCents ?? 0,
        cashTipsCents: t?.cashCents ?? 0,
        openEntries,
        grossCents: estimatedGrossCents(regularMinutes, overtimeMinutes, u.hourlyRateCents),
      };
    })
    .filter((r) => r.user.active || r.regularMinutes + r.overtimeMinutes > 0 || r.cardTipsCents + r.cashTipsCents > 0 || r.openEntries > 0);

  const unassigned = tips.byPerson.find((p) => p.userId === UNASSIGNED) ?? null;
  const unassignedBookings = [
    ...new Set(tips.tips.filter((t) => !tips.crew.some((c) => c.bookingId === t.bookingId)).map((t) => t.bookingId)),
  ];
  return { start, end, rows, unassigned, unassignedBookings };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Gusto "Run payroll → Upload CSV" format. Column names follow Gusto's payroll CSV template
 * (last_name, first_name, gusto_employee_id, regular_hours, overtime_hours, paycheck_tips,
 * cash_tips …). Card tips are paid out on the paycheck; cash tips were already received and
 * are only reported for taxes.
 */
export function payrollCsv(rows: Awaited<ReturnType<typeof payrollReport>>["rows"]) {
  const header = [
    "last_name",
    "first_name",
    "title",
    "gusto_employee_id",
    "regular_hours",
    "overtime_hours",
    "double_overtime_hours",
    "paycheck_tips",
    "cash_tips",
    "personal_note",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    if (r.regularMinutes + r.overtimeMinutes + r.cardTipsCents + r.cashTipsCents === 0) continue;
    const parts = r.user.name.trim().split(/\s+/);
    const first = parts[0] ?? "";
    const last = parts.length > 1 ? parts.slice(1).join(" ") : "";
    lines.push(
      [
        last,
        first,
        "",
        r.user.gustoEmployeeId ?? "",
        (r.regularMinutes / 60).toFixed(2),
        (r.overtimeMinutes / 60).toFixed(2),
        "0.00",
        (r.cardTipsCents / 100).toFixed(2),
        (r.cashTipsCents / 100).toFixed(2),
        "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

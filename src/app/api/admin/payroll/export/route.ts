import { requirePermission } from "@/lib/auth";
import { isValidDateStr } from "@/lib/time";
import { payrollCsv, payrollReport } from "@/lib/payroll";

/** CSV for Gusto: GET /api/admin/payroll/export?from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(req: Request) {
  await requirePermission("payroll");
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!isValidDateStr(from) || !isValidDateStr(to) || from > to) {
    return new Response("Pick a valid pay period.", { status: 400 });
  }
  const { rows } = await payrollReport(from, to);
  return new Response(payrollCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gusto-hours-tips-${from}-to-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

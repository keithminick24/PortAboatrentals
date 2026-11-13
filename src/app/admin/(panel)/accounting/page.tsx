import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { COST_CATEGORIES, COST_LABELS } from "@/lib/constants";
import { fmtMoney } from "@/lib/money";
import { fmtDate, fmtDateTime, todayLocal, zonedToUtc } from "@/lib/time";
import { addMonths } from "@/lib/profit";
import { SAMPLE_EXPENSE_CSV } from "@/lib/expenseCsv";
import { isXeroConfigured, xeroRedirectUri, xeroScopes } from "@/lib/xero";
import { Empty, Notice, PageHeader, Pill } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import {
  addExpense,
  deleteExpense,
  importExpensesCsv,
  saveMappings,
  xeroDisconnect,
  xeroFullResync,
  xeroRefreshAccounts,
  xeroSyncNow,
} from "./actions";

type SP = { msg?: string; err?: string; month?: string; category?: string; boat?: string };

const SOURCE_LABELS: Record<string, string> = { xero: "Xero", manual: "Typed in", csv: "CSV" };

export default async function AccountingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const s = await getSession();
  if (!can(s?.role, "accounting")) return <Notice tone="warn">Only Admin and Accounting logins can see expenses.</Notice>;

  const thisMonth = todayLocal().slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : sp.month === "all" ? "all" : thisMonth;
  const category = sp.category && COST_LABELS[sp.category] ? sp.category : "";
  const boatFilter = sp.boat ?? "";

  const where: Record<string, unknown> = {};
  if (month !== "all") where.date = { gte: zonedToUtc(`${month}-01`, "00:00"), lt: zonedToUtc(`${addMonths(month, 1)}-01`, "00:00") };
  if (category) where.category = category;
  if (boatFilter === "fleet") where.boatId = null;
  else if (boatFilter) where.boatId = boatFilter;

  const [conn, boats, mappings, expenses] = await Promise.all([
    prisma.xeroConnection.findUnique({ where: { id: 1 } }),
    prisma.boat.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, status: true } }),
    prisma.expenseMapping.findMany({ orderBy: { xeroAccountCode: "asc" } }),
    prisma.expense.findMany({ where, orderBy: { date: "desc" }, take: 500, include: { boat: { select: { name: true } } } }),
  ]);
  const configured = isXeroConfigured();
  const redirectUri = await xeroRedirectUri();
  const total = expenses.reduce((sum, e) => sum + e.amountCents, 0);
  const byCat = new Map<string, number>();
  for (const e of expenses) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amountCents);
  const cogsKeys = new Set<string>(COST_CATEGORIES.filter((c) => c.cogs).map((c) => c.key));
  const cogsTotal = expenses.filter((e) => cogsKeys.has(e.category)).reduce((sum, e) => sum + e.amountCents, 0);
  const months = Array.from({ length: 14 }, (_, i) => addMonths(thisMonth, -i));
  const keep = new URLSearchParams({ ...(sp.month ? { month: sp.month } : {}), ...(category ? { category } : {}), ...(boatFilter ? { boat: boatFilter } : {}) }).toString();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses & Xero"
        subtitle="Xero stays your books. We pull your expenses from it so Profit & breakeven uses real costs."
        actions={
          <>
            <Link href="/admin/profit" className="btn-secondary">Profit & breakeven</Link>
            <Link href="/admin/profit/assumptions" className="btn-secondary">Cost assumptions</Link>
          </>
        }
      />
      <FlashMessage msg={sp.msg} err={sp.err} />

      {/* ------------------------------------------------ Xero connection */}
      <div className="card card-pad space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="h2 flex-1">Xero</h2>
          {conn ? <Pill tone="green">Connected{conn.tenantName ? ` to ${conn.tenantName}` : ""}</Pill> : <Pill tone="slate">Not connected</Pill>}
        </div>
        {!configured ? (
          <div className="space-y-2 text-sm">
            <Notice tone="info">Xero isn&apos;t set up yet. Until it is, you can still type in expenses or import a CSV below.</Notice>
            <ol className="list-decimal space-y-1 pl-5 text-slate-700">
              <li>Sign in at <b>developer.xero.com</b> → My Apps → <b>New app</b>. Pick <b>Web app</b>.</li>
              <li>For the redirect URI, paste: <code className="rounded bg-slate-100 px-1">{redirectUri}</code></li>
              <li>Copy the <b>Client ID</b> and generate a <b>Client secret</b>.</li>
              <li>Have your developer add them to the app settings as <code>XERO_CLIENT_ID</code> and <code>XERO_CLIENT_SECRET</code>, then come back and click <b>Connect to Xero</b>.</li>
            </ol>
            <p className="muted text-xs">We only ask to <b>read</b>: {xeroScopes()}. Nothing is ever written to Xero.</p>
          </div>
        ) : !conn ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <a href="/api/xero/connect" className="btn-primary">Connect to Xero</a>
            <span className="muted">You&apos;ll sign in to Xero and pick your organisation. Read-only access.</span>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="text-slate-700">
              Last sync: <b>{conn.lastSyncAt ? fmtDateTime(conn.lastSyncAt) : "never"}</b>
              {conn.lastSyncNote && <span className="muted"> · {conn.lastSyncNote}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <form action={xeroSyncNow}><button className="btn-primary btn-sm">Sync now</button></form>
              <form action={xeroRefreshAccounts}><button className="btn-secondary btn-sm">Refresh account list</button></form>
              <form action={xeroFullResync}><button className="btn-secondary btn-sm" title="Pulls the last 13 months again">Re-sync last 13 months</button></form>
              <form action={xeroDisconnect}><button className="btn-danger btn-sm">Disconnect</button></form>
            </div>
            <p className="muted text-xs">
              Sync pulls Spend Money transactions and bills (approved or paid), one expense per line. If a line is tagged with a Xero tracking option named exactly like a boat, it&apos;s charged to that boat.
            </p>
          </div>
        )}
      </div>

      {/* ------------------------------------------------ Account mapping */}
      <div className="card card-pad space-y-3">
        <div>
          <h2 className="h2">Match Xero accounts to cost types</h2>
          <p className="muted">
            Tell us what each Xero expense account is. Cost types marked <b>(trip cost)</b> count against gross profit. Pick a boat if every expense on that account is for one boat. Tick <b>Ignore</b> for accounts that aren&apos;t business costs (e.g. owner draws).
          </p>
        </div>
        {mappings.length === 0 ? (
          <Empty>{conn ? "No accounts yet. Click “Refresh account list”." : "Your Xero expense accounts will show up here once you connect."}</Empty>
        ) : (
          <form action={saveMappings} className="space-y-3">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr><th>Xero account</th><th>Cost type</th><th>Boat</th><th>Ignore</th></tr>
                </thead>
                <tbody>
                  {mappings.map((m) => (
                    <tr key={m.id} className={m.ignore ? "opacity-60" : ""}>
                      <td>
                        <input type="hidden" name="mappingId" value={m.id} />
                        <span className="font-mono text-xs text-slate-500">{m.xeroAccountCode}</span> {m.xeroAccountName || <span className="muted">(name unknown)</span>}
                      </td>
                      <td>
                        <select name={`category_${m.id}`} defaultValue={m.category} className="input">
                          {COST_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}{c.cogs ? " (trip cost)" : ""}</option>)}
                        </select>
                      </td>
                      <td>
                        <select name={`boat_${m.id}`} defaultValue={m.boatId ?? ""} className="input">
                          <option value="">Whole fleet / not one boat</option>
                          {boats.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                      </td>
                      <td><input type="checkbox" name={`ignore_${m.id}`} defaultChecked={m.ignore} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn-primary btn-sm">Save mappings</button>
            <p className="muted text-xs">Saving updates expenses already pulled in. If you un-ignore an account, click “Re-sync last 13 months” to bring its expenses back.</p>
          </form>
        )}
      </div>

      {/* ------------------------------------------------ Expenses */}
      <div className="card card-pad space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="h2">Expenses</h2>
          <form className="flex flex-wrap gap-2">
            <select name="month" defaultValue={month} className="input w-auto">
              <option value="all">All months</option>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <select name="category" defaultValue={category} className="input w-auto">
              <option value="">All cost types</option>
              {COST_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <select name="boat" defaultValue={boatFilter} className="input w-auto">
              <option value="">All boats</option>
              <option value="fleet">Whole fleet only</option>
              {boats.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button className="btn-secondary">Show</button>
          </form>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <div>Total: <b>{fmtMoney(total)}</b></div>
          <div>Trip costs (COGS): <b>{fmtMoney(cogsTotal)}</b></div>
          <div>Overhead: <b>{fmtMoney(total - cogsTotal)}</b></div>
        </div>
        {byCat.size > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <span key={k} className="badge border-slate-200 bg-slate-50 text-slate-700">{COST_LABELS[k] ?? k}: {fmtMoney(v)}</span>
            ))}
          </div>
        )}
        {expenses.length === 0 ? (
          <Empty>No expenses for this filter.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Cost type</th><th>Boat</th><th>Vendor</th><th>Description</th><th className="text-right">Amount</th><th>From</th><th></th></tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{fmtDate(e.date)}</td>
                    <td>{COST_LABELS[e.category] ?? e.category}</td>
                    <td>{e.boat?.name ?? <span className="muted">Fleet</span>}</td>
                    <td>{e.vendor}</td>
                    <td className="max-w-xs truncate" title={e.description}>{e.description}</td>
                    <td className="text-right tabular-nums">{fmtMoney(e.amountCents)}</td>
                    <td><Pill tone={e.source === "xero" ? "blue" : "slate"}>{SOURCE_LABELS[e.source] ?? e.source}</Pill></td>
                    <td>
                      {e.source !== "xero" && (
                        <form action={deleteExpense}>
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="keep" value={keep} />
                          <button className="text-xs text-rose-700 hover:underline">Delete</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {expenses.length === 500 && <p className="muted mt-2 text-xs">Showing the latest 500. Narrow the filter to see more.</p>}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ------------------------------------------------ Manual add */}
        <form action={addExpense} className="card card-pad space-y-3">
          <h2 className="h2">Add an expense</h2>
          <p className="muted">For anything not in Xero, like a cash fuel fill-up.</p>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Date</label><input type="date" name="date" className="input" defaultValue={todayLocal()} required /></div>
            <div><label className="label">Amount</label><input name="amount" className="input" placeholder="e.g. 125.50" required /></div>
            <div>
              <label className="label">Cost type</label>
              <select name="category" className="input" defaultValue="fuel">
                {COST_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Boat</label>
              <select name="boatId" className="input">
                <option value="">Whole fleet</option>
                {boats.filter((b) => b.status !== "retired").map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div><label className="label">Vendor</label><input name="vendor" className="input" placeholder="e.g. Marina fuel dock" /></div>
            <div><label className="label">Description</label><input name="description" className="input" placeholder="optional" /></div>
          </div>
          <button className="btn-primary btn-sm">Add expense</button>
        </form>

        {/* ------------------------------------------------ CSV import */}
        <form action={importExpensesCsv} className="card card-pad space-y-3">
          <h2 className="h2">Import a CSV</h2>
          <p className="muted">
            Columns: date, amount, category, boat, vendor, description (any order; headers like &ldquo;payee&rdquo; or &ldquo;memo&rdquo; work too). Dates like 2026-06-03 or 6/3/2026. Leave boat blank for the whole fleet.
          </p>
          <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{SAMPLE_EXPENSE_CSV}</pre>
          <input type="file" name="file" accept=".csv,text/csv,text/plain" className="block text-sm" />
          <textarea name="csv" rows={4} className="input font-mono text-xs" placeholder="…or paste rows here" />
          <button className="btn-primary btn-sm">Import</button>
        </form>
      </div>
    </div>
  );
}

function monthLabel(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, mo - 1, 1)));
}

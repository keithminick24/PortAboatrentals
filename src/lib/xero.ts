import "server-only";
/**
 * Xero connection (read-only). Xero stays the books; we pull categorized
 * expenses from it so profitability uses real costs.
 *
 * OAuth 2.0 authorization-code flow (developer.xero.com, identity.xero.com/.well-known/openid-configuration):
 *   authorize   https://login.xero.com/identity/connect/authorize
 *   token       https://identity.xero.com/connect/token   (Basic auth client_id:client_secret)
 *   revoke      https://identity.xero.com/connect/revocation
 *   tenants     https://api.xero.com/connections
 *   API         https://api.xero.com/api.xro/2.0/...      (header xero-tenant-id)
 * Access tokens last 30 minutes; refresh tokens rotate on each refresh (60 days unused).
 *
 * Scopes: Xero is retiring the broad `accounting.transactions` scope in favour of
 * granular ones (apps created on/after 2 March 2026 only get granular scopes).
 * We only read, so we ask for:
 *   offline_access                      refresh token
 *   accounting.banktransactions.read    Spend Money (bank transactions)
 *   accounting.invoices.read            bills (ACCPAY invoices)
 *   accounting.settings.read            chart of accounts
 * Override with XERO_SCOPES if Xero changes these again.
 *
 * Test mode: without XERO_CLIENT_ID / XERO_CLIENT_SECRET nothing is called.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";
import { appUrl } from "./mail";
import { guessCategory } from "./expenseCsv";
import { addDays, todayLocal, zonedToUtc } from "./time";

export const XERO_AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
export const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
export const XERO_REVOKE_URL = "https://identity.xero.com/connect/revocation";
export const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
export const XERO_API = "https://api.xero.com/api.xro/2.0";
export const XERO_DEFAULT_SCOPES = "offline_access accounting.banktransactions.read accounting.invoices.read accounting.settings.read";
export const XERO_STATE_COOKIE = "pabr_xero_state";

/** Account types in the chart of accounts that hold costs. */
const EXPENSE_ACCOUNT_TYPES = new Set(["EXPENSE", "DIRECTCOSTS", "OVERHEADS", "DEPRECIATN"]);

export function isXeroConfigured(): boolean {
  return !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET);
}

export function xeroScopes(): string {
  return (process.env.XERO_SCOPES || XERO_DEFAULT_SCOPES).trim();
}

export async function xeroRedirectUri() {
  return appUrl("/api/xero/callback");
}

// ---------------------------------------------------------------- token encryption (AES-256-GCM)

function key(): Buffer {
  return createHash("sha256")
    .update(process.env.SESSION_SECRET || "dev-only-insecure-session-secret")
    .digest();
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

export function decryptToken(blob: string): string {
  const [v, iv, tag, data] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unreadable Xero token. Please reconnect Xero.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

// ---------------------------------------------------------------- OAuth

export function newOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

export async function buildAuthorizeUrl(state: string): Promise<string> {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: process.env.XERO_CLIENT_ID ?? "",
    redirect_uri: await xeroRedirectUri(),
    scope: xeroScopes(),
    state,
  });
  return `${XERO_AUTHORIZE_URL}?${q}`;
}

type TokenSet = { access_token: string; refresh_token: string; expires_in: number };

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const basic = Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`Xero sign-in failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as TokenSet;
}

/** Finish the OAuth flow: swap the code for tokens, pick the organisation, save it. */
export async function completeXeroConnect(code: string) {
  if (!isXeroConfigured()) throw new Error("Xero isn't set up yet (XERO_CLIENT_ID / XERO_CLIENT_SECRET).");
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: await xeroRedirectUri() });
  const res = await fetch(XERO_CONNECTIONS_URL, { headers: { Authorization: `Bearer ${t.access_token}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Couldn't read your Xero organisations (${res.status}).`);
  const tenants = (await res.json()) as { tenantId: string; tenantName?: string; tenantType?: string }[];
  const org = tenants.find((x) => x.tenantType === "ORGANISATION") ?? tenants[0];
  if (!org) throw new Error("No Xero organisation was shared. Try again and pick your organisation.");
  const data = {
    tenantId: org.tenantId,
    tenantName: org.tenantName ?? "",
    accessToken: encryptToken(t.access_token),
    refreshToken: encryptToken(t.refresh_token),
    expiresAt: new Date(Date.now() + (t.expires_in ?? 1800) * 1000),
  };
  await prisma.xeroConnection.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  return org.tenantName ?? "";
}

/** A valid access token, refreshing it first if it's about to expire. */
async function accessToken() {
  const conn = await prisma.xeroConnection.findUnique({ where: { id: 1 } });
  if (!conn) throw new Error("Xero isn't connected.");
  if (conn.expiresAt.getTime() - Date.now() > 60_000) return { token: decryptToken(conn.accessToken), tenantId: conn.tenantId };
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decryptToken(conn.refreshToken) });
  await prisma.xeroConnection.update({
    where: { id: 1 },
    data: {
      accessToken: encryptToken(t.access_token),
      refreshToken: encryptToken(t.refresh_token),
      expiresAt: new Date(Date.now() + (t.expires_in ?? 1800) * 1000),
    },
  });
  return { token: t.access_token, tenantId: conn.tenantId };
}

async function xeroGet<T>(path: string, params: Record<string, string> = {}, modifiedSince?: Date | null): Promise<T> {
  const { token, tenantId } = await accessToken();
  const q = new URLSearchParams(params);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "xero-tenant-id": tenantId, Accept: "application/json" };
  if (modifiedSince) headers["If-Modified-Since"] = modifiedSince.toISOString().slice(0, 19);
  const res = await fetch(`${XERO_API}${path}${q.size ? `?${q}` : ""}`, { headers });
  if (res.status === 304) return {} as T;
  if (res.status === 429) throw new Error("Xero says we're asking too fast. Wait a minute and try again.");
  if (!res.ok) throw new Error(`Xero ${path} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** Disconnect: revoke the refresh token (removes our access in Xero) and forget the tokens. */
export async function disconnectXero() {
  const conn = await prisma.xeroConnection.findUnique({ where: { id: 1 } });
  if (!conn) return;
  if (isXeroConfigured()) {
    try {
      const basic = Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString("base64");
      await fetch(XERO_REVOKE_URL, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: decryptToken(conn.refreshToken) }),
      });
    } catch (e) {
      console.warn("[xero] revoke failed (continuing):", e);
    }
  }
  await prisma.xeroConnection.delete({ where: { id: 1 } });
}

// ---------------------------------------------------------------- data shapes (subset of Xero's)

type XeroTracking = { Name?: string; Option?: string };
type XeroLine = { LineItemID?: string; Description?: string; AccountCode?: string; LineAmount?: number; TaxAmount?: number; Tracking?: XeroTracking[] };
type XeroContact = { Name?: string };
type XeroBankTx = { BankTransactionID: string; Type: string; Status: string; Date?: string; DateString?: string; Reference?: string; LineAmountTypes?: string; Contact?: XeroContact; LineItems?: XeroLine[] };
type XeroInvoice = { InvoiceID: string; Type: string; Status: string; Date?: string; DateString?: string; Reference?: string; InvoiceNumber?: string; LineAmountTypes?: string; Contact?: XeroContact; LineItems?: XeroLine[] };
type XeroAccount = { Code?: string; Name?: string; Type?: string; Status?: string };

/** Xero JSON dates come as "/Date(1718064000000+0000)/" with a DateString "2026-06-11T00:00:00". */
export function xeroDate(x: { Date?: string; DateString?: string }): string | null {
  if (x.DateString && /^\d{4}-\d{2}-\d{2}/.test(x.DateString)) return x.DateString.slice(0, 10);
  const m = x.Date?.match(/\/Date\((-?\d+)/);
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
  if (x.Date && /^\d{4}-\d{2}-\d{2}/.test(x.Date)) return x.Date.slice(0, 10);
  return null;
}

/** Line amount without tax. */
export function xeroLineNet(line: XeroLine, lineAmountTypes?: string): number {
  const amt = line.LineAmount ?? 0;
  return lineAmountTypes === "Inclusive" ? amt - (line.TaxAmount ?? 0) : amt;
}

// ---------------------------------------------------------------- sync

/** Fill ExpenseMapping with the expense-type accounts from Xero's chart of accounts. Never overwrites a mapping. */
export async function syncXeroAccounts(): Promise<{ added: number; total: number }> {
  if (!isXeroConfigured()) return { added: 0, total: 0 };
  const data = await xeroGet<{ Accounts?: XeroAccount[] }>("/Accounts");
  const accounts = (data.Accounts ?? []).filter((a) => a.Code && a.Type && EXPENSE_ACCOUNT_TYPES.has(a.Type) && a.Status !== "DELETED");
  let added = 0;
  for (const a of accounts) {
    const existing = await prisma.expenseMapping.findUnique({ where: { xeroAccountCode: a.Code! } });
    if (existing) {
      if (existing.xeroAccountName !== (a.Name ?? "")) await prisma.expenseMapping.update({ where: { id: existing.id }, data: { xeroAccountName: a.Name ?? "" } });
      continue;
    }
    await prisma.expenseMapping.create({ data: { xeroAccountCode: a.Code!, xeroAccountName: a.Name ?? "", category: a.Type === "DEPRECIATN" ? "depreciation" : guessCategory(a.Name ?? "") } });
    added++;
  }
  return { added, total: accounts.length };
}

type SyncContext = {
  mappings: Map<string, { category: string; boatId: string | null; ignore: boolean }>;
  boatsByName: Map<string, string>;
  created: number;
  updated: number;
  removed: number;
  skipped: number;
};

async function mappingFor(ctx: SyncContext, code: string | undefined) {
  if (!code) return { category: "other", boatId: null, ignore: false };
  let m = ctx.mappings.get(code);
  if (!m) {
    // An account we haven't seen: add it so the owner can map it.
    const row = await prisma.expenseMapping.upsert({
      where: { xeroAccountCode: code },
      update: {},
      create: { xeroAccountCode: code, xeroAccountName: "", category: "other" },
    });
    m = { category: row.category, boatId: row.boatId, ignore: row.ignore };
    ctx.mappings.set(code, m);
  }
  return m;
}

async function saveDoc(
  ctx: SyncContext,
  type: "banktx" | "bill",
  id: string,
  doc: { Status: string; Date?: string; DateString?: string; Reference?: string; LineAmountTypes?: string; Contact?: XeroContact; LineItems?: XeroLine[] },
  live: boolean,
) {
  const prefix = `${type}:${id}:`;
  if (!live) {
    const r = await prisma.expense.deleteMany({ where: { externalId: { startsWith: prefix } } });
    ctx.removed += r.count;
    return;
  }
  const date = xeroDate(doc);
  if (!date) return;
  const when = zonedToUtc(date, "12:00");
  const keep: string[] = [];
  for (const [i, line] of (doc.LineItems ?? []).entries()) {
    const externalId = `${prefix}${line.LineItemID ?? i}`;
    const m = await mappingFor(ctx, line.AccountCode);
    if (m.ignore) {
      ctx.skipped++;
      continue;
    }
    const amountCents = Math.round(xeroLineNet(line, doc.LineAmountTypes) * 100);
    if (!amountCents) continue;
    const trackedBoat = (line.Tracking ?? []).map((t) => ctx.boatsByName.get((t.Option ?? "").trim().toLowerCase())).find(Boolean);
    const data = {
      date: when,
      amountCents,
      category: m.category,
      boatId: trackedBoat ?? m.boatId,
      vendor: doc.Contact?.Name ?? "",
      description: line.Description || doc.Reference || "",
      source: "xero",
      xeroAccountCode: line.AccountCode ?? null,
    };
    keep.push(externalId);
    const exists = await prisma.expense.findUnique({ where: { externalId }, select: { id: true } });
    if (exists) {
      await prisma.expense.update({ where: { externalId }, data });
      ctx.updated++;
    } else {
      await prisma.expense.create({ data: { ...data, externalId, createdBy: "Xero sync" } });
      ctx.created++;
    }
  }
  // Lines removed from the document in Xero (or now ignored)
  const r = await prisma.expense.deleteMany({ where: { externalId: { startsWith: prefix, notIn: keep } } });
  ctx.removed += r.count;
}

async function* pages<T>(path: string, listKey: string, params: Record<string, string>, since: Date | null): AsyncGenerator<T[]> {
  for (let page = 1; page <= 200; page++) {
    const data = await xeroGet<Record<string, T[]>>(path, { ...params, page: String(page) }, since);
    const items = data[listKey] ?? [];
    if (items.length) yield items;
    if (items.length < 100) return;
  }
}

/**
 * Pull Spend Money bank transactions and bills (ACCPAY, authorised or paid)
 * changed since the last sync (or the last 13 months the first time). One
 * Expense per line item, externalId = `${type}:${id}:${lineItemId}`. Voided
 * or deleted documents remove their expenses.
 */
export async function syncXeroExpenses(): Promise<string> {
  if (!isXeroConfigured()) return "Xero isn't set up yet, so nothing was synced.";
  const conn = await prisma.xeroConnection.findUnique({ where: { id: 1 } });
  if (!conn) return "Xero isn't connected.";
  const startedAt = new Date();
  try {
    await syncXeroAccounts();
    const [mappings, boats] = await Promise.all([prisma.expenseMapping.findMany(), prisma.boat.findMany({ select: { id: true, name: true } })]);
    const ctx: SyncContext = {
      mappings: new Map(mappings.map((m) => [m.xeroAccountCode, { category: m.category, boatId: m.boatId, ignore: m.ignore }])),
      boatsByName: new Map(boats.map((b) => [b.name.trim().toLowerCase(), b.id])),
      created: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
    };
    const since = conn.lastSyncAt;
    const firstDay = addDays(todayLocal(), -396); // ~13 months
    const [y, m, d] = firstDay.split("-").map(Number);
    const dateFilter = since ? "" : ` AND Date >= DateTime(${y}, ${m}, ${d})`;

    for await (const txs of pages<XeroBankTx>("/BankTransactions", "BankTransactions", { where: `Type=="SPEND"${dateFilter}` }, since)) {
      for (const t of txs) if (t.Type === "SPEND") await saveDoc(ctx, "banktx", t.BankTransactionID, t, t.Status === "AUTHORISED");
    }
    for await (const invs of pages<XeroInvoice>(
      "/Invoices",
      "Invoices",
      { where: `Type=="ACCPAY"${dateFilter}`, Statuses: since ? "AUTHORISED,PAID,VOIDED,DELETED" : "AUTHORISED,PAID" },
      since,
    )) {
      for (const inv of invs)
        if (inv.Type === "ACCPAY") await saveDoc(ctx, "bill", inv.InvoiceID, { ...inv, Reference: inv.Reference || inv.InvoiceNumber }, inv.Status === "AUTHORISED" || inv.Status === "PAID");
    }
    const note = `Synced: ${ctx.created} new, ${ctx.updated} updated, ${ctx.removed} removed${ctx.skipped ? `, ${ctx.skipped} lines on ignored accounts` : ""}.`;
    await prisma.xeroConnection.update({ where: { id: 1 }, data: { lastSyncAt: startedAt, lastSyncNote: note } });
    return note;
  } catch (e) {
    const note = `Sync failed: ${e instanceof Error ? e.message : String(e)}`;
    await prisma.xeroConnection.update({ where: { id: 1 }, data: { lastSyncNote: note } }).catch(() => {});
    throw new Error(note);
  }
}

/** Re-apply a mapping to Xero expenses already pulled in (after the owner changes it). */
export async function reapplyMapping(code: string) {
  const m = await prisma.expenseMapping.findUnique({ where: { xeroAccountCode: code } });
  if (!m) return;
  if (m.ignore) {
    await prisma.expense.deleteMany({ where: { source: "xero", xeroAccountCode: code } });
    return;
  }
  await prisma.expense.updateMany({ where: { source: "xero", xeroAccountCode: code }, data: { category: m.category } });
  if (m.boatId) await prisma.expense.updateMany({ where: { source: "xero", xeroAccountCode: code }, data: { boatId: m.boatId } });
}

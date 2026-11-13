/**
 * Tolerant CSV parsing for expense imports.
 * Columns (any order, header names are flexible): date, amount, category, boat, vendor, description.
 */
import { COST_CATEGORIES } from "./constants";

export const SAMPLE_EXPENSE_CSV = `date,amount,category,boat,vendor,description
2026-06-03,412.50,Fuel,Island Time,Marina Fuel Dock,Fuel fill-up
06/05/2026,"$1,250.00",insurance,,BoatUS,June fleet insurance
2026-06-12,89.99,Cleaning & supplies,Sea Breeze,H-E-B,Towels and cleaner`;

/** Split CSV text into rows of cells. Handles quotes, escaped quotes, commas/semicolons/tabs, CRLF. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ""));
}

const ALIASES: Record<string, string[]> = {
  date: ["date", "day", "transaction date", "txn date", "posted", "posted date"],
  amount: ["amount", "total", "cost", "debit", "spent", "price", "value"],
  category: ["category", "type", "account", "expense type"],
  boat: ["boat", "vessel", "boat name"],
  vendor: ["vendor", "payee", "supplier", "merchant", "paid to", "store"],
  description: ["description", "memo", "notes", "note", "details", "item"],
};

function headerIndex(header: string[]): Record<string, number> | null {
  const norm = header.map((h) => h.toLowerCase().replace(/[^a-z ]/g, "").trim());
  const idx: Record<string, number> = {};
  for (const [key, names] of Object.entries(ALIASES)) {
    const i = norm.findIndex((h) => names.includes(h));
    if (i >= 0) idx[key] = i;
  }
  return idx.date != null && idx.amount != null ? idx : null;
}

/** "2026-06-03", "6/3/2026", "6/3/26", "06-03-2026", "Jun 3, 2026" → "YYYY-MM-DD" or null. */
export function parseLooseDate(s: string): string | null {
  const t = s.trim();
  const pad = (n: number) => String(n).padStart(2, "0");
  const valid = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
  };
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return valid(y, +m[1], +m[2]); // US month/day
  }
  const parsed = Date.parse(t);
  if (!Number.isNaN(parsed) && /[a-z]/i.test(t)) {
    const d = new Date(parsed);
    return valid(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}

/** "$1,250.00", "(45.10)", "-45.1", "45" → cents (always positive: an expense). */
export function parseLooseAmount(s: string): number | null {
  const t = s.replace(/[$,\s]|USD/gi, "");
  // Sign and (parentheses) are ignored on purpose: every row is money spent.
  const core = t.replace(/[()]/g, "").replace(/^-/, "");
  if (!/^\d+(\.\d+)?$/.test(core)) return null;
  return Math.round(parseFloat(core) * 100);
}

/** Match a category by key, label, or a word in the label (e.g. "gas" → fuel). */
export function matchCategory(s: string): string {
  const t = s.trim().toLowerCase();
  if (!t) return "other";
  for (const c of COST_CATEGORIES) if (c.key === t || c.label.toLowerCase() === t) return c.key;
  for (const c of COST_CATEGORIES) if (c.label.toLowerCase().startsWith(t)) return c.key;
  return guessCategory(t);
}

/** Keyword guess from an account name or free text. */
export function guessCategory(text: string): string {
  const t = text.toLowerCase();
  const rules: [RegExp, string][] = [
    [/fuel|gas(oline)?\b|diesel/, "fuel"],
    [/repair|maint|service|parts|mechanic/, "maintenance"],
    [/slip|lift|dock|marina|moorage|storage/, "boat_lift"],
    [/insur/, "insurance"],
    [/loan|lease|boat payment|interest/, "boat_payment"],
    [/clean|janitor|supplies|laundry/, "cleaning"],
    [/wage|payroll|labor|labour|salar|crew|contractor/, "crew_labor"],
    [/merchant|stripe|card fee|processing|bank fee|square/, "card_fees"],
    [/equipment|paddle|cooler|tube|add-on/, "equipment"],
    [/depreciat/, "depreciation"],
    [/advertis|marketing|promo|google ads|facebook/, "marketing"],
    [/software|subscription|saas|app\b/, "software"],
    [/office|admin|postage|printing|accounting|legal|professional/, "office"],
    [/rent|utilit|electric|water|internet|phone/, "rent"],
  ];
  for (const [re, key] of rules) if (re.test(t)) return key;
  return "other";
}

export type CsvExpense = { date: string; amountCents: number; category: string; boatName: string; vendor: string; description: string };
export type CsvResult = { rows: CsvExpense[]; errors: string[] };

export function parseExpenseCsv(text: string): CsvResult {
  const all = parseCsv(text);
  const errors: string[] = [];
  if (!all.length) return { rows: [], errors: ["The file is empty."] };
  let idx = headerIndex(all[0]);
  let body = all.slice(1);
  if (!idx) {
    // No header: assume the sample's column order.
    idx = { date: 0, amount: 1, category: 2, boat: 3, vendor: 4, description: 5 };
    body = all;
  }
  const get = (r: string[], k: string) => (idx![k] != null ? r[idx![k]] ?? "" : "");
  const rows: CsvExpense[] = [];
  body.forEach((r, i) => {
    const line = i + (body === all ? 1 : 2);
    const date = parseLooseDate(get(r, "date"));
    const amountCents = parseLooseAmount(get(r, "amount"));
    if (!date) return void errors.push(`Line ${line}: couldn't read the date "${get(r, "date")}".`);
    if (amountCents == null) return void errors.push(`Line ${line}: couldn't read the amount "${get(r, "amount")}".`);
    rows.push({
      date,
      amountCents,
      category: matchCategory(get(r, "category")),
      boatName: get(r, "boat"),
      vendor: get(r, "vendor"),
      description: get(r, "description"),
    });
  });
  return { rows, errors };
}

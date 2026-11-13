"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission, requireStaff } from "@/lib/auth";
import { importTelemetryCsv } from "@/lib/telemetry";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, msg?: string, err?: string): never => {
  const q = new URLSearchParams();
  if (msg) q.set("msg", msg);
  if (err) q.set("err", err);
  redirect(`${path}${q.size ? `?${q}` : ""}#boatfix`);
};

export async function saveBoatfix(f: FormData) {
  await requirePermission("pricing");
  const boatId = str(f, "boatId");
  const url = str(f, "boatfixUrl");
  if (url && !/^https:\/\//i.test(url)) back(`/admin/boats/${boatId}`, undefined, "The BoatFix link should start with https://");
  await prisma.boat.update({ where: { id: boatId }, data: { boatfixDeviceId: str(f, "boatfixDeviceId"), boatfixUrl: url } });
  back(`/admin/boats/${boatId}`, "BoatFix details saved");
}

export async function importBoatfixCsv(f: FormData) {
  await requirePermission("ops");
  const boatId = str(f, "boatId");
  const file = f.get("file");
  const text = file instanceof File && file.size > 0 ? await file.text() : str(f, "csv");
  if (!text) back(`/admin/boats/${boatId}`, undefined, "Choose a CSV file");
  const r = await importTelemetryCsv(boatId, text.slice(0, 2_000_000));
  if (!r.imported) back(`/admin/boats/${boatId}`, undefined, "No rows found. The file needs a date column and an engine hours column.");
  back(`/admin/boats/${boatId}`, `Imported ${r.imported} readings${r.latestHours != null ? `; engine hours now ${r.latestHours}` : ""}`);
}

export async function ackTelemetryAlert(f: FormData) {
  const s = await requireStaff();
  await prisma.telemetryAlert.update({ where: { id: str(f, "id") }, data: { status: "acknowledged", ackBy: s.name, ackAt: new Date() } });
  const to = str(f, "returnTo");
  redirect(to.startsWith("/") ? to : "/admin");
}

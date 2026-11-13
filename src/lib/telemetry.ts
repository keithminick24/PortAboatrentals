import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { parseTelemetry, parseTelemetryCsv, type ParsedTelemetry } from "./telemetryParse";

export const isTelemetryWebhookEnabled = () => !!process.env.TELEMETRY_WEBHOOK_SECRET;

export function checkTelemetryToken(given: string | null): boolean {
  const secret = process.env.TELEMETRY_WEBHOOK_SECRET;
  if (!secret || !given) return false;
  const a = createHash("sha256").update(secret).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

async function findBoat(p: ParsedTelemetry) {
  if (p.deviceId) {
    const b = await prisma.boat.findFirst({ where: { boatfixDeviceId: p.deviceId } });
    if (b) return b;
  }
  if (p.boatName) {
    const boats = await prisma.boat.findMany();
    const n = p.boatName.toLowerCase().replace(/\s+/g, "");
    return boats.find((b) => b.name.toLowerCase().replace(/\s+/g, "") === n || (b.hullId ?? "").toLowerCase() === n) ?? null;
  }
  return null;
}

/** Saves one telemetry message. Updates engine hours (never backwards) and raises alerts. */
export async function ingestTelemetry(payload: unknown): Promise<{ ok: boolean; boat?: string; alerts?: number; error?: string }> {
  const p = parseTelemetry(payload);
  const boat = await findBoat(p);
  if (!boat) return { ok: false, error: `No boat matches device "${p.deviceId ?? p.boatName ?? "?"}". Add the BoatFix device ID on the boat's page.` };
  if (p.engineHours != null || p.lat != null || p.batteryVolts != null) {
    await prisma.telemetryReading.create({
      data: { boatId: boat.id, source: "boatfix", recordedAt: p.recordedAt, engineHours: p.engineHours, lat: p.lat, lng: p.lng, batteryVolts: p.batteryVolts },
    });
  }
  if (p.engineHours != null && p.engineHours > boat.engineHours) {
    await prisma.boat.update({ where: { id: boat.id }, data: { engineHours: p.engineHours } });
  }
  let created = 0;
  for (const a of p.alerts) {
    if (a.externalId && (await prisma.telemetryAlert.findUnique({ where: { externalId: a.externalId } }))) continue;
    await prisma.telemetryAlert.create({
      data: { boatId: boat.id, externalId: a.externalId, kind: a.kind, message: a.message.slice(0, 500), occurredAt: a.occurredAt, raw: JSON.stringify(payload).slice(0, 4000) },
    });
    created++;
    const { alertCrew } = await import("./messaging");
    await alertCrew(`⚠ ${boat.name} (BoatFix): ${a.message}`.slice(0, 300));
  }
  return { ok: true, boat: boat.name, alerts: created };
}

/** Imports an exported engine-hours report for one boat. */
export async function importTelemetryCsv(boatId: string, text: string) {
  const rows = parseTelemetryCsv(text);
  if (rows.length === 0) return { imported: 0 };
  await prisma.telemetryReading.createMany({ data: rows.map((r) => ({ ...r, boatId, source: "csv" })) });
  const maxHours = Math.max(...rows.map((r) => r.engineHours ?? 0));
  const boat = await prisma.boat.findUniqueOrThrow({ where: { id: boatId } });
  if (maxHours > boat.engineHours) await prisma.boat.update({ where: { id: boatId }, data: { engineHours: maxHours } });
  return { imported: rows.length, latestHours: maxHours };
}

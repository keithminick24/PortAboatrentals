/**
 * Tolerant parsing of telematics data (BoatFix Fleet Manager Pro or similar).
 * BoatFix hasn't published an integration format, so this accepts the common
 * shapes (flat or nested JSON, CSV rows) and is easy to tighten once we see
 * their real payloads. Pure functions — covered by telemetryParse.test.ts.
 */

export type ParsedTelemetry = {
  deviceId: string | null;
  boatName: string | null;
  recordedAt: Date;
  engineHours: number | null;
  lat: number | null;
  lng: number | null;
  batteryVolts: number | null;
  alerts: { externalId: string | null; kind: string; message: string; occurredAt: Date }[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Finds the first value whose key (case/underscore-insensitive) matches one of `names`, searching nested objects. */
export function pick(o: unknown, names: string[], depth = 0): unknown {
  if (!isObj(o) || depth > 4) return undefined;
  const want = names.map((n) => n.toLowerCase().replace(/[_\s-]/g, ""));
  for (const [k, v] of Object.entries(o)) {
    if (want.includes(k.toLowerCase().replace(/[_\s-]/g, "")) && v !== null && v !== "") return v;
  }
  for (const v of Object.values(o)) {
    if (isObj(v)) {
      const found = pick(v, names, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/[^0-9.\-]/g, "")))) return Number(v.replace(/[^0-9.\-]/g, ""));
  return null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

export function toDate(v: unknown, fallback = new Date()): Date {
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
  if (typeof v === "string" && v.trim()) {
    const d = new Date(/^\d+$/.test(v) ? Number(v) * (v.length <= 10 ? 1000 : 1) : v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

/** Maps free-text alert names to our alert kinds. */
export function alertKind(text: string): string {
  const t = text.toLowerCase();
  if (/bilge|water|flood|high water/.test(t)) return "bilge";
  if (/batt|voltage|volts/.test(t)) return "low_battery";
  if (/geofence|geo-fence|boundary|zone|left area|outside/.test(t)) return "geofence";
  if (/shore ?power/.test(t)) return "shore_power";
  if (/engine|fault|check engine|overheat|temp|oil|code|rpm/.test(t)) return "engine_fault";
  return "other";
}

export function parseTelemetry(payload: unknown, now = new Date()): ParsedTelemetry {
  const root = isObj(payload) ? payload : {};
  const recordedAt = toDate(pick(root, ["timestamp", "time", "recordedAt", "eventTime", "createdAt", "date"]), now);
  const loc = pick(root, ["location", "position", "gps"]);
  const lat = num(pick(root, ["lat", "latitude"]) ?? (isObj(loc) ? pick(loc, ["lat", "latitude"]) : undefined));
  const lng = num(pick(root, ["lng", "lon", "long", "longitude"]) ?? (isObj(loc) ? pick(loc, ["lng", "lon", "longitude"]) : undefined));

  const alerts: ParsedTelemetry["alerts"] = [];
  const rawAlerts = pick(root, ["alerts", "alarms", "events"]);
  const list: unknown[] = Array.isArray(rawAlerts) ? rawAlerts : [];
  const single = pick(root, ["alert", "alarm", "alertType", "alarmType"]);
  if (single !== undefined) list.push(isObj(single) ? single : { type: single, message: pick(root, ["message", "description", "text"]) });
  for (const a of list) {
    const type = str(isObj(a) ? pick(a, ["type", "name", "alertType", "code"]) : a) ?? "Alert";
    const message = str(isObj(a) ? pick(a, ["message", "description", "text", "details"]) : null) ?? type;
    alerts.push({
      externalId: str(isObj(a) ? pick(a, ["id", "alertId", "eventId"]) : null),
      kind: alertKind(`${type} ${message}`),
      message: message === type ? type : `${type}: ${message}`,
      occurredAt: toDate(isObj(a) ? pick(a, ["timestamp", "time", "occurredAt", "createdAt"]) : null, recordedAt),
    });
  }

  return {
    deviceId: str(pick(root, ["deviceId", "device", "imei", "serial", "serialNumber", "unitId", "trackerId"])),
    boatName: str(pick(root, ["boatName", "vesselName", "vessel", "boat", "name"])),
    recordedAt,
    engineHours: num(pick(root, ["engineHours", "engine_hours", "hours", "hourMeter", "engineHourMeter"])),
    lat,
    lng,
    batteryVolts: num(pick(root, ["battery", "batteryVoltage", "batteryVolts", "voltage"])),
    alerts,
  };
}

/** CSV with a header row: date/time + engine hours (+ optional lat, lng, battery). */
export function parseTelemetryCsv(text: string): { recordedAt: Date; engineHours: number | null; lat: number | null; lng: number | null; batteryVolts: number | null }[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const split = (l: string) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
  const head = split(lines[0]).map((h) => h.toLowerCase().replace(/[_\s-]/g, ""));
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
  const iDate = col("date", "time", "timestamp");
  const iHours = col("enginehour", "hourmeter", "hours");
  const iLat = col("lat");
  const iLng = col("lng", "lon");
  const iBat = col("batt", "volt");
  if (iDate < 0 || iHours < 0) return [];
  return lines
    .slice(1)
    .map(split)
    .map((r) => ({
      recordedAt: toDate(r[iDate], new Date(NaN)),
      engineHours: num(r[iHours]),
      lat: iLat >= 0 ? num(r[iLat]) : null,
      lng: iLng >= 0 ? num(r[iLng]) : null,
      batteryVolts: iBat >= 0 ? num(r[iBat]) : null,
    }))
    .filter((r) => !Number.isNaN(r.recordedAt.getTime()) && r.engineHours != null);
}

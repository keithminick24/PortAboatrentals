import { describe, expect, it } from "vitest";
import { alertKind, parseTelemetry, parseTelemetryCsv } from "./telemetryParse";

describe("telemetry parsing", () => {
  it("reads a flat payload", () => {
    const p = parseTelemetry({ deviceId: "BF-123", engine_hours: "412.6", latitude: 27.83, longitude: -97.06, timestamp: "2026-11-13T15:00:00Z" });
    expect(p.deviceId).toBe("BF-123");
    expect(p.engineHours).toBe(412.6);
    expect(p.lat).toBeCloseTo(27.83);
    expect(p.recordedAt.toISOString()).toBe("2026-11-13T15:00:00.000Z");
  });
  it("reads nested payloads and alerts", () => {
    const p = parseTelemetry({ data: { vessel: { imei: 8675309, hourMeter: 100 }, location: { lat: 1, lon: 2 }, alert: { type: "High bilge water", id: "a1" } } });
    expect(p.deviceId).toBe("8675309");
    expect(p.engineHours).toBe(100);
    expect(p.lng).toBe(2);
    expect(p.alerts[0]).toMatchObject({ kind: "bilge", externalId: "a1" });
  });
  it("classifies alerts", () => {
    expect(alertKind("Low battery voltage")).toBe("low_battery");
    expect(alertKind("Geofence exit")).toBe("geofence");
    expect(alertKind("Check engine code 123")).toBe("engine_fault");
  });
  it("parses a CSV export", () => {
    const rows = parseTelemetryCsv("Date,Engine Hours,Battery\n2026-11-01 08:00,400.1,12.6\n2026-11-02 08:00,404.5,12.4\nbad,row,");
    expect(rows).toHaveLength(2);
    expect(rows[1].engineHours).toBe(404.5);
  });
});

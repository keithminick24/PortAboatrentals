import { describe, expect, it } from "vitest";
import { boatInsuranceState, expiryState, needsTpwdReminder, telHref } from "./incidentRules";

const now = new Date("2026-06-01T12:00:00Z");
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);

describe("needsTpwdReminder", () => {
  it("flags injuries, collisions, groundings and high severity", () => {
    expect(needsTpwdReminder({ type: "other", severity: "low", injuries: true })).toBe(true);
    expect(needsTpwdReminder({ type: "collision", severity: "low", injuries: false })).toBe(true);
    expect(needsTpwdReminder({ type: "grounding", severity: "low", injuries: false })).toBe(true);
    expect(needsTpwdReminder({ type: "mechanical", severity: "high", injuries: false })).toBe(true);
    expect(needsTpwdReminder({ type: "complaint", severity: "low", injuries: false, emsCalled: true })).toBe(true);
  });
  it("skips minor non-accidents", () => {
    expect(needsTpwdReminder({ type: "complaint", severity: "low", injuries: false })).toBe(false);
    expect(needsTpwdReminder({ type: "mechanical", severity: "medium", injuries: false })).toBe(false);
  });
});

describe("expiryState", () => {
  it("handles each state", () => {
    expect(expiryState(null, now)).toBe("missing");
    expect(expiryState(inDays(-1), now)).toBe("expired");
    expect(expiryState(inDays(10), now)).toBe("expiring");
    expect(expiryState(inDays(45), now)).toBe("expiring");
    expect(expiryState(inDays(46), now)).toBe("ok");
  });
});

describe("boatInsuranceState", () => {
  it("uses the best policy", () => {
    expect(boatInsuranceState([], now)).toBe("missing");
    expect(boatInsuranceState([{ expiresAt: inDays(-5) }], now)).toBe("expired");
    expect(boatInsuranceState([{ expiresAt: inDays(-5) }, { expiresAt: inDays(20) }], now)).toBe("expiring");
    expect(boatInsuranceState([{ expiresAt: inDays(-5) }, { expiresAt: inDays(200) }], now)).toBe("ok");
    expect(boatInsuranceState([{ expiresAt: null }], now)).toBe("ok");
  });
});

describe("telHref", () => {
  it("strips formatting", () => {
    expect(telHref("(800) 391-4869")).toBe("tel:8003914869");
    expect(telHref("+1 361-555-0100")).toBe("tel:+13615550100");
  });
});

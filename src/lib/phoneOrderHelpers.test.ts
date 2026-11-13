import { describe, expect, it } from "vitest";
import {
  isPlaceholderEmail,
  looksLikeEmail,
  matchAddOn,
  matchBoat,
  matchRate,
  nearestTimes,
  parseExtracted,
  placeholderEmail,
  preferenceToTime,
  splitName,
} from "./phoneOrderHelpers";

const rates = [
  { id: "h", label: "Half Day (4 hrs)", minutes: 240 },
  { id: "f", label: "Full Day (8 hrs)", minutes: 480 },
  { id: "s", label: "Sunset Cruise (2 hrs)", minutes: 120 },
];

describe("matchRate", () => {
  it("matches exact labels and package words", () => {
    expect(matchRate("Full Day (8 hrs)", rates)?.id).toBe("f");
    expect(matchRate("half day", rates)?.id).toBe("h");
    expect(matchRate("all day", rates)?.id).toBe("f");
    expect(matchRate("sunset", rates)?.id).toBe("s");
    expect(matchRate("4 hours", rates)?.id).toBe("h");
  });
  it("falls back to shortest/longest when labels don't say half/full", () => {
    const plain = [
      { id: "a", label: "3 Hours", minutes: 180 },
      { id: "b", label: "6 Hours", minutes: 360 },
    ];
    expect(matchRate("full day", plain)?.id).toBe("b");
    expect(matchRate("half day", plain)?.id).toBe("a");
  });
  it("returns null when nothing fits", () => {
    expect(matchRate(null, rates)).toBeNull();
    expect(matchRate("jet ski", rates)).toBeNull();
  });
});

describe("matchBoat / matchAddOn", () => {
  const boats = [{ name: "Reel Deal" }, { name: "Island Time II" }];
  it("matches boats loosely", () => {
    expect(matchBoat("reel deal", boats)?.name).toBe("Reel Deal");
    expect(matchBoat("Island Time", boats)?.name).toBe("Island Time II");
    expect(matchBoat("the big one", boats)).toBeNull();
    expect(matchBoat("", boats)).toBeNull();
  });
  it("matches add-ons ignoring spaces and plurals", () => {
    const addOns = [{ name: "Paddle Board" }, { name: "Mega Chill Cooler" }];
    expect(matchAddOn("paddleboards", addOns)?.name).toBe("Paddle Board");
    expect(matchAddOn("mega chill", addOns)?.name).toBe("Mega Chill Cooler");
    expect(matchAddOn("kayak", addOns)).toBeNull();
  });
});

describe("emails and names", () => {
  it("builds a placeholder email from the phone digits", () => {
    expect(placeholderEmail("+1 (361) 555-0123")).toBe("phone-3615550123@phone-orders.invalid");
    expect(isPlaceholderEmail("phone-3615550123@phone-orders.invalid")).toBe(true);
    expect(isPlaceholderEmail("jane@gmail.com")).toBe(false);
  });
  it("checks emails", () => {
    expect(looksLikeEmail("jane.smith@gmail.com")).toBe(true);
    expect(looksLikeEmail("jane at gmail")).toBe(false);
    expect(looksLikeEmail(null)).toBe(false);
  });
  it("splits names", () => {
    expect(splitName("Jane Q Smith")).toEqual({ firstName: "Jane", lastName: "Q Smith" });
    expect(splitName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
    expect(splitName("  ")).toEqual({ firstName: "Phone", lastName: "Guest" });
  });
});

describe("time suggestions", () => {
  it("finds the nearest open start times, in order", () => {
    expect(nearestTimes("10:00", ["08:00", "08:30", "11:00", "13:00", "14:00"])).toEqual(["08:00", "08:30", "11:00"]);
    expect(nearestTimes("09:00", ["08:30", "09:30", "15:00"], 2)).toEqual(["08:30", "09:30"]);
    expect(nearestTimes("09:00", [])).toEqual([]);
  });
  it("maps time-of-day words", () => {
    expect(preferenceToTime("in the morning")).toBe("09:00");
    expect(preferenceToTime("afternoon")).toBe("13:00");
    expect(preferenceToTime("sunset")).toBe("17:00");
    expect(preferenceToTime("whenever")).toBeNull();
  });
  it("parses stored JSON safely", () => {
    expect(parseExtracted("{bad")).toEqual({});
    expect(parseExtracted('{"date":"2026-11-14"}').date).toBe("2026-11-14");
  });
});

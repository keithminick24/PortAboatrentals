import { describe, expect, it } from "vitest";
import {
  channelsFor,
  consentBlock,
  describeTiming,
  hoursFromTiming,
  inAfterBookingWindow,
  inAfterTripWindow,
  inBeforeTripWindow,
  inWinBackWindow,
  matchesSegment,
  optKeyword,
  parseSegment,
  renderTemplate,
  reviewLinkFrom,
  textToHtml,
  timingFromHours,
} from "./campaignLogic";
import { sparkPoints, trendSummary } from "./reviewStats";

const H = 3600000;
const D = 24 * H;
const now = new Date("2026-07-01T15:00:00Z");

describe("renderTemplate", () => {
  it("fills merge tags and tolerates spaces", () => {
    expect(renderTemplate("Hi {{firstName}}, {{ boat }} on {{date}}", { firstName: "Ann", boat: "Tritoon 2", date: "Sat, Jul 4" })).toBe(
      "Hi Ann, Tritoon 2 on Sat, Jul 4",
    );
  });
  it("drops missing tags cleanly", () => {
    expect(renderTemplate("See you at {{time}}. {{waiverReminder}}", { time: "9:00 AM" })).toBe("See you at 9:00 AM.");
    expect(renderTemplate("Hi {{nope}} there", {})).toBe("Hi there");
  });
  it("keeps paragraphs but collapses extra blank lines", () => {
    expect(renderTemplate("A\n\n{{x}}\n\nB", {})).toBe("A\n\nB");
  });
});

describe("reviewLinkFrom", () => {
  it("prefers the Google link, then Place ID, then Facebook", () => {
    expect(reviewLinkFrom({ googleReviewUrl: "https://g.page/r/x", googlePlaceId: "abc", facebookReviewUrl: "https://fb" })).toBe("https://g.page/r/x");
    expect(reviewLinkFrom({ googlePlaceId: "ChIJ123", facebookReviewUrl: "https://fb" })).toBe("https://search.google.com/local/writereview?placeid=ChIJ123");
    expect(reviewLinkFrom({ facebookReviewUrl: "https://fb" })).toBe("https://fb");
    expect(reviewLinkFrom({})).toBe("");
  });
});

describe("consent", () => {
  const base = { marketingOptIn: false, smsOptOut: false, emailOptOut: false, phone: "361-555-0123", email: "a@b.co" };
  it("blocks promotions without opt-in", () => {
    expect(consentBlock(base, "sms", true, true)).toMatch(/opted in/);
    expect(consentBlock({ ...base, marketingOptIn: true }, "sms", true, true)).toBeNull();
  });
  it("lets trip info go without opt-in", () => {
    expect(consentBlock(base, "email", false, true)).toBeNull();
  });
  it("always honors STOP and unsubscribe", () => {
    expect(consentBlock({ ...base, marketingOptIn: true, smsOptOut: true }, "sms", false, true)).toMatch(/texts/);
    expect(consentBlock({ ...base, smsOptOut: true }, "email", false, true)).toBeNull();
    expect(consentBlock({ ...base, emailOptOut: true }, "email", false, true)).toMatch(/Unsubscribed/);
  });
  it("skips invalid phones and emails", () => {
    expect(consentBlock(base, "sms", false, false)).toMatch(/phone/);
    expect(consentBlock({ ...base, email: "nope" }, "email", false, true)).toMatch(/email/);
  });
  it("splits channels", () => {
    expect(channelsFor("both")).toEqual(["sms", "email"]);
    expect(channelsFor("email")).toEqual(["email"]);
    expect(channelsFor("sms")).toEqual(["sms"]);
  });
  it("recognizes STOP/START keywords", () => {
    expect(optKeyword(" stop ")).toBe("stop");
    expect(optKeyword("Unsubscribe")).toBe("stop");
    expect(optKeyword("QUIT")).toBe("stop");
    expect(optKeyword("unstop")).toBe("start");
    expect(optKeyword("Start")).toBe("start");
    expect(optKeyword("stop by at 3?")).toBeNull();
  });
});

describe("windows", () => {
  it("before trip: starts within offset, not started", () => {
    expect(inBeforeTripWindow(new Date(+now + 47 * H), 48, now)).toBe(true);
    expect(inBeforeTripWindow(new Date(+now + 49 * H), 48, now)).toBe(false);
    expect(inBeforeTripWindow(new Date(+now - H), 48, now)).toBe(false);
  });
  it("after trip: between offset and offset+48h ago", () => {
    expect(inAfterTripWindow(new Date(+now - 1 * H), 2, now)).toBe(false);
    expect(inAfterTripWindow(new Date(+now - 3 * H), 2, now)).toBe(true);
    expect(inAfterTripWindow(new Date(+now - 51 * H), 2, now)).toBe(false);
  });
  it("after booking: 48h window", () => {
    expect(inAfterBookingWindow(new Date(+now - 25 * H), 24, now)).toBe(true);
    expect(inAfterBookingWindow(new Date(+now - 23 * H), 24, now)).toBe(false);
    expect(inAfterBookingWindow(new Date(+now - 73 * H), 24, now)).toBe(false);
  });
  it("win-back: offset days, 7-day window", () => {
    expect(inWinBackWindow(new Date(+now - 299 * D), 300 * 24, now)).toBe(false);
    expect(inWinBackWindow(new Date(+now - 301 * D), 300 * 24, now)).toBe(true);
    expect(inWinBackWindow(new Date(+now - 308 * D), 300 * 24, now)).toBe(false);
  });
});

describe("timing units", () => {
  it("round-trips friendly units", () => {
    expect(timingFromHours(48)).toEqual({ value: 48, unit: "hours" });
    expect(timingFromHours(96)).toEqual({ value: 4, unit: "days" });
    expect(timingFromHours(3)).toEqual({ value: 3, unit: "hours" });
    expect(hoursFromTiming(2, "days")).toBe(48);
    expect(describeTiming("before_trip", 48)).toBe("48 hours before trip");
    expect(describeTiming("after_trip", 2)).toBe("2 hours after trip");
    expect(describeTiming("after_trip", 1)).toBe("1 hour after trip");
    expect(describeTiming("win_back", 300 * 24)).toBe("300 days after last trip");
  });
});

describe("segments", () => {
  const trip = (status: string, daysAgo: number) => ({ status, startsAt: new Date(+now - daysAgo * D - 4 * H), endsAt: new Date(+now - daysAgo * D) });
  it("parses safely", () => {
    expect(parseSegment("not json")).toEqual({});
    expect(parseSegment('{"tags":["VIP"," "],"minTrips":2,"hasFutureBooking":false}')).toEqual({ tags: ["vip"], minTrips: 2, hasFutureBooking: false });
  });
  it("matches tags any-of, trips and recency", () => {
    const c = { tags: "vip, local", trips: [trip("completed", 100), trip("returned", 20), trip("cancelled", 5)] };
    expect(matchesSegment(c, { tags: ["local", "x"] }, now)).toBe(true);
    expect(matchesSegment(c, { tags: ["x"] }, now)).toBe(false);
    expect(matchesSegment(c, { minTrips: 2 }, now)).toBe(true);
    expect(matchesSegment(c, { minTrips: 3 }, now)).toBe(false);
    expect(matchesSegment(c, { lastTripWithinDays: 30 }, now)).toBe(true);
    expect(matchesSegment(c, { lastTripWithinDays: 10 }, now)).toBe(false);
  });
  it("checks upcoming bookings", () => {
    const future = { tags: "", trips: [trip("confirmed", -5)] };
    const none = { tags: "", trips: [trip("completed", 50)] };
    expect(matchesSegment(future, { hasFutureBooking: true }, now)).toBe(true);
    expect(matchesSegment(none, { hasFutureBooking: true }, now)).toBe(false);
    expect(matchesSegment(none, { hasFutureBooking: false }, now)).toBe(true);
  });
});

describe("email html", () => {
  it("escapes and links", () => {
    const html = textToHtml("Hi <b>\n\nGo: https://x.co/b/1");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain('<a href="https://x.co/b/1"');
  });
});

describe("review trends", () => {
  it("computes 30-day change", () => {
    const snaps = [
      { rating: 4.7, count: 100, takenAt: new Date(+now - 40 * D) },
      { rating: 4.8, count: 110, takenAt: new Date(+now - 10 * D) },
      { rating: 4.9, count: 120, takenAt: now },
    ];
    expect(trendSummary(snaps, 30, now)).toMatchObject({ countChange: 20, ratingChange: 0.2 });
    expect(trendSummary([], 30, now).latest).toBeNull();
    expect(sparkPoints([1, 2], 100, 20).split(" ")).toHaveLength(2);
  });
});

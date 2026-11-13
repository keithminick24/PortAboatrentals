import { describe, expect, it } from "vitest";
import { ageOn, checkAges } from "./ages";

describe("signing ages", () => {
  it("counts birthdays correctly", () => {
    expect(ageOn("2005-06-15", "2026-06-14")).toBe(20);
    expect(ageOn("2005-06-15", "2026-06-15")).toBe(21);
  });
  it("renter must be 21+", () => {
    expect(checkAges({ dateOfBirth: "2006-01-01" }, true, "2026-11-13")).toMatch(/at least 21/);
    expect(checkAges({ dateOfBirth: "1990-01-01" }, true, "2026-11-13")).toBeNull();
  });
  it("passengers 18+ sign for themselves; guardians sign for under-18s", () => {
    expect(checkAges({ dateOfBirth: "2010-01-01" }, false, "2026-11-13")).toMatch(/parent or guardian/);
    expect(checkAges({ dateOfBirth: "1985-01-01", minorName: "Kid", minorDob: "2015-05-05" }, false, "2026-11-13")).toBeNull();
    expect(checkAges({ dateOfBirth: "1985-01-01", minorName: "Teen", minorDob: "2006-05-05" }, false, "2026-11-13")).toMatch(/18 or older/);
  });
});

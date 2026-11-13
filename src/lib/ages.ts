import { todayLocal } from "./time";

/** Whole years between a YYYY-MM-DD birthday and a YYYY-MM-DD day. */
export function ageOn(dob: string, day: string): number {
  const [by, bm, bd] = dob.split("-").map(Number);
  const [y, m, d] = day.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export const RENTER_MIN_AGE = 21;
export const ADULT_AGE = 18;

/** Age rules: renter 21+ (per the rental agreement); passenger signers 18+; a child being signed for is under 18. */
export function checkAges(input: { dateOfBirth?: string; minorName?: string; minorDob?: string }, isPrimary: boolean, today = todayLocal()): string | null {
  const age = ageOn(input.dateOfBirth!, today);
  if (age < 0 || age > 110) return "Please check the date of birth.";
  if (isPrimary) {
    if (input.minorName) return "The renter must sign for themselves.";
    if (age < RENTER_MIN_AGE) return `The renter must be at least ${RENTER_MIN_AGE}. Please have an adult ${RENTER_MIN_AGE}+ in your group book and sign.`;
    return null;
  }
  if (age < ADULT_AGE) return "Guests under 18 can't sign. A parent or guardian should sign for them by choosing \"I'm signing for a child\".";
  if (input.minorName) {
    const childAge = ageOn(input.minorDob!, today);
    if (childAge < 0) return "Please check the child's date of birth.";
    if (childAge >= ADULT_AGE) return "This guest is 18 or older and should sign for themselves.";
  }
  return null;
}


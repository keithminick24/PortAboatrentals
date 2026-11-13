/**
 * Pure pricing logic shared by the server (authoritative) and the booking
 * wizard (live preview). No server-only imports here.
 */

/** A mandatory fee as configured in Admin → Fees. */
export type FeeDef = {
  id: string;
  name: string;
  /** "added" = charged on top of the rental; "included" = a portion of the rental price shown separately (e.g. fuel). */
  mode: string;
  /** "flat" = amount from duration tiers; "percent" = percent of the rental price. */
  calc: string;
  percentBps: number;
  taxable: boolean;
  /** Flat amounts by trip length. The tier with the largest minMinutes ≤ trip length applies. */
  tiers: { minMinutes: number; amountCents: number }[];
};

export type FeeLine = { feeId: string; name: string; mode: string; amountCents: number; taxable: boolean };

export type QuoteInput = {
  rentalCents: number;
  minutes: number;
  addOns: { priceCents: number; quantity: number }[];
  fees: FeeDef[];
  taxRateBps: number;
  /** Card convenience fee: percent (bps) of the pre-fee total plus a flat amount. Null = not charged. */
  convenience: { bps: number; cents: number } | null;
};

export type Quote = {
  subtotalCents: number;
  addOnsCents: number;
  /** Mandatory fees added on top of the rental. */
  feesCents: number;
  /** Portion of the rental attributed to "included" fees (informational, already inside subtotalCents). */
  includedCents: number;
  feeLines: FeeLine[];
  taxCents: number;
  convenienceFeeCents: number;
  totalCents: number;
};

export function feeAmount(fee: FeeDef, minutes: number, rentalCents: number): number {
  if (fee.calc === "percent") return Math.round((rentalCents * fee.percentBps) / 10000);
  const tier = [...fee.tiers].sort((a, b) => b.minMinutes - a.minMinutes).find((t) => t.minMinutes <= minutes);
  return tier?.amountCents ?? 0;
}

export function convenienceFee(baseCents: number, c: { bps: number; cents: number } | null): number {
  if (!c || baseCents <= 0 || (c.bps <= 0 && c.cents <= 0)) return 0;
  return Math.round((baseCents * c.bps) / 10000) + c.cents;
}

/**
 * Rental, add-ons and taxable fees are taxed. Included fees are part of the
 * rental (taxed with it) and don't change the total. The convenience fee is
 * applied last, on the full pre-fee total, and is not taxed.
 */
export function computeQuote(input: QuoteInput): Quote {
  const subtotalCents = input.rentalCents;
  const addOnsCents = input.addOns.reduce((sum, a) => sum + a.priceCents * a.quantity, 0);
  const feeLines: FeeLine[] = input.fees
    .map((f) => ({
      feeId: f.id,
      name: f.name,
      mode: f.mode,
      taxable: f.taxable,
      amountCents: feeAmount(f, input.minutes, input.rentalCents),
    }))
    .filter((l) => l.amountCents > 0);
  const added = feeLines.filter((l) => l.mode !== "included");
  const feesCents = added.reduce((s, l) => s + l.amountCents, 0);
  const includedCents = Math.min(
    subtotalCents,
    feeLines.filter((l) => l.mode === "included").reduce((s, l) => s + l.amountCents, 0),
  );
  const taxable = subtotalCents + addOnsCents + added.filter((l) => l.taxable).reduce((s, l) => s + l.amountCents, 0);
  const taxCents = Math.round((taxable * input.taxRateBps) / 10000);
  const preFee = subtotalCents + addOnsCents + feesCents + taxCents;
  const convenienceFeeCents = convenienceFee(preFee, input.convenience);
  return {
    subtotalCents,
    addOnsCents,
    feesCents,
    includedCents,
    feeLines,
    taxCents,
    convenienceFeeCents,
    totalCents: preFee + convenienceFeeCents,
  };
}

export function isWeekendDay(weekday: number, weekendDays: string): boolean {
  return weekendDays
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .includes(weekday);
}

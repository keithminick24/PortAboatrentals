export type QuoteInput = {
  rate: { priceCents: number; weekendPriceCents: number | null };
  isWeekend: boolean;
  addOns: { priceCents: number; quantity: number }[];
  taxRateBps: number;
  feeRateBps: number;
};

export type Quote = {
  subtotalCents: number;
  addOnsCents: number;
  feesCents: number;
  taxCents: number;
  totalCents: number;
};

/**
 * Rental + add-ons are taxable; the booking fee (if any) is not.
 * Rounds each component to whole cents.
 */
export function computeQuote(input: QuoteInput): Quote {
  const subtotalCents =
    input.isWeekend && input.rate.weekendPriceCents != null ? input.rate.weekendPriceCents : input.rate.priceCents;
  const addOnsCents = input.addOns.reduce((sum, a) => sum + a.priceCents * a.quantity, 0);
  const taxable = subtotalCents + addOnsCents;
  const taxCents = Math.round((taxable * input.taxRateBps) / 10000);
  const feesCents = Math.round((subtotalCents * input.feeRateBps) / 10000);
  return { subtotalCents, addOnsCents, feesCents, taxCents, totalCents: taxable + taxCents + feesCents };
}

export function isWeekendDay(weekday: number, weekendDays: string): boolean {
  return weekendDays
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .includes(weekday);
}

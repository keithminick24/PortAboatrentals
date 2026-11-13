import "server-only";
import { prisma } from "./db";
import { appUrl } from "./mail";
import { logEvent } from "./bookings";
import { isMockPayments, stripe } from "./payments";
import { fmtMoney } from "./money";

/**
 * Crew tips. Three ways in:
 *   booking   – chosen in the booking wizard (included in the booking total; Tip row
 *               created in onBookingConfirmed)
 *   dock      – at check-in on the dock (card on file or cash)
 *   post_trip – from the /t/<accessToken> link texted after the trip
 * Each tip is split evenly between the crew on that trip (BookingCrew rows), see crewMath.ts.
 *
 * With no STRIPE_SECRET_KEY, card tips are recorded with method "mock" and nothing is charged.
 */

import { tipEarnedAt, tipShares } from "./crewMath";
export { tipShares, splitTip, UNASSIGNED } from "./crewMath";

export type TipMethod = "card" | "cash" | "mock";
export type TipSource = "booking" | "dock" | "post_trip" | "office";

export const TIP_SOURCE_LABELS: Record<string, string> = {
  booking: "At booking",
  dock: "At the dock",
  post_trip: "After the trip",
  office: "Office",
};

export const MAX_TIP_CENTS = 100000;

export async function recordTip(input: {
  bookingId: string;
  amountCents: number;
  method: TipMethod;
  source: TipSource;
  actor?: string | null;
  stripeId?: string | null;
}) {
  const amount = Math.round(input.amountCents);
  if (!(amount > 0) || amount > MAX_TIP_CENTS) throw new Error("Tip must be between $0.01 and $1,000.");
  const tip = await prisma.tip.create({
    data: {
      bookingId: input.bookingId,
      amountCents: amount,
      method: input.method,
      source: input.source,
      stripeId: input.stripeId ?? null,
      createdBy: input.actor ?? null,
    },
  });
  await logEvent(
    input.bookingId,
    "tip",
    `Crew tip ${fmtMoney(amount)} (${input.method === "mock" ? "card, test mode" : input.method}, ${TIP_SOURCE_LABELS[input.source] ?? input.source})`,
    input.actor ?? "guest",
  );
  return tip;
}

/** True when a one-tap tip to the saved card is possible (always true in test mode). */
export function hasCardOnFile(b: { stripePaymentMethodId: string | null; customer: { stripeCustomerId: string | null } }) {
  return isMockPayments() || !!(b.stripePaymentMethodId && b.customer.stripeCustomerId);
}

/** Charges a tip to the card saved at booking (off-session, captured right away). */
export async function chargeTipToCardOnFile(
  bookingId: string,
  amountCents: number,
  source: TipSource,
  actor?: string | null,
): Promise<{ ok: true; tipId: string } | { ok: false; error: string }> {
  const amount = Math.round(amountCents);
  if (!(amount > 0) || amount > MAX_TIP_CENTS) return { ok: false, error: "Tip must be between $0.01 and $1,000." };
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { customer: true } });

  if (isMockPayments()) {
    const tip = await recordTip({ bookingId, amountCents: amount, method: "mock", source, actor });
    return { ok: true, tipId: tip.id };
  }
  if (!b.stripePaymentMethodId || !b.customer.stripeCustomerId) {
    return { ok: false, error: "No card on file for this booking." };
  }
  try {
    const pi = await stripe().paymentIntents.create({
      amount,
      currency: "usd",
      customer: b.customer.stripeCustomerId,
      payment_method: b.stripePaymentMethodId,
      off_session: true,
      confirm: true,
      description: `Crew tip ${b.code}`,
      metadata: { tipBookingId: b.id, code: b.code, kind: "tip", source },
    });
    if (pi.status !== "succeeded") return { ok: false, error: `Card not charged (status: ${pi.status}).` };
    const tip = await recordTip({ bookingId, amountCents: amount, method: "card", source, actor, stripeId: pi.id });
    return { ok: true, tipId: tip.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Card was declined.";
    await logEvent(b.id, "tip_failed", `Tip charge of ${fmtMoney(amount)} failed: ${msg}`, actor ?? "guest");
    return { ok: false, error: msg };
  }
}

/**
 * Stripe Checkout for a tip with a new card (post-trip page). Metadata uses `tipBookingId`
 * (not `bookingId`) so the rental-payment webhook handler ignores these sessions.
 */
export async function createTipCheckout(bookingId: string, amountCents: number): Promise<string> {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { customer: true, boat: true } });
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    ...(b.customer.stripeCustomerId ? { customer: b.customer.stripeCustomerId } : { customer_email: b.customer.email }),
    line_items: [
      {
        quantity: 1,
        price_data: { currency: "usd", unit_amount: amountCents, product_data: { name: "Crew tip", description: `${b.boat.name} · Booking ${b.code}` } },
      },
    ],
    payment_intent_data: { description: `Crew tip ${b.code}`, metadata: { tipBookingId: b.id, code: b.code, kind: "tip", source: "post_trip" } },
    metadata: { tipBookingId: b.id, kind: "tip" },
    success_url: await appUrl(`/t/${b.accessToken}?tip_session={CHECKOUT_SESSION_ID}`),
    cancel_url: await appUrl(`/t/${b.accessToken}`),
  });
  return session.url!;
}

/**
 * Idempotently records a paid tip Checkout Session. Called on the success redirect;
 * safe to also call from the Stripe webhook for `checkout.session.completed` when
 * `session.metadata.kind === "tip"`.
 */
export async function finalizeTipCheckout(sessionId: string): Promise<boolean> {
  if (isMockPayments()) return false;
  const session = await stripe().checkout.sessions.retrieve(sessionId);
  const bookingId = session.metadata?.tipBookingId;
  if (session.payment_status !== "paid" || !bookingId || session.metadata?.kind !== "tip") return false;
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!piId) return false;
  if (await prisma.tip.findFirst({ where: { stripeId: piId } })) return true;
  await recordTip({ bookingId, amountCents: session.amount_total ?? 0, method: "card", source: "post_trip", actor: "guest", stripeId: piId });
  return true;
}

/** Crew on a trip, oldest first (the first person gets any leftover cents). */
export async function tripCrew(bookingIds: string[]) {
  const rows = await prisma.bookingCrew.findMany({
    where: { bookingId: { in: bookingIds } },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ id: r.id, bookingId: r.bookingId, userId: r.userId, name: r.user.name, role: r.role }));
}

/** Suggested tip amounts (Settings.tipPercents of the boat rental subtotal). */
export function tipSuggestions(subtotalCents: number, tipPercents: string) {
  return tipPercents
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 100)
    .map((pct) => ({ pct, cents: Math.round((subtotalCents * pct) / 100) }));
}

/**
 * Tips earned in [start, end), split per person. A tip counts in the period of the later
 * of the trip start and when it was received (see tipEarnedAt).
 */
export async function tipsForPeriod(start: Date, end: Date) {
  const tips = await prisma.tip.findMany({
    where: {
      createdAt: { lt: end },
      booking: { startsAt: { lt: end } },
      OR: [{ createdAt: { gte: start } }, { booking: { startsAt: { gte: start } } }],
    },
    include: { booking: { select: { startsAt: true } } },
  });
  const inPeriod = tips.filter((t) => {
    const at = tipEarnedAt(t.createdAt, t.booking.startsAt);
    return at >= start && at < end;
  });
  const crew = await tripCrew([...new Set(inPeriod.map((t) => t.bookingId))]);
  return { tips: inPeriod, crew, ...tipShares(inPeriod, crew) };
}

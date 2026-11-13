import "server-only";
import Stripe from "stripe";
import { prisma } from "./db";
import { appUrl } from "./mail";
import { fmtRange } from "./time";
import { logEvent, onBookingConfirmed } from "./bookings";

/**
 * Payments.
 *
 * Rental charge: taken at booking through Stripe Checkout. The card is saved
 * to the Stripe customer (setup_future_usage=off_session) so we can place the
 * security deposit later without the customer present.
 *
 * Security deposit: card authorizations only last ~7 days, so the hold is
 * placed close to the trip (automatically by /api/cron 24h ahead, or by staff
 * at check-out). After return staff either release it or capture some/all
 * of it for damage, fuel, cleaning, etc.
 *
 * With no STRIPE_SECRET_KEY set the app runs in MOCK mode: every money
 * movement is recorded in the ledger but nothing is charged.
 */

export const isMockPayments = () => !process.env.STRIPE_SECRET_KEY;

let _stripe: Stripe | null = null;
export function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured");
  _stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

async function loadBooking(id: string) {
  return prisma.booking.findUniqueOrThrow({
    where: { id },
    include: { boat: true, customer: true, rate: true, addOns: { include: { addOn: true } }, fees: true },
  });
}

type LoadedBooking = Awaited<ReturnType<typeof loadBooking>>;

/** Itemized Checkout lines for an unpaid booking, so the receipt shows each fee. */
function checkoutLines(b: LoadedBooking, balance: number) {
  const line = (name: string, amount: number, description?: string) => ({
    quantity: 1,
    price_data: { currency: "usd", unit_amount: amount, product_data: { name, ...(description ? { description } : {}) } },
  });
  if (b.paidCents > 0) {
    return [line(`Balance - ${b.boat.name}`, balance, `${fmtRange(b.startsAt, b.endsAt)} · Booking ${b.code}`)];
  }
  const included = b.fees.filter((f) => f.mode === "included");
  const lines = [
    line(
      `${b.boat.name} - ${b.rate?.label ?? "Boat rental"}`,
      b.subtotalCents,
      [`${fmtRange(b.startsAt, b.endsAt)} · Booking ${b.code}`, ...included.map((f) => `includes ${f.name.toLowerCase()} $${(f.amountCents / 100).toFixed(2)}`)].join(" · "),
    ),
    ...b.addOns.map((a) => ({ ...line(a.addOn.name, a.priceCents), quantity: a.quantity })),
    ...b.fees.filter((f) => f.mode !== "included").map((f) => line(f.name, f.amountCents)),
  ];
  if (b.taxCents > 0) lines.push(line("Sales tax", b.taxCents));
  if (b.convenienceFeeCents > 0) lines.push(line("Card convenience fee", b.convenienceFeeCents));
  if (b.tipCents > 0) lines.push(line("Crew tip", b.tipCents));
  const sum = lines.reduce((s, l) => s + l.price_data.unit_amount * l.quantity, 0);
  // Safety net: if anything doesn't add up, fall back to one line for the exact balance.
  return sum === balance ? lines : [line(`${b.boat.name} - ${b.rate?.label ?? "Boat rental"}`, balance, `Booking ${b.code}`)];
}

async function ensureStripeCustomer(customerId: string): Promise<string> {
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  if (c.stripeCustomerId) return c.stripeCustomerId;
  const sc = await stripe().customers.create({
    email: c.email,
    name: `${c.firstName} ${c.lastName}`,
    phone: c.phone,
    metadata: { customerId: c.id },
  });
  await prisma.customer.update({ where: { id: c.id }, data: { stripeCustomerId: sc.id } });
  return sc.id;
}

/** Returns a URL to send the customer to for payment. */
export async function createCheckout(bookingId: string): Promise<string> {
  const b = await loadBooking(bookingId);
  const balance = b.totalCents - b.paidCents;
  if (balance <= 0) return await appUrl(`/b/${b.accessToken}`);

  if (isMockPayments()) return await appUrl(`/b/${b.accessToken}/mock-pay`);

  const customer = await ensureStripeCustomer(b.customerId);
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer,
    line_items: checkoutLines(b, balance),
    payment_intent_data: {
      setup_future_usage: "off_session",
      description: `Boat rental ${b.code}`,
      metadata: { bookingId: b.id, code: b.code },
    },
    metadata: { bookingId: b.id, code: b.code },
    success_url: await appUrl(`/b/${b.accessToken}?session_id={CHECKOUT_SESSION_ID}`),
    cancel_url: await appUrl(`/b/${b.accessToken}`),
    expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
  });
  await prisma.booking.update({ where: { id: b.id }, data: { stripeCheckoutSessionId: session.id } });
  return session.url!;
}

/** Idempotently records a completed Checkout Session (called from webhook and success redirect). */
export async function finalizeCheckoutSession(sessionId: string): Promise<void> {
  const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
  if (session.payment_status !== "paid") return;
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) return;
  const pi = session.payment_intent as Stripe.PaymentIntent | null;
  if (!pi) return;

  const existing = await prisma.payment.findFirst({ where: { stripeId: pi.id, kind: "charge" } });
  if (existing) return;

  const pm = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
  await recordRentalPayment(bookingId, pi.amount_received, "card", pi.id, pm ?? null, "Stripe");
}

/** Mock-mode payment and staff-recorded payments (cash, check, external terminal). */
export async function recordRentalPayment(
  bookingId: string,
  amountCents: number,
  method: string,
  stripeId: string | null,
  paymentMethodId: string | null,
  actor: string,
  note = "",
) {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const paid = b.paidCents + amountCents;
  const wasPending = b.status === "pending";
  await prisma.$transaction([
    prisma.payment.create({
      data: { bookingId, kind: "charge", amountCents, method, stripeId, note, createdBy: actor },
    }),
    prisma.booking.update({
      where: { id: bookingId },
      data: {
        paidCents: paid,
        paymentStatus: paid >= b.totalCents ? "paid" : "unpaid",
        stripePaymentIntentId: stripeId ?? b.stripePaymentIntentId,
        stripePaymentMethodId: paymentMethodId ?? b.stripePaymentMethodId,
        depositStatus:
          (paymentMethodId || method === "mock") && b.depositStatus === "none" ? "card_saved" : b.depositStatus,
        status: wasPending && paid >= b.totalCents ? "confirmed" : b.status,
        holdExpiresAt: paid >= b.totalCents ? null : b.holdExpiresAt,
      },
    }),
  ]);
  await logEvent(bookingId, "payment", `Payment received: $${(amountCents / 100).toFixed(2)} (${method})`, actor);
  if (wasPending && paid >= b.totalCents) await onBookingConfirmed(bookingId);
}

export async function placeDepositHold(bookingId: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  const b = await loadBooking(bookingId);
  if (b.depositCents <= 0) return { ok: false, error: "This booking has no deposit amount." };
  if (b.depositStatus === "held") return { ok: true };

  let stripeId: string | null = null;
  if (!isMockPayments()) {
    if (!b.stripePaymentMethodId || !b.customer.stripeCustomerId) {
      return { ok: false, error: "No saved card. Collect the deposit in person or send a payment link." };
    }
    try {
      const pi = await stripe().paymentIntents.create({
        amount: b.depositCents,
        currency: "usd",
        customer: b.customer.stripeCustomerId,
        payment_method: b.stripePaymentMethodId,
        capture_method: "manual",
        off_session: true,
        confirm: true,
        description: `Security deposit ${b.code}`,
        metadata: { bookingId: b.id, code: b.code, kind: "deposit" },
      });
      if (pi.status !== "requires_capture") {
        return { ok: false, error: `Card hold not authorized (status: ${pi.status}).` };
      }
      stripeId = pi.id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Card was declined.";
      await logEvent(b.id, "deposit_failed", `Deposit hold failed: ${msg}`, actor);
      return { ok: false, error: msg };
    }
  }

  await prisma.$transaction([
    prisma.booking.update({
      where: { id: b.id },
      data: { depositStatus: "held", depositHeldAt: new Date(), stripeDepositIntentId: stripeId },
    }),
    prisma.payment.create({
      data: {
        bookingId: b.id,
        kind: "deposit_hold",
        amountCents: b.depositCents,
        method: stripeId ? "card" : "mock",
        stripeId,
        createdBy: actor,
      },
    }),
  ]);
  await logEvent(b.id, "deposit_held", `Security deposit hold placed: $${(b.depositCents / 100).toFixed(2)}`, actor);
  return { ok: true };
}

export async function releaseDeposit(bookingId: string, actor: string) {
  const b = await loadBooking(bookingId);
  if (b.depositStatus !== "held") throw new Error("No active deposit hold to release.");
  if (b.stripeDepositIntentId && !isMockPayments()) {
    await stripe().paymentIntents.cancel(b.stripeDepositIntentId);
  }
  await prisma.$transaction([
    prisma.booking.update({ where: { id: b.id }, data: { depositStatus: "released" } }),
    prisma.payment.create({
      data: {
        bookingId: b.id,
        kind: "deposit_release",
        amountCents: b.depositCents,
        method: b.stripeDepositIntentId ? "card" : "mock",
        stripeId: b.stripeDepositIntentId,
        createdBy: actor,
      },
    }),
  ]);
  await logEvent(b.id, "deposit_released", "Security deposit released in full", actor);
}

export async function captureDeposit(bookingId: string, amountCents: number, reason: string, actor: string) {
  const b = await loadBooking(bookingId);
  if (b.depositStatus !== "held") throw new Error("No active deposit hold to capture.");
  if (amountCents <= 0 || amountCents > b.depositCents) throw new Error("Capture amount must be within the deposit.");
  if (b.stripeDepositIntentId && !isMockPayments()) {
    // Capturing less than the authorized amount releases the remainder automatically
    await stripe().paymentIntents.capture(b.stripeDepositIntentId, { amount_to_capture: amountCents });
  }
  const full = amountCents === b.depositCents;
  await prisma.$transaction([
    prisma.booking.update({
      where: { id: b.id },
      data: { depositStatus: full ? "captured" : "partially_captured", depositCapturedCents: amountCents },
    }),
    prisma.payment.create({
      data: {
        bookingId: b.id,
        kind: "deposit_capture",
        amountCents,
        method: b.stripeDepositIntentId ? "card" : "mock",
        stripeId: b.stripeDepositIntentId,
        note: reason,
        createdBy: actor,
      },
    }),
  ]);
  await logEvent(
    b.id,
    "deposit_captured",
    `Captured $${(amountCents / 100).toFixed(2)} of deposit${full ? "" : " (remainder released)"}: ${reason}`,
    actor,
  );
}

export async function refundPayment(bookingId: string, amountCents: number, reason: string, actor: string) {
  const b = await loadBooking(bookingId);
  const refundable = b.paidCents - b.refundedCents;
  if (amountCents <= 0 || amountCents > refundable) throw new Error(`You can refund up to $${(refundable / 100).toFixed(2)}.`);
  let stripeId: string | null = null;
  if (b.stripePaymentIntentId && !isMockPayments()) {
    const r = await stripe().refunds.create({
      payment_intent: b.stripePaymentIntentId,
      amount: amountCents,
      metadata: { bookingId: b.id, reason },
    });
    stripeId = r.id;
  }
  const refunded = b.refundedCents + amountCents;
  await prisma.$transaction([
    prisma.booking.update({
      where: { id: b.id },
      data: { refundedCents: refunded, paymentStatus: refunded >= b.paidCents ? "refunded" : "partially_refunded" },
    }),
    prisma.payment.create({
      data: {
        bookingId: b.id,
        kind: "refund",
        amountCents,
        method: stripeId ? "card" : isMockPayments() ? "mock" : "manual",
        stripeId,
        note: reason,
        createdBy: actor,
      },
    }),
  ]);
  await logEvent(b.id, "refund", `Refunded $${(amountCents / 100).toFixed(2)}: ${reason}`, actor);
}

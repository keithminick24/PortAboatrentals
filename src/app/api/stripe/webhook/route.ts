import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { finalizeCheckoutSession, isMockPayments, stripe } from "@/lib/payments";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/bookings";

export async function POST(req: Request) {
  if (isMockPayments()) return NextResponse.json({ ok: true });
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), sig, secret);
  } catch (e) {
    return NextResponse.json({ error: `Invalid signature: ${(e as Error).message}` }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await finalizeCheckoutSession((event.data.object as Stripe.Checkout.Session).id);
      break;
    case "charge.dispute.created": {
      const d = event.data.object as Stripe.Dispute;
      const pi = typeof d.payment_intent === "string" ? d.payment_intent : d.payment_intent?.id;
      const b = pi
        ? await prisma.booking.findFirst({ where: { OR: [{ stripePaymentIntentId: pi }, { stripeDepositIntentId: pi }] } })
        : null;
      if (b) await logEvent(b.id, "dispute", `Card dispute opened: ${d.reason} ($${(d.amount / 100).toFixed(2)})`, "stripe");
      break;
    }
  }
  return NextResponse.json({ received: true });
}

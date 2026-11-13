import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma, getSettings } from "./db";
import { optKeyword } from "./campaignLogic";

/**
 * Two-way guest texting through Quo (formerly OpenPhone).
 *
 * Outgoing: POST https://api.quo.com/messages from your Quo number (QUO_PHONE_NUMBER_ID, "PN…").
 * Incoming: Quo calls /api/quo/webhook with `message.received`; we match the
 * sender to a customer and their current booking. Texts also stay in the Quo
 * app, so the team can reply from either place.
 *
 * Without QUO_API_KEY the app runs in test mode: messages are saved and shown
 * in the thread but nothing is sent.
 */

const QUO_API = "https://api.quo.com";
const QUO_VERSION = "2026-03-30";

export const isQuoEnabled = () => !!(process.env.QUO_API_KEY && process.env.QUO_PHONE_NUMBER_ID);

/** "361-555-0123" → "+13615550123". Returns null if it can't be a valid number. */
export function toE164(phone: string): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

type SendInput = { to: string; body: string; customerId?: string | null; bookingId?: string | null; sentBy?: string };

export async function sendText(input: SendInput): Promise<{ ok: boolean; error?: string; id?: string }> {
  const phone = toE164(input.to);
  const body = input.body.trim().slice(0, 1600);
  if (!phone) return { ok: false, error: "That phone number doesn't look valid." };
  if (!body) return { ok: false, error: "Message is empty." };
  // Carriers require honoring STOP for every text, including ones staff send by hand.
  if (await isPhoneOptedOut(phone, input.customerId)) return { ok: false, error: "Guest opted out of texts" };

  const msg = await prisma.message.create({
    data: {
      direction: "out",
      phone,
      body,
      status: isQuoEnabled() ? "queued" : "mock",
      customerId: input.customerId ?? null,
      bookingId: input.bookingId ?? null,
      sentBy: input.sentBy ?? null,
    },
  });
  if (!isQuoEnabled()) {
    console.log(`[sms:test-mode] To ${phone}: ${body}`);
    return { ok: true, id: msg.id };
  }
  try {
    const res = await fetch(`${QUO_API}/messages`, {
      method: "POST",
      headers: {
        Authorization: process.env.QUO_API_KEY!,
        "Quo-Api-Version": QUO_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: body, from: process.env.QUO_PHONE_NUMBER_ID, to: [phone] }),
    });
    const data = (await res.json().catch(() => ({}))) as { data?: { id?: string; status?: string }; message?: string };
    if (!res.ok) {
      const error = data.message || `Quo returned ${res.status}`;
      await prisma.message.update({ where: { id: msg.id }, data: { status: "failed", error } });
      return { ok: false, error };
    }
    await prisma.message.update({
      where: { id: msg.id },
      data: { status: data.data?.status ?? "sent", externalId: data.data?.id ?? null },
    });
    return { ok: true, id: msg.id };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Send failed";
    await prisma.message.update({ where: { id: msg.id }, data: { status: "failed", error } });
    return { ok: false, error };
  }
}

/** Every customer whose phone matches this number (last 10 digits). */
async function customersWithPhone(e164: string) {
  const last10 = e164.replace(/\D/g, "").slice(-10);
  if (last10.length < 4) return [];
  const candidates = await prisma.customer.findMany({ where: { phone: { contains: last10.slice(-4) } }, select: { id: true, phone: true, smsOptOut: true }, take: 100 });
  return candidates.filter((c) => c.phone.replace(/\D/g, "").slice(-10) === last10);
}

/** True if this guest replied STOP (by customer id or by any customer with this number). */
export async function isPhoneOptedOut(e164: string, customerId?: string | null): Promise<boolean> {
  if (customerId) {
    const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { smsOptOut: true } });
    if (c?.smsOptOut) return true;
  }
  return (await customersWithPhone(e164)).some((c) => c.smsOptOut);
}

/** Texts the dock alert phone (Settings → Damage alert phone), if set. */
export async function alertCrew(text: string) {
  const s = await getSettings();
  if (s.damageAlertPhone) await sendText({ to: s.damageAlertPhone, body: text, sentBy: "System" });
}

/** Finds the customer whose phone matches (by last 10 digits) and their most relevant booking. */
export async function matchCustomer(e164: string) {
  const last10 = e164.replace(/\D/g, "").slice(-10);
  const candidates = await prisma.customer.findMany({ where: { phone: { contains: last10.slice(-4) } }, take: 50 });
  const customer = candidates.find((c) => c.phone.replace(/\D/g, "").slice(-10) === last10) ?? null;
  if (!customer) return { customer: null, booking: null };
  const now = new Date();
  const booking =
    (await prisma.booking.findFirst({
      where: { customerId: customer.id, status: { in: ["confirmed", "pending", "checked_out", "returned"] }, endsAt: { gte: new Date(now.getTime() - 2 * 86400000) } },
      orderBy: { startsAt: "asc" },
    })) ?? (await prisma.booking.findFirst({ where: { customerId: customer.id }, orderBy: { startsAt: "desc" } }));
  return { customer, booking };
}

/** Verifies Quo's webhook signature (Standard Webhooks format: HMAC-SHA256 over "id.timestamp.body"). */
export function verifyQuoSignature(rawBody: string, headers: Headers): boolean {
  const secret = process.env.QUO_WEBHOOK_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production"; // allow unsigned only in dev
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sigHeader = headers.get("webhook-signature");
  if (!id || !ts || !sigHeader) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest();
  return sigHeader.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

type QuoEvent = {
  id?: string;
  type?: string;
  data?: {
    resource?: { id?: string; text?: string; status?: string; media?: { url: string; type?: string | null }[] };
    context?: { senderIdentifier?: string; phoneNumberId?: string };
  };
};

/** Saves an incoming text from the Quo webhook. Idempotent on the Quo message id. */
export async function handleQuoEvent(evt: QuoEvent) {
  if (evt.type?.startsWith("call.")) return (await import("./phoneOrders")).handlePhoneCallEvent(evt);
  const r = evt.data?.resource;
  if (!r?.id) return;
  if (evt.type === "message.received") {
    const from = toE164(evt.data?.context?.senderIdentifier ?? "") ?? evt.data?.context?.senderIdentifier ?? "";
    if (await prisma.message.findUnique({ where: { externalId: r.id } })) return;
    const { customer, booking } = await matchCustomer(from);
    // STOP / START keywords (carrier rules): update text consent for this number
    const kw = optKeyword(r.text ?? "");
    if (kw && customer) {
      const ids = (await customersWithPhone(from)).map((c) => c.id);
      await prisma.customer.updateMany({ where: { id: { in: ids } }, data: { smsOptOut: kw === "stop" } });
    }
    const media = (r.media ?? []).map((m) => m.url).join("\n");
    await prisma.message.create({
      data: {
        direction: "in",
        phone: from,
        body: [r.text ?? "", media].filter(Boolean).join("\n"),
        status: "received",
        externalId: r.id,
        customerId: customer?.id ?? null,
        bookingId: booking?.id ?? null,
      },
    });
  } else if (["message.delivered", "message.failed", "message.undelivered"].includes(evt.type ?? "")) {
    await prisma.message.updateMany({ where: { externalId: r.id }, data: { status: evt.type!.split(".")[1] } });
  }
}

/** Ready-made texts staff can send with one tap. */
export function templates(b: { code: string; boatName: string; when: string; manageUrl: string; waiverUrl: string; firstName: string }, business: string) {
  return [
    { key: "waiver", label: "Guest waiver link", body: `Hi ${b.firstName}! Please forward this to everyone coming on the boat so they can sign the passenger waiver before your trip: ${b.waiverUrl}` },
    { key: "sign", label: "Sign & pay link", body: `Hi ${b.firstName}, here's your ${business} booking (${b.code}) for ${b.when}. Please sign the rental agreement and finish payment here: ${b.manageUrl}` },
    { key: "reminder", label: "Trip reminder", body: `Hi ${b.firstName}, see you soon! ${b.boatName} is reserved for ${b.when}. Please arrive 20 minutes early with your photo ID and boater-ed card. Details: ${b.manageUrl}` },
    { key: "ready", label: "Boat is ready", body: `Hi ${b.firstName}, your boat is ready at the dock! Come on down whenever you're ready.` },
    { key: "return", label: "Time to head back", body: `Hi ${b.firstName}, friendly reminder your trip ends soon. Please start heading back to the dock so you're in on time. Thanks!` },
  ];
}

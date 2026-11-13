import "server-only";
import { prisma, getSettings } from "./db";
import { appUrl, emailLayout, sendMail } from "./mail";
import { sendText, toE164 } from "./messaging";
import { fmtDate, fmtTime } from "./time";
import { secureToken } from "./ids";
import {
  channelsFor,
  consentBlock,
  inAfterBookingWindow,
  inAfterTripWindow,
  inBeforeTripWindow,
  inWinBackWindow,
  matchesSegment,
  parseSegment,
  renderTemplate,
  reviewLinkFrom,
  textToHtml,
  type MergeData,
  type Segment,
} from "./campaignLogic";
import type { Booking, Boat, Campaign, Customer, Settings } from "@prisma/client";

/**
 * CRM campaigns: automated texts/emails around each trip, plus one-off
 * promotions (broadcasts). Every send, skip and failure is logged in
 * CampaignSend, and its unique dedupeKey makes sure nobody gets the same
 * automation twice for the same trip.
 *
 * Consent: promotional campaigns (isMarketing) only go to guests who opted in.
 * Texts never go to anyone who replied STOP; emails never go to anyone who
 * unsubscribed.
 */

const H = 3600000;
const D = 24 * H;
const DONE = ["returned", "completed"];
const LIVE = ["pending", "confirmed", "checked_out"];

type BookingCtx = Booking & { boat: Boat; customer: Customer };

/** Merge-tag values for a customer (and their booking, if any). Links are absolute. */
export async function mergeDataFor(customer: Customer, booking: (Booking & { boat: Boat }) | null, settings: Settings): Promise<MergeData> {
  let waiverReminder = "";
  if (booking) {
    const passengers = await prisma.signature.count({ where: { bookingId: booking.id, isPrimary: false } });
    if (booking.partySize > 1 && passengers < booking.partySize - 1) {
      waiverReminder = `Guests who haven't signed the waiver can do it here: ${await appUrl(`/w/${booking.waiverToken}`)}`;
    }
  }
  return {
    firstName: customer.firstName,
    lastName: customer.lastName,
    boat: booking?.boat.name ?? "",
    date: booking ? fmtDate(booking.startsAt) : "",
    time: booking ? fmtTime(booking.startsAt) : "",
    manageLink: booking ? await appUrl(`/b/${booking.accessToken}`) : "",
    waiverLink: booking ? await appUrl(`/w/${booking.waiverToken}`) : "",
    waiverReminder,
    reviewLink: reviewLinkFrom(settings),
    tipLink: booking ? await appUrl(`/t/${booking.accessToken}`) : "",
    bookLink: await appUrl("/book"),
    address: settings.address,
    business: settings.businessName,
  };
}

async function ensureUnsubToken(customer: Customer): Promise<string> {
  if (customer.unsubToken) return customer.unsubToken;
  const token = secureToken(18);
  await prisma.customer.update({ where: { id: customer.id }, data: { unsubToken: token } });
  customer.unsubToken = token;
  return token;
}

/** Email HTML: branded layout + an unsubscribe link at the bottom. */
export async function campaignEmailHtml(subject: string, text: string, unsubUrl: string | null) {
  const footer = unsubUrl
    ? `<p style="margin-top:24px;font-size:12px;color:#6b7280">Don't want these emails? <a href="${unsubUrl}" style="color:#6b7280">Unsubscribe</a>.</p>`
    : "";
  return emailLayout(subject, textToHtml(text) + footer);
}

type Outcome = "sent" | "skipped" | "failed";

/**
 * Sends one campaign message on one channel to one customer and logs it.
 * Returns null if this dedupeKey was already handled.
 */
async function deliver(opts: {
  campaign: Campaign;
  customer: Customer;
  booking: (Booking & { boat: Boat }) | null;
  channel: "sms" | "email";
  dedupeKey: string;
  settings: Settings;
  actor: string;
}): Promise<Outcome | null> {
  const { campaign, customer, booking, channel, dedupeKey, settings } = opts;
  if (await prisma.campaignSend.findUnique({ where: { dedupeKey } })) return null;

  const log = async (status: Outcome, error?: string) => {
    try {
      await prisma.campaignSend.create({
        data: { campaignId: campaign.id, customerId: customer.id, bookingId: booking?.id ?? null, channel, status, error: error ?? null, dedupeKey },
      });
    } catch {
      return null; // another run logged it first
    }
    return status;
  };

  const blocked = consentBlock(customer, channel, campaign.isMarketing, !!toE164(customer.phone));
  if (blocked) return log("skipped", blocked);

  const data = await mergeDataFor(customer, booking, settings);
  if (/\{\{\s*reviewLink\s*\}\}/.test(campaign.body) && !data.reviewLink) return log("skipped", "No review link yet (add it on the Reviews page)");
  const text = renderTemplate(campaign.body, data);
  if (!text) return log("skipped", "Message is empty");

  if (channel === "sms") {
    const r = await sendText({ to: customer.phone, body: text, customerId: customer.id, bookingId: booking?.id ?? null, sentBy: opts.actor });
    return r.ok ? log("sent") : log("failed", r.error);
  }
  try {
    const subject = renderTemplate(campaign.subject || campaign.name, data);
    const unsub = await appUrl(`/u/${await ensureUnsubToken(customer)}`);
    await sendMail({ to: customer.email, subject, html: await campaignEmailHtml(subject, text, unsub), text: `${text}\n\nUnsubscribe: ${unsub}` });
    return log("sent");
  } catch (e) {
    return log("failed", e instanceof Error ? e.message : "Email failed");
  }
}

export type RunCounts = { sent: number; skipped: number; failed: number };

function tally(counts: RunCounts, o: Outcome | null) {
  if (o) counts[o]++;
}

/** Runs every active automation. Called by the scheduled job (/api/cron). */
export async function runAutomations(now: Date): Promise<RunCounts> {
  const counts: RunCounts = { sent: 0, skipped: 0, failed: 0 };
  const campaigns = await prisma.campaign.findMany({ where: { kind: "automation", active: true, trigger: { not: "manual" } } });
  if (!campaigns.length) return counts;
  const settings = await getSettings();

  for (const c of campaigns) {
    const off = Math.max(0, c.offsetHours);
    let targets: { booking: BookingCtx; key: string }[] = [];

    if (c.trigger === "before_trip") {
      const list = await prisma.booking.findMany({
        where: { status: "confirmed", startsAt: { gt: now, lte: new Date(now.getTime() + off * H) } },
        include: { boat: true, customer: true },
      });
      targets = list.filter((b) => inBeforeTripWindow(b.startsAt, off, now)).map((b) => ({ booking: b, key: b.id }));
    } else if (c.trigger === "after_trip") {
      const list = await prisma.booking.findMany({
        where: { status: { in: DONE }, endsAt: { lte: new Date(now.getTime() - off * H), gt: new Date(now.getTime() - (off + 48) * H) } },
        include: { boat: true, customer: true },
      });
      targets = list.filter((b) => inAfterTripWindow(b.endsAt, off, now)).map((b) => ({ booking: b, key: b.id }));
    } else if (c.trigger === "after_booking") {
      const list = await prisma.booking.findMany({
        where: {
          status: { in: ["confirmed", "checked_out", ...DONE] },
          createdAt: { lte: new Date(now.getTime() - off * H), gt: new Date(now.getTime() - (off + 48) * H) },
        },
        include: { boat: true, customer: true },
      });
      targets = list.filter((b) => inAfterBookingWindow(b.createdAt, off, now)).map((b) => ({ booking: b, key: b.id }));
    } else if (c.trigger === "win_back") {
      const days = Math.round(off / 24);
      const from = new Date(now.getTime() - (days + 7) * D);
      const to = new Date(now.getTime() - days * D);
      const candidates = await prisma.booking.findMany({
        where: { status: { in: DONE }, endsAt: { gt: from, lte: to } },
        include: { boat: true, customer: true },
        orderBy: { endsAt: "desc" },
      });
      const seen = new Set<string>();
      for (const b of candidates) {
        if (seen.has(b.customerId)) continue;
        seen.add(b.customerId);
        // Must be their most recent trip, and nothing booked ahead
        const later = await prisma.booking.count({
          where: {
            customerId: b.customerId,
            OR: [
              { status: { in: DONE }, endsAt: { gt: b.endsAt } },
              { status: { in: LIVE }, startsAt: { gt: now } },
            ],
          },
        });
        if (later || !inWinBackWindow(b.endsAt, off, now)) continue;
        targets.push({ booking: b, key: `${b.customerId}:${b.id}` });
      }
    }

    for (const t of targets) {
      for (const ch of channelsFor(c.channel)) {
        tally(
          counts,
          await deliver({ campaign: c, customer: t.booking.customer, booking: t.booking, channel: ch, dedupeKey: `${c.id}:${t.key}:${ch}`, settings, actor: "Auto" }),
        );
      }
    }
  }
  return counts;
}

// ---------------------------------------------------------------- broadcasts

async function segmentCustomers(seg: Segment, isMarketing: boolean, now = new Date()) {
  const customers = await prisma.customer.findMany({
    where: isMarketing ? { marketingOptIn: true } : {},
    include: { bookings: { select: { id: true, status: true, startsAt: true, endsAt: true } } },
  });
  return customers.filter((c) => matchesSegment({ tags: c.tags, trips: c.bookings }, seg, now));
}

/** How many customers a broadcast would reach (before per-channel opt-outs). */
export async function audienceCount(segment: Segment | string, isMarketing: boolean): Promise<number> {
  const seg = typeof segment === "string" ? parseSegment(segment) : segment;
  return (await segmentCustomers(seg, isMarketing)).length;
}

/** Sends a broadcast campaign now. Safe to run twice: each person gets it once per channel. */
export async function sendBroadcast(campaignId: string, actor: string): Promise<RunCounts & { audience: number }> {
  const c = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!c) throw new Error("Campaign not found");
  const settings = await getSettings();
  const now = new Date();
  const people = await segmentCustomers(parseSegment(c.segment), c.isMarketing, now);
  const counts: RunCounts = { sent: 0, skipped: 0, failed: 0 };
  for (const p of people) {
    // Use their next trip if they have one, else their last, for {{boat}} / {{date}}
    const next = p.bookings.filter((b) => LIVE.includes(b.status) && b.startsAt > now).sort((a, b) => +a.startsAt - +b.startsAt)[0];
    const last = p.bookings.filter((b) => DONE.includes(b.status)).sort((a, b) => +b.endsAt - +a.endsAt)[0];
    const pick = next ?? last;
    const booking = pick ? await prisma.booking.findUnique({ where: { id: pick.id }, include: { boat: true } }) : null;
    for (const ch of channelsFor(c.channel)) {
      tally(counts, await deliver({ campaign: c, customer: p, booking, channel: ch, dedupeKey: `${c.id}:${p.id}:${ch}`, settings, actor }));
    }
  }
  await prisma.campaign.update({ where: { id: c.id }, data: { sentAt: now } });
  return { ...counts, audience: people.length };
}

// ---------------------------------------------------------------- previews & tests

/** A real recent booking to preview with (falls back to made-up details). */
export async function sampleMergeData(): Promise<MergeData> {
  const settings = await getSettings();
  const b = await prisma.booking.findFirst({
    where: { status: { notIn: ["cancelled"] } },
    orderBy: { startsAt: "desc" },
    include: { boat: true, customer: true },
  });
  if (b) return mergeDataFor(b.customer, b, settings);
  const start = new Date(Date.now() + 2 * D);
  return {
    firstName: "Jamie",
    lastName: "Rivera",
    boat: "Tritoon 1",
    date: fmtDate(start),
    time: fmtTime(start),
    manageLink: await appUrl("/b/sample"),
    waiverLink: await appUrl("/w/sample"),
    waiverReminder: `Guests who haven't signed the waiver can do it here: ${await appUrl("/w/sample")}`,
    reviewLink: reviewLinkFrom(settings),
    tipLink: await appUrl("/t/sample"),
    bookLink: await appUrl("/book"),
    address: settings.address,
    business: settings.businessName,
  };
}

/** Sends a sample of this campaign to a phone and/or email the staff member typed in. Not logged as a campaign send. */
export async function sendTest(c: Pick<Campaign, "name" | "subject" | "body" | "channel">, to: { phone?: string; email?: string }, actor: string) {
  const data = await sampleMergeData();
  const text = renderTemplate(c.body, data);
  const done: string[] = [];
  const errors: string[] = [];
  const chans = channelsFor(c.channel);
  if (chans.includes("sms") && to.phone) {
    const r = await sendText({ to: to.phone, body: `[TEST] ${text}`, sentBy: actor });
    if (r.ok) done.push("text");
    else errors.push(r.error ?? "Text failed");
  }
  if (chans.includes("email") && to.email) {
    const subject = `[TEST] ${renderTemplate(c.subject || c.name, data)}`;
    await sendMail({ to: to.email, subject, html: await campaignEmailHtml(subject, text, await appUrl("/u/sample")), text });
    done.push("email");
  }
  return { done, errors };
}

// ---------------------------------------------------------------- starter campaigns

const STARTERS = [
  {
    name: "Pre-arrival",
    trigger: "before_trip",
    offsetHours: 48,
    channel: "email",
    subject: "Your boat day is almost here, {{firstName}}!",
    isMarketing: false,
    active: true,
    body: `Hi {{firstName}},

We can't wait to see you on {{date}} at {{time}} for your trip on {{boat}}!

Please arrive 20 minutes early so we can do a quick safety briefing and get you out on time.

Where to meet us: {{address}}. Park in the marked spots and come to the dock office.

What to bring:
- Photo ID and your Texas boater-ed card (if born on or after Sept 1, 1993)
- Sunscreen, hats and sunglasses
- Towels and a change of clothes
- Snacks and drinks (no glass bottles, please)

Everyone coming along should sign the passenger waiver before you arrive. Share this link with your group: {{waiverLink}}

Your booking: {{manageLink}}

See you soon!
{{business}}`,
  },
  {
    name: "Day-of text",
    trigger: "before_trip",
    offsetHours: 3,
    channel: "sms",
    subject: "",
    isMarketing: false,
    active: true,
    body: `Hi {{firstName}}! {{boat}} will be ready for you soon. See you at {{time}}. {{waiverReminder}}`,
  },
  {
    name: "Thank you + review",
    trigger: "after_trip",
    offsetHours: 2,
    channel: "sms",
    subject: "",
    isMarketing: false,
    active: true,
    body: `Thanks for boating with {{business}}, {{firstName}}! We'd love a quick review: {{reviewLink}}
If your crew made your day, you can leave them a tip here: {{tipLink}}`,
  },
  {
    name: "Win-back",
    trigger: "win_back",
    offsetHours: 300 * 24,
    channel: "email",
    subject: "Ready for another day on the water, {{firstName}}?",
    isMarketing: true,
    active: false,
    body: `Hi {{firstName}},

It's been a while since your trip on {{boat}}! The water is calling, and we'd love to have you back.

Pick your day here: {{bookLink}}

See you soon,
{{business}}`,
  },
] as const;

/** Creates the starter automations if they don't exist yet (matched by name). Safe to run any number of times. */
export async function seedCampaigns() {
  let created = 0;
  for (const s of STARTERS) {
    const exists = await prisma.campaign.findFirst({ where: { name: s.name, kind: "automation" } });
    if (exists) continue;
    await prisma.campaign.create({ data: { ...s, kind: "automation", segment: "{}" } });
    created++;
  }
  return created;
}

import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma, getSettings } from "./db";
import { ACTIVE_STATUSES } from "./constants";
import { availableStartTimes, isFree, peakUsage, type Interval } from "./availability";
import { computeQuote, isWeekendDay, type FeeDef } from "./pricing";
import { addDays, fmtRange, localDate, weekdayOf, zonedToUtc } from "./time";
import { bookingCode, secureToken } from "./ids";
import { appUrl, emailLayout, sendMail } from "./mail";
import { fmtMoney } from "./money";

type Tx = Prisma.TransactionClient;

/** Where-clause for bookings that currently occupy a boat's time. */
export function occupyingWhere(now = new Date()): Prisma.BookingWhereInput {
  return {
    OR: [
      { status: { in: ACTIVE_STATUSES.filter((s) => s !== "pending") } },
      { status: "pending", holdExpiresAt: { gt: now } },
      { status: "pending", holdExpiresAt: null },
    ],
  };
}

export async function logEvent(bookingId: string, type: string, message: string, actor?: string | null, tx?: Tx) {
  await (tx ?? prisma).bookingEvent.create({ data: { bookingId, type, message, actor: actor ?? null } });
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export type BoatAvailability = {
  boatId: string;
  name: string;
  slug: string;
  type: string;
  capacity: number;
  description: string;
  imageUrl: string | null;
  depositCents: number;
  rates: {
    id: string;
    label: string;
    minutes: number;
    priceCents: number;
    startTimes: string[];
  }[];
};

export async function getAvailabilityForDate(date: string, opts: { partySize?: number; ignoreNotice?: boolean } = {}) {
  const settings = await getSettings();
  const dayStart = zonedToUtc(date, "00:00");
  const dayEnd = zonedToUtc(addDays(date, 1), "00:00");
  const now = new Date();
  const earliestStart = opts.ignoreNotice ? new Date(0) : new Date(now.getTime() + settings.minNoticeHours * 3600000);
  const weekend = isWeekendDay(weekdayOf(date), settings.weekendDays);

  const maxDate = addDays(localDate(now), settings.maxAdvanceDays);
  const tooFar = !opts.ignoreNotice && date > maxDate;

  const boats = await prisma.boat.findMany({
    where: { status: "available", ...(opts.partySize ? { capacity: { gte: opts.partySize } } : {}) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      rates: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { minutes: "asc" }] },
      bookings: {
        where: {
          AND: [occupyingWhere(now), { startsAt: { lt: dayEnd } }, { endsAt: { gt: dayStart } }],
        },
        select: { startsAt: true, endsAt: true },
      },
    },
  });
  const blocks = await prisma.boatBlock.findMany({
    where: { startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
  });

  const result: BoatAvailability[] = boats.map((boat) => {
    const boatBlocks = blocks.filter((b) => b.boatId === null || b.boatId === boat.id);
    const intervals: Interval[] = boat.bookings.map((b) => ({ start: b.startsAt, end: b.endsAt }));
    const blockIntervals: Interval[] = boatBlocks.map((b) => ({ start: b.startsAt, end: b.endsAt }));
    return {
      boatId: boat.id,
      name: boat.name,
      slug: boat.slug,
      type: boat.type,
      capacity: boat.capacity,
      description: boat.description,
      imageUrl: boat.imageUrl,
      depositCents: boat.depositCents,
      rates: boat.rates.map((r) => ({
        id: r.id,
        label: r.label,
        minutes: r.minutes,
        priceCents: weekend && r.weekendPriceCents != null ? r.weekendPriceCents : r.priceCents,
        startTimes: tooFar
          ? []
          : availableStartTimes({
              date,
              durationMin: r.minutes,
              openTime: settings.openTime,
              closeTime: settings.closeTime,
              slotIntervalMin: settings.slotIntervalMin,
              bufferMin: settings.bufferMin,
              earliestStart,
              bookings: intervals,
              blocks: blockIntervals,
            }),
      })),
    };
  });
  return { date, weekend, boats: result };
}

// ---------------------------------------------------------------------------
// Create booking
// ---------------------------------------------------------------------------

export type CreateBookingInput = {
  boatId: string;
  rateId: string;
  date: string;
  startTime: string;
  partySize: number;
  customer: { firstName: string; lastName: string; email: string; phone: string };
  addOns: { addOnId: string; quantity: number }[];
  customerNotes?: string;
  source?: "online" | "admin" | "phone";
  actor?: string;
  /** Staff can override min-notice / opening hours. Overlap checks always apply. */
  staffOverride?: boolean;
  /** Card convenience fee applies unless false (e.g. staff bookings paid in cash). */
  convenienceFee?: boolean;
  /** Optional crew tip chosen at booking (not taxed, no convenience fee). */
  tipCents?: number;
  /** Customer agreed to promotional texts/emails. Only ever turns consent ON. */
  marketingOptIn?: boolean;
};

/** Active mandatory fees in the shape the pricing engine expects. */
export async function activeFees(): Promise<FeeDef[]> {
  const fees = await prisma.fee.findMany({ where: { active: true }, include: { tiers: true }, orderBy: { sortOrder: "asc" } });
  return fees.map((f) => ({
    id: f.id,
    name: f.name,
    mode: f.mode,
    calc: f.calc,
    percentBps: f.percentBps,
    taxable: f.taxable,
    tiers: f.tiers.map((t) => ({ minMinutes: t.minMinutes, amountCents: t.amountCents })),
  }));
}

export function convenienceSettings(s: { convenienceFeeBps: number; convenienceFeeCents: number }) {
  return s.convenienceFeeBps > 0 || s.convenienceFeeCents > 0 ? { bps: s.convenienceFeeBps, cents: s.convenienceFeeCents } : null;
}

export class BookingError extends Error {}

export async function createBooking(input: CreateBookingInput) {
  const settings = await getSettings();
  const rate = await prisma.rate.findUnique({ where: { id: input.rateId }, include: { boat: true } });
  if (!rate || rate.boatId !== input.boatId || !rate.active) throw new BookingError("That rental option is no longer available.");
  if (rate.boat.status !== "available") throw new BookingError("That boat isn't available for booking.");
  if (input.partySize > rate.boat.capacity) {
    throw new BookingError(`${rate.boat.name} holds up to ${rate.boat.capacity} people.`);
  }

  const startsAt = zonedToUtc(input.date, input.startTime);
  const endsAt = new Date(startsAt.getTime() + rate.minutes * 60000);

  if (!input.staffOverride) {
    const avail = await getAvailabilityForDate(input.date);
    const boat = avail.boats.find((b) => b.boatId === input.boatId);
    const r = boat?.rates.find((x) => x.id === input.rateId);
    if (!r || !r.startTimes.includes(input.startTime)) {
      throw new BookingError("Sorry, that time was just taken. Please pick another time.");
    }
  }

  const addOnIds = input.addOns.filter((a) => a.quantity > 0).map((a) => a.addOnId);
  const addOns = await prisma.addOn.findMany({ where: { id: { in: addOnIds }, active: true } });
  const chosen = input.addOns
    .filter((a) => a.quantity > 0)
    .map((a) => {
      const def = addOns.find((x) => x.id === a.addOnId);
      if (!def) throw new BookingError("One of the selected extras is no longer available.");
      return { def, quantity: Math.min(a.quantity, def.quantity) };
    });

  const isWeekend = isWeekendDay(weekdayOf(input.date), settings.weekendDays);
  const fees = await activeFees();
  const { feeLines, ...quote } = computeQuote({
    rentalCents: isWeekend && rate.weekendPriceCents != null ? rate.weekendPriceCents : rate.priceCents,
    minutes: rate.minutes,
    addOns: chosen.map((c) => ({ priceCents: c.def.priceCents, quantity: c.quantity })),
    fees,
    taxRateBps: settings.taxRateBps,
    convenience: input.convenienceFee === false ? null : convenienceSettings(settings),
  });

  const email = input.customer.email.toLowerCase().trim();
  const now = new Date();

  // Serializable-ish: re-check overlap inside the transaction right before insert.
  const booking = await prisma.$transaction(async (tx) => {
    const overlapping = await tx.booking.findMany({
      where: {
        AND: [
          occupyingWhere(now),
          { boatId: input.boatId },
          { startsAt: { lt: new Date(endsAt.getTime() + settings.bufferMin * 60000) } },
          { endsAt: { gt: new Date(startsAt.getTime() - settings.bufferMin * 60000) } },
        ],
      },
      select: { startsAt: true, endsAt: true },
    });
    const blocks = await tx.boatBlock.findMany({
      where: { OR: [{ boatId: null }, { boatId: input.boatId }], startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    });
    if (
      !isFree(
        { start: startsAt, end: endsAt },
        overlapping.map((b) => ({ start: b.startsAt, end: b.endsAt })),
        blocks.map((b) => ({ start: b.startsAt, end: b.endsAt })),
        settings.bufferMin,
      )
    ) {
      throw new BookingError("Sorry, that time was just taken. Please pick another time.");
    }

    // Add-on inventory
    for (const c of chosen) {
      const uses = await tx.bookingAddOn.findMany({
        where: {
          addOnId: c.def.id,
          booking: { AND: [occupyingWhere(now), { startsAt: { lt: endsAt } }, { endsAt: { gt: startsAt } }] },
        },
        include: { booking: { select: { startsAt: true, endsAt: true } } },
      });
      const peak = peakUsage(
        { start: startsAt, end: endsAt },
        uses.map((u) => ({ start: u.booking.startsAt, end: u.booking.endsAt, quantity: u.quantity })),
      );
      if (peak + c.quantity > c.def.quantity) {
        const left = Math.max(0, c.def.quantity - peak);
        throw new BookingError(`Only ${left} ${c.def.name} available at that time.`);
      }
    }

    const customer = await tx.customer.upsert({
      where: { email },
      update: {
        ...(input.marketingOptIn ? { marketingOptIn: true } : {}),
        firstName: input.customer.firstName.trim(),
        lastName: input.customer.lastName.trim(),
        phone: input.customer.phone.trim(),
      },
      create: {
        email,
        marketingOptIn: !!input.marketingOptIn,
        firstName: input.customer.firstName.trim(),
        lastName: input.customer.lastName.trim(),
        phone: input.customer.phone.trim(),
      },
    });

    const created = await tx.booking.create({
      data: {
        code: bookingCode(),
        accessToken: secureToken(),
        waiverToken: secureToken(12),
        boatId: input.boatId,
        rateId: rate.id,
        customerId: customer.id,
        startsAt,
        endsAt,
        partySize: input.partySize,
        status: "pending",
        holdExpiresAt:
          input.source === "online" || !input.source
            ? new Date(now.getTime() + settings.holdMinutes * 60000)
            : null,
        source: input.source ?? "online",
        subtotalCents: quote.subtotalCents,
        addOnsCents: quote.addOnsCents,
        feesCents: quote.feesCents,
        includedFeesCents: quote.includedCents,
        taxCents: quote.taxCents,
        convenienceFeeCents: quote.convenienceFeeCents,
        tipCents: Math.max(0, Math.round(input.tipCents ?? 0)),
        totalCents: quote.totalCents + Math.max(0, Math.round(input.tipCents ?? 0)),
        fees: {
          create: feeLines.map((l) => ({ feeId: l.feeId, name: l.name, mode: l.mode, amountCents: l.amountCents, taxable: l.taxable })),
        },
        depositCents: rate.boat.depositCents,
        customerNotes: input.customerNotes?.slice(0, 2000) ?? "",
        addOns: {
          create: chosen.map((c) => ({ addOnId: c.def.id, quantity: c.quantity, priceCents: c.def.priceCents })),
        },
      },
    });
    await logEvent(
      created.id,
      "created",
      `Booking created (${input.source ?? "online"}) for ${fmtRange(startsAt, endsAt)}`,
      input.actor ?? `${customer.firstName} ${customer.lastName}`,
      tx,
    );
    return created;
  });

  return booking;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function bookingWithAll(where: Prisma.BookingWhereUniqueInput) {
  return prisma.booking.findUnique({
    where,
    include: {
      boat: true,
      rate: true,
      customer: true,
      addOns: { include: { addOn: true } },
      fees: true,
      damage: { orderBy: { createdAt: "asc" } },
      signatures: { include: { template: true }, orderBy: { signedAt: "asc" } },
      photos: { orderBy: { createdAt: "asc" } },
      payments: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "desc" } },
    },
  });
}

export type FullBooking = NonNullable<Awaited<ReturnType<typeof bookingWithAll>>>;

export async function activeTemplates() {
  // Latest active version of each named template
  const all = await prisma.contractTemplate.findMany({ where: { active: true }, orderBy: { version: "desc" } });
  const seen = new Set<string>();
  return all.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)));
}

/** Which required contracts still need the primary renter's signature. */
export async function missingPrimarySignatures(bookingId: string) {
  const [templates, sigs] = await Promise.all([
    activeTemplates(),
    prisma.signature.findMany({ where: { bookingId, isPrimary: true }, select: { templateId: true, template: true } }),
  ]);
  return templates.filter((t) => t.required && !sigs.some((s) => s.template.name === t.name));
}

export async function onBookingConfirmed(bookingId: string) {
  const b = await bookingWithAll({ id: bookingId });
  if (!b) return;
  const settings = await getSettings();
  await logEvent(b.id, "confirmed", "Booking confirmed", "system");
  // Tip chosen at booking becomes a Tip record for the crew once paid
  if (b.tipCents > 0 && !(await prisma.tip.findFirst({ where: { bookingId: b.id, source: "booking" } }))) {
    const charge = b.payments.find((p) => p.kind === "charge");
    await prisma.tip.create({
      data: { bookingId: b.id, amountCents: b.tipCents, method: charge?.method === "mock" ? "mock" : "card", source: "booking", stripeId: charge?.stripeId ?? null },
    });
  }
  const link = await appUrl(`/b/${b.accessToken}`);
  const waiver = await appUrl(`/w/${b.waiverToken}`);
  await sendMail({
    to: b.customer.email,
    subject: `You're booked! ${b.boat.name} · ${fmtRange(b.startsAt, b.endsAt)}`,
    html: emailLayout(
      "Your boat is reserved",
      `<p>Hi ${b.customer.firstName},</p>
<p>Thanks for booking with us. Here are your details:</p>
<p><b>${b.boat.name}</b> – ${b.rate?.label ?? ""}<br>${fmtRange(b.startsAt, b.endsAt)}<br>Confirmation: <b>${b.code}</b><br>Total paid: ${fmtMoney(b.paidCents)}</p>
<p>A refundable security deposit of <b>${fmtMoney(b.depositCents)}</b> will be authorized on your card shortly before your trip and released after the boat is returned in good condition.</p>
<p>${settings.confirmationNote}</p>
<p><a href="${link}" style="background:#C62828;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">View your booking</a></p>
<p>Bringing guests? Forward them this link so each can sign the passenger waiver ahead of time:<br><a href="${waiver}">${waiver}</a></p>`,
    ),
  });
  if (settings.smsOnConfirm) {
    const { sendText } = await import("./messaging");
    await sendText({
      to: b.customer.phone,
      customerId: b.customerId,
      bookingId: b.id,
      sentBy: "Auto",
      body: `${settings.businessName}: you're booked! ${b.boat.name}, ${fmtRange(b.startsAt, b.endsAt)} (#${b.code}). Every guest needs to sign the waiver before the trip, so please forward them this link: ${waiver}  Reply to this text anytime with questions.`,
    });
  }
  const staff = process.env.STAFF_NOTIFY_EMAIL;
  if (staff) {
    await sendMail({
      to: staff,
      subject: `New booking ${b.code}: ${b.boat.name} ${fmtRange(b.startsAt, b.endsAt)}`,
      html: emailLayout(
        "New booking",
        `<p>${b.customer.firstName} ${b.customer.lastName} (${b.customer.phone}) · party of ${b.partySize}</p>
<p>${b.boat.name} – ${b.rate?.label ?? ""}<br>${fmtRange(b.startsAt, b.endsAt)}<br>${fmtMoney(b.totalCents)}</p>
<p><a href="${await appUrl(`/admin/bookings/${b.id}`)}">Open in admin</a></p>`,
      ),
    });
  }
}

export async function setStatus(bookingId: string, status: string, actor: string, extra: Prisma.BookingUpdateInput = {}) {
  await prisma.booking.update({ where: { id: bookingId }, data: { status, ...extra } });
  await logEvent(bookingId, `status_${status}`, `Status changed to ${status.replace("_", " ")}`, actor);
}

/** Releases pending bookings whose hold expired (keeps record, frees the slot). */
export async function expireStaleHolds() {
  const stale = await prisma.booking.findMany({
    where: { status: "pending", holdExpiresAt: { lt: new Date() }, paidCents: 0 },
    select: { id: true },
  });
  for (const b of stale) {
    await prisma.booking.update({ where: { id: b.id }, data: { status: "cancelled" } });
    await logEvent(b.id, "expired", "Unpaid booking expired and the boat was released", "system");
  }
  return stale.length;
}

export function canCustomerCancel(b: { startsAt: Date; status: string }, cancelWindowHours: number) {
  return (
    ["pending", "confirmed"].includes(b.status) && b.startsAt.getTime() - Date.now() >= cancelWindowHours * 3600000
  );
}

/** For a pending booking whose hold lapsed: is its slot still free of other bookings/blocks? */
export async function isSlotStillFree(bookingId: string): Promise<boolean> {
  const settings = await getSettings();
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const pad = settings.bufferMin * 60000;
  const others = await prisma.booking.findMany({
    where: {
      AND: [
        occupyingWhere(),
        { id: { not: b.id }, boatId: b.boatId },
        { startsAt: { lt: new Date(b.endsAt.getTime() + pad) } },
        { endsAt: { gt: new Date(b.startsAt.getTime() - pad) } },
      ],
    },
    select: { id: true },
  });
  const blocks = await prisma.boatBlock.count({
    where: { OR: [{ boatId: null }, { boatId: b.boatId }], startsAt: { lt: b.endsAt }, endsAt: { gt: b.startsAt } },
  });
  return others.length === 0 && blocks === 0;
}

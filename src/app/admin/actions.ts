"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashPassword, login, logout, requireAdmin, requireRole } from "@/lib/auth";
import { BookingError, createBooking, logEvent, missingPrimarySignatures, onBookingConfirmed, setStatus } from "@/lib/bookings";
import {
  captureDeposit,
  createCheckout,
  placeDepositHold,
  recordRentalPayment,
  refundPayment,
  releaseDeposit,
} from "@/lib/payments";
import { parseMoney } from "@/lib/money";
import { slugify } from "@/lib/ids";
import { zonedToUtc } from "@/lib/time";
import { appUrl, emailLayout, sendMail } from "@/lib/mail";
import { deleteObject } from "@/lib/storage";
import { fmtRange } from "@/lib/time";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === "" ? null : Number(v);
};
const back = (path: string, msg?: string, err?: string) => {
  const q = new URLSearchParams();
  if (msg) q.set("msg", msg);
  if (err) q.set("err", err);
  redirect(`${path}${q.size ? `?${q}` : ""}`);
};

// ---------------------------------------------------------------- auth

export async function loginAction(_prev: { error?: string } | undefined, f: FormData) {
  const ok = await login(str(f, "email"), str(f, "password"));
  if (!ok) return { error: "Incorrect email or password." };
  const next = str(f, "next");
  redirect(next.startsWith("/admin") ? next : "/admin");
}

export async function logoutAction() {
  await logout();
  redirect("/admin/login");
}

// ---------------------------------------------------------------- bookings

export async function adminCreateBooking(f: FormData) {
  const s = await requireAdmin();
  const [boatId, rateId] = str(f, "boatRate").split("|");
  const addOns = [...f.entries()]
    .filter(([k]) => k.startsWith("addon_"))
    .map(([k, v]) => ({ addOnId: k.slice(6), quantity: Number(v) || 0 }));
  let id: string;
  try {
    const b = await createBooking({
      boatId,
      rateId,
      date: str(f, "date"),
      startTime: str(f, "startTime"),
      partySize: Number(str(f, "partySize")) || 1,
      customer: {
        firstName: str(f, "firstName"),
        lastName: str(f, "lastName"),
        email: str(f, "email"),
        phone: str(f, "phone"),
      },
      addOns,
      customerNotes: str(f, "notes"),
      source: "phone",
      actor: s.name,
      staffOverride: true,
    });
    id = b.id;
    const pay = str(f, "payment");
    if (pay === "cash" || pay === "card_terminal") {
      await recordRentalPayment(b.id, b.totalCents, pay === "cash" ? "cash" : "other", null, null, s.name, "Recorded by staff");
    } else if (pay === "link") {
      const full = await prisma.booking.findUniqueOrThrow({ where: { id: b.id }, include: { customer: true, boat: true } });
      await sendMail({
        to: full.customer.email,
        subject: `Complete your boat booking ${full.code}`,
        html: emailLayout(
          "Finish your booking",
          `<p>Hi ${full.customer.firstName}, we've reserved <b>${full.boat.name}</b> for ${fmtRange(full.startsAt, full.endsAt)}.</p>
<p>Please sign the rental agreement and pay to confirm:</p>
<p><a href="${appUrl(`/b/${full.accessToken}`)}" style="background:#1E6286;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Sign & pay</a></p>`,
        ),
      });
      await logEvent(b.id, "link_sent", "Payment link emailed to customer", s.name);
    }
  } catch (e) {
    if (e instanceof BookingError) return back("/admin/bookings/new", undefined, e.message);
    throw e;
  }
  redirect(`/admin/bookings/${id}?msg=Booking+created`);
}

export async function updateBookingStatus(f: FormData) {
  const s = await requireAdmin();
  const id = str(f, "id");
  const status = str(f, "status");
  await setStatus(id, status, s.name);
  revalidatePath(`/admin/bookings/${id}`);
  back(`/admin/bookings/${id}`, "Status updated");
}

export async function checkOutBoat(f: FormData) {
  const s = await requireAdmin();
  const id = str(f, "id");
  const b = await prisma.booking.findUniqueOrThrow({ where: { id }, include: { boat: true } });
  if ((await missingPrimarySignatures(id)).length > 0) {
    return back(`/admin/bookings/${id}`, undefined, "The renter must sign the rental agreement before check-out.");
  }
  if (b.paidCents < b.totalCents) return back(`/admin/bookings/${id}`, undefined, "Collect the balance before check-out.");
  const engineHoursOut = num(f, "engineHoursOut");
  if (str(f, "placeDeposit") === "on" && b.depositStatus !== "held" && b.depositCents > 0) {
    const r = await placeDepositHold(id, s.name);
    if (!r.ok) return back(`/admin/bookings/${id}`, undefined, `Deposit hold failed: ${r.error} — boat NOT checked out.`);
  }
  await prisma.booking.update({
    where: { id },
    data: {
      status: "checked_out",
      checkedOutAt: new Date(),
      checkedOutBy: s.name,
      fuelOut: str(f, "fuelOut") || null,
      engineHoursOut,
    },
  });
  if (engineHoursOut != null) await prisma.boat.update({ where: { id: b.boatId }, data: { engineHours: engineHoursOut } });
  await logEvent(id, "checked_out", `Checked out · fuel ${str(f, "fuelOut") || "?"} · engine ${engineHoursOut ?? "?"} hrs`, s.name);
  back(`/admin/bookings/${id}`, "Boat checked out — have a great trip!");
}

export async function checkInBoat(f: FormData) {
  const s = await requireAdmin();
  const id = str(f, "id");
  const b = await prisma.booking.findUniqueOrThrow({ where: { id } });
  const engineHoursIn = num(f, "engineHoursIn");
  const damage = str(f, "damageNotes");
  await prisma.booking.update({
    where: { id },
    data: {
      status: "returned",
      returnedAt: new Date(),
      returnedBy: s.name,
      fuelIn: str(f, "fuelIn") || null,
      engineHoursIn,
      damageNotes: damage,
    },
  });
  if (engineHoursIn != null) await prisma.boat.update({ where: { id: b.boatId }, data: { engineHours: engineHoursIn } });
  const late = b.endsAt < new Date() ? Math.round((Date.now() - b.endsAt.getTime()) / 60000) : 0;
  await logEvent(
    id,
    "returned",
    `Returned · fuel ${str(f, "fuelIn") || "?"} · engine ${engineHoursIn ?? "?"} hrs${late > 10 ? ` · ${late} min late` : ""}${damage ? ` · damage: ${damage}` : ""}`,
    s.name,
  );
  back(`/admin/bookings/${id}`, "Boat checked in. Review photos, then release or capture the deposit.");
}

export async function completeBooking(f: FormData) {
  const s = await requireAdmin();
  const id = str(f, "id");
  await setStatus(id, "completed", s.name);
  back(`/admin/bookings/${id}`, "Booking completed");
}

export async function placeDepositAction(f: FormData) {
  const s = await requireAdmin();
  const id = str(f, "id");
  const r = await placeDepositHold(id, s.name);
  back(`/admin/bookings/${id}`, r.ok ? "Deposit hold placed" : undefined, r.error);
}

export async function releaseDepositAction(f: FormData) {
  const s = await requireAdmin();
  const id = str(f, "id");
  try {
    await releaseDeposit(id, s.name);
  } catch (e) {
    return back(`/admin/bookings/${id}`, undefined, (e as Error).message);
  }
  back(`/admin/bookings/${id}`, "Deposit released");
}

export async function captureDepositAction(f: FormData) {
  const s = await requireRole("owner", "manager");
  const id = str(f, "id");
  const cents = parseMoney(str(f, "amount"));
  const reason = str(f, "reason");
  if (!cents) return back(`/admin/bookings/${id}`, undefined, "Enter a valid amount");
  if (!reason) return back(`/admin/bookings/${id}`, undefined, "Enter a reason (shown on the record)");
  try {
    await captureDeposit(id, cents, reason, s.name);
  } catch (e) {
    return back(`/admin/bookings/${id}`, undefined, (e as Error).message);
  }
  back(`/admin/bookings/${id}`, "Deposit captured");
}

export async function refundAction(f: FormData) {
  const s = await requireRole("owner", "manager");
  const id = str(f, "id");
  const cents = parseMoney(str(f, "amount"));
  if (!cents) return back(`/admin/bookings/${id}`, undefined, "Enter a valid amount");
  try {
    await refundPayment(id, cents, str(f, "reason") || "Refund", s.name);
  } catch (e) {
    return back(`/admin/bookings/${id}`, undefined, (e as Error).message);
  }
  back(`/admin/bookings/${id}`, "Refund issued");
}

export async function recordPaymentAction(f: FormData) {
  const s = await requireAdmin();
  const id = str(f, "id");
  const cents = parseMoney(str(f, "amount"));
  if (!cents) return back(`/admin/bookings/${id}`, undefined, "Enter a valid amount");
  await recordRentalPayment(id, cents, str(f, "method") || "cash", null, null, s.name, str(f, "note"));
  back(`/admin/bookings/${id}`, "Payment recorded");
}

export async function sendPaymentLinkAction(f: FormData) {
  const s = await requireAdmin();
  const id = str(f, "id");
  const b = await prisma.booking.findUniqueOrThrow({ where: { id }, include: { customer: true, boat: true } });
  await sendMail({
    to: b.customer.email,
    subject: `Your boat booking ${b.code}`,
    html: emailLayout(
      "Your booking",
      `<p>Hi ${b.customer.firstName}, here's the link to view your ${b.boat.name} booking for ${fmtRange(b.startsAt, b.endsAt)}, sign your agreement, and pay any balance:</p>
<p><a href="${appUrl(`/b/${b.accessToken}`)}" style="background:#1E6286;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open booking</a></p>
<p>Guest waiver link to share with your group: ${appUrl(`/w/${b.waiverToken}`)}</p>`,
    ),
  });
  await logEvent(id, "link_sent", "Booking link emailed to customer", s.name);
  back(`/admin/bookings/${id}`, "Link emailed to customer");
}

export async function resendConfirmationAction(f: FormData) {
  await requireAdmin();
  const id = str(f, "id");
  await onBookingConfirmed(id);
  back(`/admin/bookings/${id}`, "Confirmation re-sent");
}

export async function cancelBookingAction(f: FormData) {
  const s = await requireRole("owner", "manager");
  const id = str(f, "id");
  const b = await prisma.booking.findUniqueOrThrow({ where: { id } });
  const refund = str(f, "refund") === "on";
  try {
    if (refund && b.paidCents - b.refundedCents > 0) {
      await refundPayment(id, b.paidCents - b.refundedCents, str(f, "reason") || "Cancelled by staff", s.name);
    }
    if (b.depositStatus === "held") await releaseDeposit(id, s.name);
  } catch (e) {
    return back(`/admin/bookings/${id}`, undefined, (e as Error).message);
  }
  await prisma.booking.update({ where: { id }, data: { status: "cancelled" } });
  await logEvent(id, "cancelled", `Cancelled by staff${str(f, "reason") ? `: ${str(f, "reason")}` : ""}`, s.name);
  back(`/admin/bookings/${id}`, "Booking cancelled");
}

export async function saveBookingNotes(f: FormData) {
  await requireAdmin();
  const id = str(f, "id");
  await prisma.booking.update({ where: { id }, data: { internalNotes: str(f, "internalNotes") } });
  back(`/admin/bookings/${id}`, "Notes saved");
}

export async function rescheduleBooking(f: FormData) {
  const s = await requireAdmin();
  const id = str(f, "id");
  const b = await prisma.booking.findUniqueOrThrow({ where: { id }, include: { rate: true } });
  const date = str(f, "date");
  const time = str(f, "startTime");
  const boatId = str(f, "boatId") || b.boatId;
  const startsAt = zonedToUtc(date, time);
  const minutes = Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60000);
  const endsAt = new Date(startsAt.getTime() + minutes * 60000);
  const clash = await prisma.booking.findFirst({
    where: {
      id: { not: id },
      boatId,
      status: { notIn: ["cancelled", "no_show"] },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
  });
  if (clash) return back(`/admin/bookings/${id}`, undefined, `Conflicts with booking ${clash.code}`);
  await prisma.booking.update({ where: { id }, data: { startsAt, endsAt, boatId } });
  await logEvent(id, "rescheduled", `Rescheduled to ${fmtRange(startsAt, endsAt)}`, s.name);
  back(`/admin/bookings/${id}`, "Rescheduled");
}

export async function deletePhotoAction(f: FormData) {
  await requireRole("owner", "manager");
  const id = str(f, "photoId");
  const p = await prisma.photo.delete({ where: { id } });
  await deleteObject(p.storageKey);
  back(`/admin/bookings/${p.bookingId}`, "Photo deleted");
}

// ---------------------------------------------------------------- fleet

export async function saveBoat(f: FormData) {
  await requireRole("owner", "manager");
  const id = str(f, "id");
  const deposit = parseMoney(str(f, "deposit"));
  const data = {
    name: str(f, "name"),
    type: str(f, "type") || "Tritoon",
    description: str(f, "description"),
    capacity: Number(str(f, "capacity")) || 1,
    lengthFt: num(f, "lengthFt"),
    horsepower: num(f, "horsepower"),
    imageUrl: str(f, "imageUrl") || null,
    depositCents: deposit ?? 0,
    status: str(f, "status") || "available",
    sortOrder: Number(str(f, "sortOrder")) || 0,
    registration: str(f, "registration") || null,
    hullId: str(f, "hullId") || null,
    notes: str(f, "notes"),
    engineHours: Number(str(f, "engineHours")) || 0,
  };
  if (!data.name) return back(`/admin/boats/${id || "new"}`, undefined, "Name is required");
  if (id) {
    await prisma.boat.update({ where: { id }, data });
    back(`/admin/boats/${id}`, "Saved");
  } else {
    let slug = slugify(data.name) || "boat";
    if (await prisma.boat.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;
    const b = await prisma.boat.create({ data: { ...data, slug } });
    redirect(`/admin/boats/${b.id}?msg=Boat+created.+Now+add+its+rates.`);
  }
}

export async function saveRate(f: FormData) {
  await requireRole("owner", "manager");
  const boatId = str(f, "boatId");
  const id = str(f, "id");
  const price = parseMoney(str(f, "price"));
  const weekend = parseMoney(str(f, "weekendPrice"));
  const hours = Number(str(f, "hours"));
  if (!str(f, "label") || price == null || !hours) return back(`/admin/boats/${boatId}`, undefined, "Label, hours and price are required");
  const data = {
    label: str(f, "label"),
    minutes: Math.round(hours * 60),
    priceCents: price,
    weekendPriceCents: weekend,
    active: str(f, "active") === "on",
    sortOrder: Number(str(f, "sortOrder")) || 0,
  };
  if (id) await prisma.rate.update({ where: { id }, data });
  else await prisma.rate.create({ data: { ...data, boatId } });
  back(`/admin/boats/${boatId}`, "Rate saved");
}

export async function deleteRate(f: FormData) {
  await requireRole("owner", "manager");
  const r = await prisma.rate.delete({ where: { id: str(f, "id") } });
  back(`/admin/boats/${r.boatId}`, "Rate removed");
}

export async function copyRatesToAllBoats(f: FormData) {
  await requireRole("owner", "manager");
  const boatId = str(f, "boatId");
  const rates = await prisma.rate.findMany({ where: { boatId } });
  const others = await prisma.boat.findMany({ where: { id: { not: boatId } } });
  for (const o of others) {
    await prisma.rate.updateMany({ where: { boatId: o.id }, data: { active: false } });
    await prisma.rate.createMany({
      data: rates.map(({ id: _id, boatId: _b, ...r }) => ({ ...r, boatId: o.id })),
    });
  }
  back(`/admin/boats/${boatId}`, `Copied rates to ${others.length} boats (their old rates were deactivated)`);
}

export async function addBlock(f: FormData) {
  await requireAdmin();
  const boatId = str(f, "boatId") || null;
  const startsAt = zonedToUtc(str(f, "startDate"), str(f, "startTime") || "00:00");
  const endsAt = zonedToUtc(str(f, "endDate") || str(f, "startDate"), str(f, "endTime") || "23:59");
  if (endsAt <= startsAt) return back(str(f, "returnTo") || "/admin/calendar", undefined, "End must be after start");
  await prisma.boatBlock.create({ data: { boatId, startsAt, endsAt, reason: str(f, "reason") } });
  back(str(f, "returnTo") || "/admin/calendar", "Blocked off");
}

export async function deleteBlock(f: FormData) {
  await requireAdmin();
  await prisma.boatBlock.delete({ where: { id: str(f, "id") } });
  back(str(f, "returnTo") || "/admin/calendar", "Block removed");
}

export async function addMaintenance(f: FormData) {
  const s = await requireAdmin();
  const boatId = str(f, "boatId");
  if (!str(f, "description")) return back(`/admin/boats/${boatId}`, undefined, "Describe the work done");
  await prisma.maintenanceLog.create({
    data: {
      boatId,
      description: str(f, "description"),
      engineHours: num(f, "engineHours"),
      costCents: parseMoney(str(f, "cost")),
      performedAt: str(f, "date") ? zonedToUtc(str(f, "date"), "12:00") : new Date(),
      createdBy: s.name,
    },
  });
  back(`/admin/boats/${boatId}`, "Maintenance logged");
}

// ---------------------------------------------------------------- add-ons

export async function saveAddOn(f: FormData) {
  await requireRole("owner", "manager");
  const id = str(f, "id");
  const price = parseMoney(str(f, "price"));
  if (!str(f, "name") || price == null) return back("/admin/addons", undefined, "Name and price are required");
  const data = {
    name: str(f, "name"),
    description: str(f, "description"),
    priceCents: price,
    quantity: Number(str(f, "quantity")) || 1,
    active: str(f, "active") === "on",
    sortOrder: Number(str(f, "sortOrder")) || 0,
  };
  if (id) await prisma.addOn.update({ where: { id }, data });
  else await prisma.addOn.create({ data });
  back("/admin/addons", "Saved");
}

// ---------------------------------------------------------------- contracts

export async function publishContractVersion(f: FormData) {
  await requireRole("owner", "manager");
  const name = str(f, "name");
  const body = str(f, "body");
  if (!name || body.length < 20) return back("/admin/contracts", undefined, "Name and full contract text are required");
  const latest = await prisma.contractTemplate.findFirst({ where: { name }, orderBy: { version: "desc" } });
  // Old versions stay for the record (signed snapshots reference them) but are deactivated
  await prisma.contractTemplate.updateMany({ where: { name }, data: { active: false } });
  await prisma.contractTemplate.create({
    data: {
      name,
      body,
      version: (latest?.version ?? 0) + 1,
      required: str(f, "required") === "on",
      signer: str(f, "signer") || "renter",
    },
  });
  back("/admin/contracts", `Published ${name} v${(latest?.version ?? 0) + 1}`);
}

export async function retireContract(f: FormData) {
  await requireRole("owner", "manager");
  await prisma.contractTemplate.updateMany({ where: { name: str(f, "name") }, data: { active: false } });
  back("/admin/contracts", "Contract retired");
}

// ---------------------------------------------------------------- settings & staff

export async function saveSettings(f: FormData) {
  await requireRole("owner");
  const pct = (k: string) => Math.round(parseFloat(str(f, k) || "0") * 100);
  await prisma.settings.update({
    where: { id: 1 },
    data: {
      businessName: str(f, "businessName"),
      phone: str(f, "phone"),
      email: str(f, "email"),
      address: str(f, "address"),
      openTime: str(f, "openTime"),
      closeTime: str(f, "closeTime"),
      slotIntervalMin: Number(str(f, "slotIntervalMin")) || 30,
      bufferMin: Number(str(f, "bufferMin")) || 0,
      maxAdvanceDays: Number(str(f, "maxAdvanceDays")) || 180,
      minNoticeHours: Number(str(f, "minNoticeHours")) || 0,
      taxRateBps: pct("taxRate"),
      feeRateBps: pct("feeRate"),
      cancelWindowHours: Number(str(f, "cancelWindowHours")) || 0,
      holdMinutes: Number(str(f, "holdMinutes")) || 20,
      weekendDays: f.getAll("weekendDays").map(String).join(","),
      confirmationNote: str(f, "confirmationNote"),
    },
  });
  back("/admin/settings", "Settings saved");
}

export async function saveStaff(f: FormData) {
  await requireRole("owner");
  const id = str(f, "id");
  const email = str(f, "email").toLowerCase();
  const password = str(f, "password");
  const data = { name: str(f, "name"), email, role: str(f, "role") || "staff", active: str(f, "active") === "on" };
  if (id) {
    await prisma.adminUser.update({
      where: { id },
      data: { ...data, ...(password ? { passwordHash: await hashPassword(password) } : {}) },
    });
  } else {
    if (!email || password.length < 8) return back("/admin/settings", undefined, "Email and a password of 8+ characters are required");
    await prisma.adminUser.create({ data: { ...data, passwordHash: await hashPassword(password) } });
  }
  back("/admin/settings", "Staff saved");
}

export async function saveCustomer(f: FormData) {
  await requireAdmin();
  const id = str(f, "id");
  await prisma.customer.update({
    where: { id },
    data: { firstName: str(f, "firstName"), lastName: str(f, "lastName"), phone: str(f, "phone"), notes: str(f, "notes") },
  });
  back(`/admin/customers/${id}`, "Saved");
}

export async function getCheckoutLink(bookingId: string) {
  await requireAdmin();
  return createCheckout(bookingId);
}

"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { logout, requireStaff } from "@/lib/auth";
import { logEvent } from "@/lib/bookings";
import { checkIn, checkOut } from "@/lib/operations";
import { DAMAGE_SEVERITIES, PHOTO_ANGLES } from "@/lib/constants";
import { fmtMoney, parseMoney } from "@/lib/money";
import { chargeTipToCardOnFile, recordTip } from "@/lib/tips";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === "" || Number.isNaN(Number(v)) ? null : Number(v);
};
const back = (path: string, msg?: string, err?: string): never => {
  const q = new URLSearchParams();
  if (msg) q.set("msg", msg);
  if (err) q.set("err", err);
  redirect(`${path}${q.size ? `?${q}` : ""}`);
};

export async function dockLogout() {
  await logout();
  redirect("/dock/login");
}

export async function dockCheckOut(f: FormData) {
  const s = await requireStaff();
  const id = str(f, "id");
  const r = await checkOut(id, s.name, {
    engineHoursOut: num(f, "engineHoursOut"),
    fuelOut: str(f, "fuelOut") || null,
    placeDeposit: true,
    allowMissingPhotos: str(f, "allowMissingPhotos") === "on",
    userId: s.uid,
  });
  if (r.ok) back("/dock", r.message);
  else back(`/dock/b/${id}`, undefined, r.error);
}

export async function dockCheckIn(f: FormData) {
  const s = await requireStaff();
  const id = str(f, "id");
  if (num(f, "engineHoursIn") == null) back(`/dock/b/${id}`, undefined, "Enter the engine hours.");
  const tipRaw = str(f, "tip");
  const tipCents = tipRaw ? parseMoney(tipRaw) : null;
  if (tipRaw && (tipCents == null || tipCents < 0 || tipCents > 100000)) back(`/dock/b/${id}`, undefined, "Enter the tip as a dollar amount, like 40.");
  const r = await checkIn(id, s.name, { engineHoursIn: num(f, "engineHoursIn"), fuelIn: str(f, "fuelIn") || null, notes: str(f, "notes"), userId: s.uid });
  if (!r.ok) return back(`/dock/b/${id}`, undefined, r.error);
  // Optional tip at check-in: handled after a successful check-in and never blocks it
  let tipNote = "";
  let tipWarning: string | undefined;
  if (tipCents && tipCents > 0) {
    if (str(f, "tipMethod") === "cash") {
      await recordTip({ bookingId: id, amountCents: tipCents, method: "cash", source: "dock", actor: s.name });
      tipNote = ` Cash tip of ${fmtMoney(tipCents)} saved.`;
    } else {
      const t = await chargeTipToCardOnFile(id, tipCents, "dock", s.name);
      if (t.ok) tipNote = ` Tip of ${fmtMoney(tipCents)} charged to their card.`;
      else tipWarning = `Checked in, but the card tip didn't go through (${t.error}). Ask for cash or let the office know.`;
    }
  }
  back("/dock", tipWarning ? undefined : r.message + tipNote, tipWarning);
}

/** Crew decision on an automatically flagged spot. */
export async function resolveFlag(f: FormData) {
  const s = await requireStaff();
  const id = str(f, "id");
  const decision = str(f, "decision") === "confirm" ? "confirmed" : "dismissed";
  const d = await prisma.damageReport.update({
    where: { id },
    data: { status: decision, reviewedBy: s.name, reviewedAt: new Date(), description: str(f, "description") || undefined },
  });
  if (d.bookingId) {
    await logEvent(
      d.bookingId,
      decision === "confirmed" ? "damage_confirmed" : "damage_dismissed",
      `${decision === "confirmed" ? "Confirmed" : "Dismissed"} flagged spot: ${d.location} – ${d.description}`,
      s.name,
    );
  }
  back(str(f, "returnTo") || "/dock", decision === "confirmed" ? "Damage logged" : "Dismissed");
}

/** Damage the crew found themselves. */
export async function logDamage(f: FormData) {
  const s = await requireStaff();
  const bookingId = str(f, "bookingId") || null;
  const boatId = str(f, "boatId");
  const description = str(f, "description");
  const returnTo = str(f, "returnTo") || "/dock";
  if (!description) back(returnTo, undefined, "Describe the damage.");
  const angle = PHOTO_ANGLES.some((a) => a.key === str(f, "angle")) ? str(f, "angle") : "other";
  const severity = (DAMAGE_SEVERITIES as readonly string[]).includes(str(f, "severity")) ? str(f, "severity") : "minor";
  const booking = bookingId ? await prisma.booking.findUnique({ where: { id: bookingId } }) : null;
  const d = await prisma.damageReport.create({
    data: {
      boatId,
      bookingId,
      source: "crew",
      phase: booking?.status === "confirmed" || !booking ? "before" : "after",
      angle,
      location: str(f, "location"),
      description,
      severity,
      status: "confirmed",
      createdBy: s.name,
      reviewedBy: s.name,
      reviewedAt: new Date(),
    },
  });
  if (bookingId) await logEvent(bookingId, "damage_logged", `Damage logged (${severity}): ${d.location ? d.location + " – " : ""}${description}`, s.name);
  back(returnTo, "Damage logged");
}

export async function markRepaired(f: FormData) {
  const s = await requireStaff();
  await prisma.damageReport.update({ where: { id: str(f, "id") }, data: { status: "repaired", reviewedBy: s.name, reviewedAt: new Date() } });
  back(str(f, "returnTo") || "/dock", "Marked repaired");
}

/** Dock crew can log service work and report issues from the dock. */
export async function dockLogMaintenance(f: FormData) {
  const s = await requireStaff();
  const boatId = str(f, "boatId");
  const description = str(f, "description");
  const returnTo = `/dock/boats/${boatId}`;
  if (!description) back(returnTo, undefined, "Describe the work.");
  const scheduleId = str(f, "scheduleId") || null;
  const hours = num(f, "engineHours");
  await prisma.maintenanceLog.create({
    data: {
      boatId,
      scheduleId,
      category: str(f, "category") || "service",
      description,
      engineHours: hours,
      vendor: str(f, "vendor"),
      costCents: parseMoney(str(f, "cost")) ?? null,
      createdBy: s.name,
    },
  });
  if (scheduleId) {
    await prisma.maintenanceSchedule.update({ where: { id: scheduleId }, data: { lastDoneAt: new Date(), lastDoneHours: hours } });
  }
  if (hours != null) {
    const boat = await prisma.boat.findUniqueOrThrow({ where: { id: boatId } });
    if (hours > boat.engineHours) await prisma.boat.update({ where: { id: boatId }, data: { engineHours: hours } });
  }
  back(returnTo, "Logged");
}

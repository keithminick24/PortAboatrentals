import "server-only";
import { prisma } from "./db";
import { logEvent, missingPrimarySignatures } from "./bookings";
import { placeDepositHold } from "./payments";
import { PHOTO_ANGLES } from "./constants";

/** Shared check-out / check-in rules used by both the office (/admin) and dock (/dock) apps. */

export type OpResult = { ok: true; message: string } | { ok: false; error: string };

export async function checkOutReadiness(bookingId: string) {
  const b = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { photos: { where: { phase: "before" } }, damage: { where: { status: "needs_check" } } },
  });
  const missingSigs = await missingPrimarySignatures(bookingId);
  const shot = new Set(b.photos.map((p) => p.angle));
  const missingAngles = PHOTO_ANGLES.filter((a) => !shot.has(a.key));
  return {
    signed: missingSigs.length === 0,
    paid: b.paidCents >= b.totalCents,
    beforePhotos: b.photos.length,
    missingAngles,
    unresolvedFlags: b.damage.length,
  };
}

export async function checkOut(
  bookingId: string,
  actor: string,
  opts: { engineHoursOut: number | null; fuelOut: string | null; placeDeposit: boolean; allowMissingPhotos?: boolean },
): Promise<OpResult> {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { boat: true } });
  if (b.status !== "confirmed") return { ok: false, error: `This booking is ${b.status.replace("_", " ")}, not ready to check out.` };
  const r = await checkOutReadiness(bookingId);
  if (!r.signed) return { ok: false, error: "The renter must sign the rental agreement before check-out." };
  if (!r.paid) return { ok: false, error: "Collect the balance before check-out." };
  if (r.beforePhotos === 0) return { ok: false, error: "Take the before photos first." };
  if (r.missingAngles.length && !opts.allowMissingPhotos) {
    return { ok: false, error: `Missing before photos: ${r.missingAngles.map((a) => a.label).join(", ")}.` };
  }
  if (r.unresolvedFlags > 0) return { ok: false, error: "Check the flagged spots on the before photos first (confirm or dismiss each)." };
  if (opts.engineHoursOut != null && opts.engineHoursOut < b.boat.engineHours - 0.05) {
    return { ok: false, error: `Engine hours can't be lower than the last reading (${b.boat.engineHours}).` };
  }
  if (opts.placeDeposit && b.depositStatus !== "held" && b.depositCents > 0) {
    const hold = await placeDepositHold(bookingId, actor);
    if (!hold.ok) return { ok: false, error: `Deposit hold failed: ${hold.error}. Boat NOT checked out.` };
  }
  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "checked_out", checkedOutAt: new Date(), checkedOutBy: actor, fuelOut: opts.fuelOut, engineHoursOut: opts.engineHoursOut },
  });
  if (opts.engineHoursOut != null) await prisma.boat.update({ where: { id: b.boatId }, data: { engineHours: opts.engineHoursOut } });
  await logEvent(
    bookingId,
    "checked_out",
    `Checked out · fuel ${opts.fuelOut || "?"} · engine ${opts.engineHoursOut ?? "?"} hrs${r.missingAngles.length ? ` · missing photos: ${r.missingAngles.map((a) => a.key).join(", ")}` : ""}`,
    actor,
  );
  return { ok: true, message: "Boat checked out. Have a great trip!" };
}

export async function checkIn(
  bookingId: string,
  actor: string,
  opts: { engineHoursIn: number | null; fuelIn: string | null; notes: string },
): Promise<OpResult> {
  const b = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { damage: { where: { status: "needs_check" } }, photos: { where: { phase: "after" } } },
  });
  if (b.status !== "checked_out") return { ok: false, error: "This boat isn't checked out." };
  if (b.photos.length === 0) return { ok: false, error: "Take the after photos first." };
  if (b.damage.length > 0) return { ok: false, error: "Check every flagged spot first (confirm or dismiss)." };
  if (opts.engineHoursIn != null && b.engineHoursOut != null && opts.engineHoursIn < b.engineHoursOut) {
    return { ok: false, error: `Engine hours in (${opts.engineHoursIn}) can't be less than hours out (${b.engineHoursOut}).` };
  }
  const confirmed = await prisma.damageReport.count({ where: { bookingId, phase: "after", status: "confirmed" } });
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: "returned",
      returnedAt: new Date(),
      returnedBy: actor,
      fuelIn: opts.fuelIn,
      engineHoursIn: opts.engineHoursIn,
      damageNotes: [b.damageNotes, opts.notes].filter(Boolean).join("\n"),
    },
  });
  if (opts.engineHoursIn != null) await prisma.boat.update({ where: { id: b.boatId }, data: { engineHours: opts.engineHoursIn } });
  const late = b.endsAt < new Date() ? Math.round((Date.now() - b.endsAt.getTime()) / 60000) : 0;
  const used = opts.engineHoursIn != null && b.engineHoursOut != null ? ` (${(opts.engineHoursIn - b.engineHoursOut).toFixed(1)} hrs used)` : "";
  await logEvent(
    bookingId,
    "returned",
    `Returned · fuel ${opts.fuelIn || "?"} · engine ${opts.engineHoursIn ?? "?"} hrs${used}${late > 10 ? ` · ${late} min late` : ""}${confirmed ? ` · ${confirmed} damage item(s) logged` : ""}${opts.notes ? ` · notes: ${opts.notes}` : ""}`,
    actor,
  );
  return {
    ok: true,
    message: confirmed ? `Checked in with ${confirmed} damage item(s). The office will review the deposit.` : "Checked in. No new damage logged.",
  };
}

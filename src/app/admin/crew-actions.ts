"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/bookings";
import { parseMoney, fmtMoney } from "@/lib/money";
import { addTripCrew } from "@/lib/operations";
import { chargeTipToCardOnFile, recordTip } from "@/lib/tips";

/** Office actions for the "Crew & tips" card on the booking page. */

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, msg?: string, err?: string): never => {
  const q = new URLSearchParams();
  if (msg) q.set("msg", msg);
  if (err) q.set("err", err);
  redirect(`${path}${q.size ? `?${q}` : ""}`);
};

export async function addBookingCrew(f: FormData) {
  const s = await requirePermission("ops");
  const bookingId = str(f, "bookingId");
  const userId = str(f, "userId");
  const path = `/admin/bookings/${bookingId}`;
  if (!userId) back(path, undefined, "Pick a crew member.");
  await addTripCrew(bookingId, userId, "assigned");
  const u = await prisma.adminUser.findUnique({ where: { id: userId } });
  await logEvent(bookingId, "crew", `Added ${u?.name ?? "crew"} to this trip`, s.name);
  back(path, "Crew updated");
}

export async function removeBookingCrew(f: FormData) {
  const s = await requirePermission("ops");
  const bookingId = str(f, "bookingId");
  const row = await prisma.bookingCrew.findFirst({ where: { id: str(f, "id"), bookingId }, include: { user: true } });
  if (row) {
    await prisma.bookingCrew.delete({ where: { id: row.id } });
    await logEvent(bookingId, "crew", `Removed ${row.user.name} from this trip`, s.name);
  }
  back(`/admin/bookings/${bookingId}`, "Crew updated");
}

export async function addBookingTip(f: FormData) {
  const s = await requirePermission("ops");
  const bookingId = str(f, "bookingId");
  const path = `/admin/bookings/${bookingId}`;
  const cents = parseMoney(str(f, "amount"));
  if (!cents || cents <= 0 || cents > 100000) back(path, undefined, "Enter a tip amount between $0.01 and $1,000.");
  if (str(f, "method") === "cash") {
    await recordTip({ bookingId, amountCents: cents!, method: "cash", source: "office", actor: s.name });
    back(path, `Cash tip of ${fmtMoney(cents!)} saved`);
  }
  const r = await chargeTipToCardOnFile(bookingId, cents!, "office", s.name);
  if (r.ok) back(path, `Tip of ${fmtMoney(cents!)} charged to the card on file`);
  else back(path, undefined, `Tip not charged: ${r.error}`);
}

export async function deleteBookingTip(f: FormData) {
  const s = await requirePermission("money");
  const bookingId = str(f, "bookingId");
  const tip = await prisma.tip.findFirst({ where: { id: str(f, "id"), bookingId } });
  if (tip) {
    if (tip.method === "card") back(`/admin/bookings/${bookingId}`, undefined, "Card tips can't be deleted here. Refund it in Stripe first.");
    await prisma.tip.delete({ where: { id: tip.id } });
    await logEvent(bookingId, "tip_deleted", `Deleted ${tip.method} tip of ${fmtMoney(tip.amountCents)}`, s.name);
  }
  back(`/admin/bookings/${bookingId}`, "Tip removed");
}

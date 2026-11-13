"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { prisma, getSettings } from "@/lib/db";
import { BookingError, getAvailabilityForDate } from "@/lib/bookings";
import { isValidDateStr } from "@/lib/time";
import { approvePhoneOrder, PhoneOrderError, processCall, rejectPhoneOrder, reopenPhoneOrder } from "@/lib/phoneOrders";
import { secureToken } from "@/lib/ids";

const PATH = "/admin/phone-orders";
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (msg?: string, err?: string, anchor = ""): never => {
  const q = new URLSearchParams();
  if (msg) q.set("msg", msg);
  if (err) q.set("err", err);
  redirect(`${PATH}${q.size ? `?${q}` : ""}${anchor}`);
};
const actorOf = (s: { name: string; email: string }) => s.name || s.email;

/** Open start times per boat/rate for a date (used by the review form's time picker). */
export async function phoneOrderSlots(date: string) {
  await requirePermission("phoneOrders");
  if (!isValidDateStr(date)) return [];
  const a = await getAvailabilityForDate(date);
  return a.boats.map((b) => ({
    boatId: b.boatId,
    name: b.name,
    capacity: b.capacity,
    rates: b.rates.map((r) => ({ id: r.id, label: r.label, priceCents: r.priceCents, startTimes: r.startTimes })),
  }));
}

export async function approvePhoneOrderAction(f: FormData) {
  const s = await requirePermission("phoneOrders");
  const id = str(f, "id");
  const [boatId, rateId] = str(f, "boatRate").split("|");
  const addOns = [...f.keys()]
    .filter((k) => k.startsWith("addon_"))
    .map((k) => ({ addOnId: k.slice(6), quantity: Math.max(0, Math.floor(Number(f.get(k)) || 0)) }))
    .filter((a) => a.quantity > 0);
  let result: Awaited<ReturnType<typeof approvePhoneOrder>>;
  try {
    result = await approvePhoneOrder(
      id,
      {
        customerName: str(f, "customerName"),
        phone: str(f, "phone"),
        email: str(f, "email"),
        date: str(f, "date"),
        startTime: str(f, "startTime"),
        boatId: boatId ?? "",
        rateId: rateId ?? "",
        partySize: Number(str(f, "partySize")) || 1,
        addOns,
        notes: str(f, "notes"),
        sendText: f.get("sendText") === "on",
      },
      actorOf(s),
    );
  } catch (e) {
    if (e instanceof BookingError || e instanceof PhoneOrderError) return back(undefined, e.message, `#order-${id}`);
    throw e;
  }
  revalidatePath("/admin");
  back(`Booked ${result.code}. ${result.texted ? "Sign & pay link texted to the guest." : "No text was sent; use Messages to send the link."}`);
}

export async function rejectPhoneOrderAction(f: FormData) {
  const s = await requirePermission("phoneOrders");
  try {
    const r = await rejectPhoneOrder(str(f, "id"), str(f, "reason"), actorOf(s), f.get("textCaller") === "on" ? str(f, "message") : undefined);
    revalidatePath("/admin");
    back(r.texted ? "Request rejected and the caller was texted." : "Request rejected.");
  } catch (e) {
    if (e instanceof PhoneOrderError) return back(undefined, e.message);
    throw e;
  }
}

export async function reopenPhoneOrderAction(f: FormData) {
  await requirePermission("phoneOrders");
  try {
    await reopenPhoneOrder(str(f, "id"));
  } catch (e) {
    if (e instanceof PhoneOrderError) return back(undefined, e.message);
    throw e;
  }
  back("Moved back to the review list.");
}

export async function pasteCallAction(f: FormData) {
  await requirePermission("phoneOrders");
  const phone = str(f, "phone");
  const transcript = str(f, "transcript");
  if (!phone || !transcript) return back(undefined, "Enter the caller's phone number and what was said.");
  const id = await processCall({ callId: `manual-${secureToken(9)}`, phone, summary: "", transcript, force: true });
  back("Call added. Check the details below.", undefined, id ? `#order-${id}` : "");
}

export async function savePhoneHoldHours(f: FormData) {
  await requirePermission("pricing");
  const hours = Math.floor(Number(str(f, "phoneHoldHours")));
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) return back(undefined, "Hold time must be between 1 and 168 hours.");
  await getSettings();
  await prisma.settings.update({ where: { id: 1 }, data: { phoneHoldHours: hours } });
  back("Hold time saved.");
}

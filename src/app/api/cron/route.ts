import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { expireStaleHolds } from "@/lib/bookings";
import { placeDepositHold } from "@/lib/payments";
import { getSettings } from "@/lib/db";
import { sendText } from "@/lib/messaging";
import { appUrl } from "@/lib/mail";
import { fmtRange } from "@/lib/time";

/**
 * Run every 15–60 minutes (Vercel Cron, Render cron, or any uptime pinger):
 *   GET /api/cron   with header  Authorization: Bearer $CRON_SECRET
 * - Releases unpaid bookings whose hold expired
 * - Places security-deposit holds on saved cards ~24h before departure
 * - Texts a trip reminder (with the waiver link) ~24h before departure
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const expired = await expireStaleHolds();

  const soon = new Date(Date.now() + 24 * 3600000);
  const due = await prisma.booking.findMany({
    where: {
      status: "confirmed",
      depositStatus: "card_saved",
      depositCents: { gt: 0 },
      startsAt: { lte: soon, gt: new Date() },
    },
    select: { id: true },
  });
  const results = [];
  for (const b of due) results.push({ id: b.id, ...(await placeDepositHold(b.id, "auto")) });

  let reminders = 0;
  const settings = await getSettings();
  if (settings.smsReminder) {
    const remind = await prisma.booking.findMany({
      where: { status: "confirmed", reminderSentAt: null, startsAt: { lte: soon, gt: new Date(Date.now() + 2 * 3600000) } },
      include: { boat: true, customer: true },
    });
    for (const b of remind) {
      await sendText({
        to: b.customer.phone,
        customerId: b.customerId,
        bookingId: b.id,
        sentBy: "Auto",
        body: `${settings.businessName} reminder: ${b.boat.name} is reserved for ${fmtRange(b.startsAt, b.endsAt)}. Please arrive 20 min early with photo ID and your boater-ed card. Guests who haven't signed the waiver can do it here: ${appUrl(`/w/${b.waiverToken}`)}`,
      });
      await prisma.booking.update({ where: { id: b.id }, data: { reminderSentAt: new Date() } });
      reminders++;
    }
  }

  return NextResponse.json({ expired, depositsAttempted: results.length, results, reminders });
}

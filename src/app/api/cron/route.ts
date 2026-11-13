import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { expireStaleHolds } from "@/lib/bookings";
import { placeDepositHold } from "@/lib/payments";

/**
 * Run every 15–60 minutes (Vercel Cron, Render cron, or any uptime pinger):
 *   GET /api/cron   with header  Authorization: Bearer $CRON_SECRET
 * - Releases unpaid bookings whose hold expired
 * - Places security-deposit holds on saved cards ~24h before departure
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

  return NextResponse.json({ expired, depositsAttempted: results.length, results });
}

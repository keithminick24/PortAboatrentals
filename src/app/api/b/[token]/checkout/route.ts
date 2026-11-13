import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isSlotStillFree, missingPrimarySignatures } from "@/lib/bookings";
import { createCheckout } from "@/lib/payments";
import { appUrl } from "@/lib/mail";

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await prisma.booking.findUnique({ where: { accessToken: token } });
  if (!b) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (b.status === "cancelled") return NextResponse.redirect(await appUrl(`/b/${token}`), 303);
  if ((await missingPrimarySignatures(b.id)).length > 0) return NextResponse.redirect(await appUrl(`/b/${token}/sign`), 303);
  // Give the customer a fresh hold window while they're at checkout
  if (b.status === "pending" && b.holdExpiresAt) {
    if (b.holdExpiresAt < new Date() && !(await isSlotStillFree(b.id))) {
      return NextResponse.redirect(await appUrl(`/b/${token}?taken=1`), 303);
    }
    await prisma.booking.update({ where: { id: b.id }, data: { holdExpiresAt: new Date(Date.now() + 30 * 60000) } });
  }
  const url = await createCheckout(b.id);
  return NextResponse.redirect(url, 303);
}

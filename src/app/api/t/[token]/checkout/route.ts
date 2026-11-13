import { NextResponse } from "next/server";
import { getSettings, prisma } from "@/lib/db";
import { parseMoney } from "@/lib/money";
import { isMockPayments } from "@/lib/payments";
import { appUrl } from "@/lib/mail";
import { chargeTipToCardOnFile, createTipCheckout, hasCardOnFile, recordTip, tipSuggestions } from "@/lib/tips";

/**
 * POST from the post-trip tip page (/t/<accessToken>).
 *   mode=card_on_file → charge the card saved at booking
 *   mode=new_card     → Stripe Checkout (test mode: records a test tip and returns)
 * Amount: `custom` dollars if filled in, otherwise `choice` = "pct:<n>" of the boat rental.
 */
const MIN_TIP = 100;
const MAX_TIP = 100000;

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = async (q = "") => NextResponse.redirect(await appUrl(`/t/${token}${q}`), 303);
  const f = await req.formData().catch(() => null);
  const b = await prisma.booking.findUnique({ where: { accessToken: token }, include: { customer: true } });
  if (!b || !f) return page();
  const settings = await getSettings();
  if (!settings.tipsEnabled || !["returned", "completed"].includes(b.status)) return page();

  const custom = String(f.get("custom") ?? "").trim();
  const choice = String(f.get("choice") ?? "");
  let cents: number | null = null;
  if (custom) cents = parseMoney(custom);
  else if (choice.startsWith("pct:")) {
    const pct = Number(choice.slice(4));
    cents = tipSuggestions(b.subtotalCents, settings.tipPercents).find((s) => s.pct === pct)?.cents ?? null;
  }
  if (cents == null || cents < MIN_TIP || cents > MAX_TIP) return page("?err=amount");

  const mode = String(f.get("mode") ?? "new_card");
  if (mode === "card_on_file" && hasCardOnFile(b)) {
    // Guard against a double tap: same amount in the last 5 minutes counts as done.
    const recent = await prisma.tip.findFirst({
      where: { bookingId: b.id, source: "post_trip", amountCents: cents, createdAt: { gte: new Date(Date.now() - 5 * 60000) } },
    });
    if (recent) return page(`?tipped=${cents}`);
    const r = await chargeTipToCardOnFile(b.id, cents, "post_trip", "guest");
    return r.ok ? page(`?tipped=${cents}`) : page("?err=card");
  }

  if (isMockPayments()) {
    await recordTip({ bookingId: b.id, amountCents: cents, method: "mock", source: "post_trip", actor: "guest" });
    return page(`?tipped=${cents}`);
  }
  try {
    return NextResponse.redirect(await createTipCheckout(b.id, cents), 303);
  } catch (e) {
    console.error(e);
    return page("?err=checkout");
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { recordSignature, signatureSchema, signedCopyUrl } from "@/lib/signatures";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await prisma.booking.findUnique({ where: { accessToken: token } });
  if (!booking || booking.status === "cancelled") return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  const parsed = signatureSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    const sig = await recordSignature(booking.id, parsed.data, true, req);
    return NextResponse.json({ ok: true, copyUrl: await signedCopyUrl(sig.id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}

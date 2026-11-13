import { NextResponse } from "next/server";
import { handleQuoEvent, verifyQuoSignature } from "@/lib/messaging";

/** Quo webhook: subscribe to message.received, message.delivered, message.failed, message.undelivered,
 * and (for AI phone booking requests) call.summary.completed and call.transcript.completed. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyQuoSignature(raw, req.headers)) return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  try {
    await handleQuoEvent(JSON.parse(raw));
  } catch (e) {
    console.error("Quo webhook error", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { checkTelemetryToken, ingestTelemetry, isTelemetryWebhookEnabled } from "@/lib/telemetry";

/**
 * Receives BoatFix (or other telematics) updates: engine hours, GPS, battery, alerts.
 * Auth: header "x-webhook-token: <TELEMETRY_WEBHOOK_SECRET>" or ?token=<secret>.
 * Accepts one JSON object or an array of them.
 */
export async function POST(req: Request) {
  if (!isTelemetryWebhookEnabled()) return NextResponse.json({ error: "Telemetry webhook not configured" }, { status: 503 });
  const token = req.headers.get("x-webhook-token") ?? new URL(req.url).searchParams.get("token");
  if (!checkTelemetryToken(token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  const items = Array.isArray(body) ? body.slice(0, 500) : [body];
  const results = [];
  for (const item of items) results.push(await ingestTelemetry(item));
  console.log("[telemetry] received", JSON.stringify(body).slice(0, 2000));
  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}

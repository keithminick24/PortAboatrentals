import { NextResponse } from "next/server";
import { getAvailabilityForDate } from "@/lib/bookings";
import { isValidDateStr } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  const party = Number(url.searchParams.get("party") || 0) || undefined;
  if (!isValidDateStr(date)) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  const data = await getAvailabilityForDate(date, { partySize: party });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

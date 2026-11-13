import { NextResponse } from "next/server";
import { z } from "zod";
import { BookingError, createBooking, missingPrimarySignatures } from "@/lib/bookings";
import { isValidDateStr } from "@/lib/time";

const schema = z.object({
  boatId: z.string().min(1),
  rateId: z.string().min(1),
  date: z.string().refine(isValidDateStr, "Invalid date"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  partySize: z.number().int().min(1).max(50),
  customer: z.object({
    firstName: z.string().trim().min(1, "First name is required").max(60),
    lastName: z.string().trim().min(1, "Last name is required").max(60),
    email: z.string().trim().email("Enter a valid email"),
    phone: z.string().trim().min(7, "Enter a valid phone number").max(30),
  }),
  addOns: z.array(z.object({ addOnId: z.string(), quantity: z.number().int().min(0).max(20) })).default([]),
  customerNotes: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  try {
    const booking = await createBooking({ ...parsed.data, source: "online" });
    const needsSignature = (await missingPrimarySignatures(booking.id)).length > 0;
    return NextResponse.json({
      token: booking.accessToken,
      next: needsSignature ? `/b/${booking.accessToken}/sign` : `/b/${booking.accessToken}`,
    });
  } catch (e) {
    if (e instanceof BookingError) return NextResponse.json({ error: e.message }, { status: 409 });
    console.error(e);
    return NextResponse.json({ error: "Something went wrong. Please try again or call us." }, { status: 500 });
  }
}

"use server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { appUrl, emailLayout, sendMail } from "@/lib/mail";
import { fmtRange } from "@/lib/time";
import { signedCopyUrl } from "@/lib/signatures";

/** Emails the customer links to all their bookings and signed agreements. Never reveals whether the email exists. */
export async function emailMyBookings(f: FormData) {
  const email = String(f.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect("/my-bookings?err=1");
  const customer = await prisma.customer.findUnique({
    where: { email },
    include: {
      bookings: {
        where: { status: { not: "cancelled" } },
        orderBy: { startsAt: "desc" },
        take: 25,
        include: { boat: true, signatures: { where: { isPrimary: true }, include: { template: true } } },
      },
    },
  });
  if (customer && customer.bookings.length) {
    const rows: string[] = [];
    for (const b of customer.bookings) {
      const docs = await Promise.all(b.signatures.map(async (s) => `<a href="${await signedCopyUrl(s.id)}">${s.template.name}</a>`));
      rows.push(
        `<li style="margin-bottom:10px"><a href="${await appUrl(`/b/${b.accessToken}`)}"><b>${b.boat.name}</b>, ${fmtRange(b.startsAt, b.endsAt)}</a> · ${b.code}${
          docs.length ? `<br><span style="font-size:13px">Signed: ${docs.join(", ")}</span>` : ""
        }</li>`,
      );
    }
    await sendMail({
      to: customer.email,
      subject: "Your Port A Boat Rentals bookings",
      html: emailLayout("Your bookings", `<p>Hi ${customer.firstName}, here are your bookings and signed agreements:</p><ul>${rows.join("")}</ul>`),
    });
  }
  redirect("/my-bookings?sent=1");
}

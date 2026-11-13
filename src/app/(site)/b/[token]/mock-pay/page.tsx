import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { isMockPayments, recordRentalPayment } from "@/lib/payments";
import { fmtMoney } from "@/lib/money";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

async function pay(formData: FormData) {
  "use server";
  if (!isMockPayments()) throw new Error("Mock payments are disabled");
  const token = String(formData.get("token"));
  const b = await prisma.booking.findUnique({ where: { accessToken: token } });
  if (!b) redirect("/");
  const balance = b.totalCents - b.paidCents;
  if (balance > 0) await recordRentalPayment(b.id, balance, "mock", null, null, "customer", "Test-mode payment");
  redirect(`/b/${token}`);
}

export default async function MockPay({ params }: { params: Promise<{ token: string }> }) {
  if (!isMockPayments()) notFound();
  const { token } = await params;
  const b = await prisma.booking.findUnique({ where: { accessToken: token }, include: { boat: true } });
  if (!b) notFound();
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-12">
      <Notice tone="warn">
        <b>Test payment mode.</b> Stripe isn&apos;t connected yet (no STRIPE_SECRET_KEY), so no card will be charged.
      </Notice>
      <form action={pay} className="card card-pad space-y-4 text-center">
        <input type="hidden" name="token" value={token} />
        <div className="text-lg font-semibold">{b.boat.name}</div>
        <div className="text-3xl font-bold">{fmtMoney(b.totalCents - b.paidCents)}</div>
        <button className="btn-primary w-full py-3">Simulate successful payment</button>
      </form>
    </div>
  );
}

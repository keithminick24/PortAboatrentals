import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { missingPrimarySignatures } from "@/lib/bookings";
import { fmtRange } from "@/lib/time";
import SignContractForm from "@/components/SignContractForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign your rental agreement", robots: { index: false } };

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await prisma.booking.findUnique({ where: { accessToken: token }, include: { customer: true, boat: true } });
  if (!b) notFound();
  const missing = await missingPrimarySignatures(b.id);
  if (missing.length === 0 || b.status === "cancelled") redirect(`/b/${token}`);
  const t = missing[0];
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <div>
        <div className="muted">Step 1 of 2 · {b.code}</div>
        <h1 className="h1">Sign your rental agreement</h1>
        <div className="text-slate-600">{b.boat.name} · {fmtRange(b.startsAt, b.endsAt)}</div>
      </div>
      <SignContractForm
        endpoint={`/api/b/${token}/sign`}
        templateId={t.id}
        templateName={t.name}
        body={t.body}
        defaultName={`${b.customer.firstName} ${b.customer.lastName}`}
        defaultEmail={b.customer.email}
        primary
        redirectTo={missing.length > 1 ? `/b/${token}/sign` : `/b/${token}`}
      />
    </div>
  );
}

import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { activeTemplates } from "@/lib/bookings";
import { fmtRange } from "@/lib/time";
import SignContractForm from "@/components/SignContractForm";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Passenger waiver", robots: { index: false } };

export default async function PassengerWaiver({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await prisma.booking.findUnique({ where: { waiverToken: token }, include: { boat: true, customer: true } });
  if (!b) notFound();
  const templates = await activeTemplates();
  const t = templates.find((x) => x.signer === "all");
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <div>
        <h1 className="h1">Passenger waiver</h1>
        <div className="text-slate-600">
          {b.customer.firstName}&apos;s group · {b.boat.name} · {fmtRange(b.startsAt, b.endsAt)}
        </div>
      </div>
      {b.status === "cancelled" ? (
        <Notice tone="warn">This booking has been cancelled.</Notice>
      ) : !t ? (
        <Notice>No waiver is required. See you on the water!</Notice>
      ) : (
        <>
          <p className="muted">Every guest signs: adults 18+ for themselves, and a parent or legal guardian for each child under 18 (one waiver per child).</p>
          <SignContractForm
            endpoint={`/api/w/${token}/sign`}
            templateId={t.id}
            templateName={t.name}
            body={t.body}
            primary={false}
            redirectTo="stay"
          />
        </>
      )}
    </div>
  );
}

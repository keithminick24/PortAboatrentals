import Link from "next/link";
import { notFound } from "next/navigation";
import { getSettings, prisma } from "@/lib/db";
import { localTime, todayLocal } from "@/lib/time";
import { Notice } from "@/components/ui";
import IncidentForm from "@/components/IncidentForm";
import { createGuestIncident } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Report a problem", robots: { index: false } };

export default async function ReportProblem({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const b = await prisma.booking.findUnique({ where: { accessToken: token }, include: { boat: true, customer: true } });
  if (!b) notFound();
  const settings = await getSettings();
  const tel = `tel:${settings.phone.replace(/[^\d+]/g, "")}`;

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-8">
      <div>
        <h1 className="h1">Report a problem or accident</h1>
        <p className="muted mt-1">{b.boat.name} · booking #{b.code}</p>
      </div>
      <Notice tone="warn">
        <b>Emergency?</b> Call 911 or the Coast Guard on VHF channel 16 first. Then call us at{" "}
        <a href={tel} className="font-semibold underline">{settings.phone}</a>.
      </Notice>
      {sp.msg ? (
        <div className="card card-pad space-y-3">
          <Notice tone="success">{sp.msg}</Notice>
          <p className="text-sm">We&apos;ve let our team know and someone will reach out soon. If you need us right away, call {settings.phone}.</p>
          <Link href={`/b/${token}`} className="btn-secondary">Back to my booking</Link>
        </div>
      ) : (
        <IncidentForm
          mode="guest"
          action={createGuestIncident.bind(null, token)}
          uploadUrl={`/api/r/${token}/photos`}
          doneHref={`/r/${token}`}
          defaults={{
            date: todayLocal(),
            time: localTime(new Date()),
            name: `${b.customer.firstName} ${b.customer.lastName}`.trim(),
            phone: b.customer.phone,
          }}
        />
      )}
    </div>
  );
}

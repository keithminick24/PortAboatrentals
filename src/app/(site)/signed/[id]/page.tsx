import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifySignedCopyKey } from "@/lib/signatures";
import { fmtDateTime, fmtRange } from "@/lib/time";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Signed agreement", robots: { index: false } };

/** A signer's copy of exactly what they signed. Reached by the private link in their email or booking page. */
export default async function SignedCopy({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ k?: string }> }) {
  const { id } = await params;
  const { k } = await searchParams;
  if (!verifySignedCopyKey(id, k)) notFound();
  const s = await prisma.signature.findUnique({ where: { id }, include: { template: true, booking: { include: { boat: true } } } });
  if (!s) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="muted">Signed copy · Booking {s.booking.code}</div>
          <h1 className="h1">{s.template.name}</h1>
          <div className="text-slate-600">{s.booking.boat.name} · {fmtRange(s.booking.startsAt, s.booking.endsAt)}</div>
        </div>
        <PrintButton />
      </div>
      <div className="card card-pad space-y-4">
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{s.bodySnapshot}</div>
        <hr />
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="muted inline">Signed by: </dt><dd className="inline font-medium">{s.signerName}</dd></div>
          <div><dt className="muted inline">Role: </dt><dd className="inline">{s.isPrimary ? "Renter / operator" : s.minorName ? `Parent/guardian (${s.guardianRelationship})` : "Passenger"}</dd></div>
          {s.minorName && <div><dt className="muted inline">On behalf of minor: </dt><dd className="inline font-medium">{s.minorName}{s.minorDob ? ` (born ${s.minorDob})` : ""}</dd></div>}
          {s.dateOfBirth && <div><dt className="muted inline">Signer date of birth: </dt><dd className="inline">{s.dateOfBirth}</dd></div>}
          {s.boaterEdNumber && <div><dt className="muted inline">Boater education #: </dt><dd className="inline">{s.boaterEdNumber}</dd></div>}
          <div><dt className="muted inline">Signed: </dt><dd className="inline">{fmtDateTime(s.signedAt)}</dd></div>
          <div><dt className="muted inline">Version: </dt><dd className="inline">{s.template.version}</dd></div>
        </dl>
        <div>
          <div className="muted mb-1 text-sm">Signature</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={s.signatureData} alt="Signature" className="h-28 rounded border border-slate-200 bg-white" />
        </div>
        <p className="break-all text-xs text-slate-500">Document fingerprint (SHA-256): {s.bodyHash}. This matches the exact text shown above.</p>
      </div>
    </div>
  );
}

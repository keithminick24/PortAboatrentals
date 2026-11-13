import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSettings, prisma } from "@/lib/db";
import { bookingWithAll, canCustomerCancel, logEvent, missingPrimarySignatures } from "@/lib/bookings";
import { finalizeCheckoutSession, isMockPayments, refundPayment, releaseDeposit } from "@/lib/payments";
import { fmtMoney } from "@/lib/money";
import { fmtDateTime, fmtRange } from "@/lib/time";
import { appUrl, emailLayout, sendMail } from "@/lib/mail";
import { Notice, StatusBadge } from "@/components/ui";
import ShareWaiver from "@/components/ShareWaiver";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your booking", robots: { index: false } };

async function cancelAction(formData: FormData) {
  "use server";
  const token = String(formData.get("token"));
  const settings = await getSettings();
  const b = await prisma.booking.findUnique({ where: { accessToken: token }, include: { customer: true, boat: true } });
  if (!b || !canCustomerCancel(b, settings.cancelWindowHours)) redirect(`/b/${token}`);
  const refundable = b.paidCents - b.refundedCents;
  if (refundable > 0) await refundPayment(b.id, refundable, "Customer cancelled within free-cancellation window", "customer");
  if (b.depositStatus === "held") await releaseDeposit(b.id, "customer");
  await prisma.booking.update({ where: { id: b.id }, data: { status: "cancelled" } });
  await logEvent(b.id, "cancelled", "Cancelled by customer", "customer");
  await sendMail({
    to: b.customer.email,
    subject: `Booking ${b.code} cancelled`,
    html: emailLayout(
      "Your booking was cancelled",
      `<p>Your ${b.boat.name} booking for ${fmtRange(b.startsAt, b.endsAt)} has been cancelled.${
        refundable > 0 ? ` A refund of ${fmtMoney(refundable)} is on its way to your card (5–10 business days).` : ""
      }</p>`,
    ),
  });
  revalidatePath(`/b/${token}`);
  redirect(`/b/${token}`);
}

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ session_id?: string; taken?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const found = await prisma.booking.findUnique({ where: { accessToken: token }, select: { id: true } });
  if (!found) notFound();

  if (sp.session_id && !isMockPayments()) {
    // Webhook normally handles this; doing it here too makes the confirmation page instant.
    await finalizeCheckoutSession(sp.session_id).catch((e) => console.error(e));
  }

  const b = (await bookingWithAll({ id: found.id }))!;
  const settings = await getSettings();
  const missing = await missingPrimarySignatures(b.id);
  const balance = b.totalCents - b.paidCents;
  const passengerSigs = b.signatures.filter((s) => !s.isPrimary);
  const waiverUrl = await appUrl(`/w/${b.waiverToken}`);
  const cancellable = canCustomerCancel(b, settings.cancelWindowHours);
  const expired = b.status === "pending" && b.holdExpiresAt && b.holdExpiresAt < new Date();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="muted">Confirmation {b.code}</div>
          <h1 className="h1">{b.boat.name}</h1>
          <div className="text-slate-600">{fmtRange(b.startsAt, b.endsAt)}</div>
        </div>
        <StatusBadge status={b.status} />
      </div>

      {sp.taken && <Notice tone="error">Sorry — your reservation hold expired and that time has since been booked. Please choose another time.</Notice>}
      {b.status === "cancelled" && (
        <Notice tone="warn">
          This booking is cancelled. <Link className="underline" href="/book">Make a new booking</Link>.
        </Notice>
      )}
      {["confirmed", "checked_out", "returned", "completed"].includes(b.status) && (
        <Notice tone="success">
          <b>You&apos;re all set!</b> {settings.confirmationNote}
        </Notice>
      )}
      {expired && b.status === "pending" && (
        <Notice tone="warn">Your reservation hold has expired. Finish checkout now and we&apos;ll re-check that your time is still open.</Notice>
      )}

      {b.status !== "cancelled" && (
        <div className="card divide-y divide-slate-100">
          <Step done={missing.length === 0} n={1} title="Sign the rental agreement">
            {missing.length > 0 ? (
              <Link href={`/b/${token}/sign`} className="btn-primary">Review & sign</Link>
            ) : (
              <span className="muted">Signed by {b.signatures.find((s) => s.isPrimary)?.signerName}</span>
            )}
          </Step>
          <Step done={balance <= 0} n={2} title={balance > 0 ? `Pay ${fmtMoney(balance)}` : "Payment"}>
            {balance > 0 ? (
              <form action={`/api/b/${token}/checkout`} method="post">
                <button className="btn-primary" disabled={missing.length > 0}>
                  {isMockPayments() ? "Pay (test mode)" : "Pay securely"}
                </button>
              </form>
            ) : (
              <span className="muted">Paid {fmtMoney(b.paidCents)}</span>
            )}
          </Step>
          <Step done={passengerSigs.length >= b.partySize - 1} n={3} title="Guests sign passenger waivers" optional>
            <div className="space-y-2 text-sm">
              <p>
                Everyone coming on the boat signs their own waiver on their phone. It takes about a minute. Send them this link;
                parents sign for children.
              </p>
              <div className="font-medium">
                {passengerSigs.length} of {Math.max(0, b.partySize - 1)} guests signed
                {passengerSigs.length > 0 && <span className="muted font-normal">: {passengerSigs.map((s) => s.signerName).join(", ")}</span>}
              </div>
              <ShareWaiver url={waiverUrl} boat={b.boat.name} when={fmtRange(b.startsAt, b.endsAt)} />
            </div>
          </Step>
        </div>
      )}

      <div className="card card-pad">
        <h2 className="h2 mb-3">Details</h2>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="muted">Renter</dt>
          <dd>{b.customer.firstName} {b.customer.lastName}</dd>
          <dt className="muted">Package</dt>
          <dd>{b.rate?.label}</dd>
          <dt className="muted">Guests</dt>
          <dd>{b.partySize}</dd>
          {b.addOns.map((a) => (
            <FragmentRow key={a.id} label={`${a.addOn.name} × ${a.quantity}`} value={fmtMoney(a.priceCents * a.quantity)} />
          ))}
          <dt className="muted">Boat rental</dt>
          <dd>{fmtMoney(b.subtotalCents)}</dd>
          {b.fees.filter((f) => f.mode === "included").map((f) => (
            <FragmentRow key={f.id} label={`  includes ${f.name.toLowerCase()}`} value={fmtMoney(f.amountCents)} />
          ))}
          {b.fees.filter((f) => f.mode !== "included").map((f) => (
            <FragmentRow key={f.id} label={f.name} value={fmtMoney(f.amountCents)} />
          ))}
          <dt className="muted">Tax</dt>
          <dd>{fmtMoney(b.taxCents)}</dd>
          {b.convenienceFeeCents > 0 && <FragmentRow label="Card convenience fee" value={fmtMoney(b.convenienceFeeCents)} />}
          <dt className="font-semibold">Total</dt>
          <dd className="font-semibold">{fmtMoney(b.totalCents)}</dd>
          {b.refundedCents > 0 && <FragmentRow label="Refunded" value={fmtMoney(b.refundedCents)} />}
          <dt className="muted">Security deposit</dt>
          <dd>
            {fmtMoney(b.depositCents)}{" "}
            <span className="muted">
              ({b.depositStatus === "held" ? `authorized ${b.depositHeldAt ? fmtDateTime(b.depositHeldAt) : ""}` : b.depositStatus === "released" ? "released" : "authorized ~24 hrs before your trip"})
            </span>
          </dd>
        </dl>
      </div>

      {cancellable && (
        <form action={cancelAction} className="card card-pad flex flex-wrap items-center justify-between gap-3">
          <input type="hidden" name="token" value={token} />
          <div className="text-sm">
            <div className="font-medium">Need to cancel?</div>
            <div className="muted">Free cancellation up to {settings.cancelWindowHours} hours before your trip.</div>
          </div>
          <button className="btn-secondary">Cancel booking</button>
        </form>
      )}

      <p className="muted text-center">
        Questions or need to change your booking? Call {settings.phone}.
      </p>
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="muted">{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function Step({
  n,
  title,
  done,
  optional,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-5">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
            done ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"
          }`}
        >
          {done ? "✓" : n}
        </span>
        <span className="font-medium">
          {title} {optional && <span className="muted">(recommended)</span>}
        </span>
      </div>
      <div>{children}</div>
    </div>
  );
}

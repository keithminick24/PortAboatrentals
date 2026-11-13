import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { activeTemplates, bookingWithAll } from "@/lib/bookings";
import { DEPOSIT_LABELS, FUEL_LEVELS, PAYMENT_LABELS, STATUS_LABELS } from "@/lib/constants";
import { centsToInput, fmtMoney } from "@/lib/money";
import { fmtDateTime, fmtRange, localDate, localTime } from "@/lib/time";
import { appUrl } from "@/lib/mail";
import { isMockPayments } from "@/lib/payments";
import { Notice, Pill, StatusBadge } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import PhotoUploader from "@/components/PhotoUploader";
import CopyButton from "@/components/CopyButton";
import Thread from "@/components/messages/Thread";
import ReplyBox from "@/components/messages/ReplyBox";
import { templates as smsTemplates, toE164 } from "@/lib/messaging";
import { getSettings } from "@/lib/db";
import { ANGLE_LABELS } from "@/lib/constants";
import { resolveFlag } from "@/app/dock/actions";
import { signedCopyUrl } from "@/lib/signatures";
import BookingCrewCard from "@/components/crew/BookingCrewCard";
import BookingIncidents from "@/components/admin/BookingIncidents";
import {
  cancelBookingAction,
  captureDepositAction,
  checkInBoat,
  checkOutBoat,
  completeBooking,
  deletePhotoAction,
  placeDepositAction,
  recordPaymentAction,
  refundAction,
  releaseDepositAction,
  rescheduleBooking,
  resendConfirmationAction,
  saveBookingNotes,
  sendPaymentLinkAction,
  updateBookingStatus,
  sendMessageAction,
} from "../../../actions";

export default async function BookingDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const b = await bookingWithAll({ id });
  if (!b) notFound();
  const templates = await activeTemplates();
  const boats = await prisma.boat.findMany({ where: { status: { not: "retired" } }, orderBy: { sortOrder: "asc" } });

  const required = templates.filter((t) => t.required);
  const primarySigs = b.signatures.filter((s) => s.isPrimary);
  const allSigned = required.every((t) => primarySigs.some((s) => s.template.name === t.name));
  const balance = b.totalCents - b.paidCents;
  const photos = (phase: string) => b.photos.filter((p) => p.phase === phase);
  const canCheckOut = ["confirmed", "pending"].includes(b.status);
  const canCheckIn = b.status === "checked_out";
  const hidden = <input type="hidden" name="id" value={b.id} />;
  const guestPhone = toE164(b.customer.phone);
  const texts = guestPhone
    ? (await prisma.message.findMany({ where: { phone: guestPhone }, orderBy: { createdAt: "desc" }, take: 20 })).reverse()
    : [];
  const settings = await getSettings();
  const tpl = smsTemplates(
    {
      code: b.code,
      boatName: b.boat.name,
      when: fmtRange(b.startsAt, b.endsAt),
      manageUrl: await appUrl(`/b/${b.accessToken}`),
      waiverUrl: await appUrl(`/w/${b.waiverToken}`),
      firstName: b.customer.firstName,
    },
    settings.businessName,
  );
  const copyUrls: Record<string, string> = Object.fromEntries(
    await Promise.all(b.signatures.map(async (s) => [s.id, await signedCopyUrl(s.id)] as const)),
  );
  const flagged = b.damage.filter((d) => d.status === "needs_check");
  const loggedDamage = b.damage.filter((d) => d.status === "confirmed" || d.status === "repaired");

  const checkoutBlocker = !allSigned
    ? "Renter must sign the rental agreement first."
    : balance > 0
      ? "Collect the balance (record payment on the right) first."
      : photos("before").length === 0
        ? "Add at least one before photo first."
        : null;

  return (
    // key forces form inputs to refresh after every server action
    <div className="space-y-6" key={b.updatedAt.getTime()}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="muted">
            <Link href="/admin/bookings" className="hover:underline">Bookings</Link> / <span className="font-mono">{b.code}</span>
          </div>
          <h1 className="h1">{b.customer.firstName} {b.customer.lastName} · {b.boat.name}</h1>
          <div className="text-slate-600">{fmtRange(b.startsAt, b.endsAt)} · {b.rate?.label} · {b.partySize} guests</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <StatusBadge status={b.status} />
            <Pill tone={allSigned ? "green" : "red"}>{allSigned ? "Agreement signed" : "Agreement NOT signed"}</Pill>
            <Pill tone={balance <= 0 ? "green" : "amber"}>{PAYMENT_LABELS[b.paymentStatus]}{balance > 0 ? ` · owes ${fmtMoney(balance)}` : ""}</Pill>
            <Pill tone={b.depositStatus === "held" ? "green" : "slate"}>Deposit: {DEPOSIT_LABELS[b.depositStatus]}</Pill>
            <Pill>Source: {b.source}</Pill>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary btn-sm" href={`tel:${b.customer.phone}`}>📞 {b.customer.phone}</a>
          <a className="btn-secondary btn-sm" href={`sms:${b.customer.phone}`}>💬 Text</a>
          <Link className="btn-secondary btn-sm" href={`/admin/customers/${b.customerId}`}>Customer</Link>
        </div>
      </div>

      <FlashMessage msg={sp.msg} err={sp.err} />
      <BookingIncidents bookingId={b.id} />
      {isMockPayments() && <Notice tone="warn">Test payment mode: deposit holds, captures and refunds are recorded but no card is charged.</Notice>}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ------------------------------------------------ left: operations */}
        <div className="space-y-6 lg:col-span-2">
          {canCheckOut && (
            <form action={checkOutBoat} className="card card-pad space-y-4 border-l-4 border-l-emerald-500">
              {hidden}
              <h2 className="h2">Check out (departure)</h2>
              {!allSigned && <Notice tone="error">The renter hasn&apos;t signed the rental agreement. Have them sign on your device: <a className="underline" href={`/b/${b.accessToken}/sign`} target="_blank">open signing page</a>.</Notice>}
              {balance > 0 && <Notice tone="warn">Balance due: {fmtMoney(balance)}. Collect payment below before departure.</Notice>}
              <div>
                <div className="label">1. Before photos ({photos("before").length})</div>
                <p className="muted mb-2">Walk around the boat: each side, bow, stern, prop, upholstery, any existing scuffs. Include the fuel gauge and engine-hour meter.</p>
                <PhotoUploader bookingId={b.id} phase="before" label="Add before photos" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">2. Fuel level out</label>
                  <select name="fuelOut" className="input" defaultValue="Full">{FUEL_LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
                </div>
                <div>
                  <label className="label">Engine hours out</label>
                  <input name="engineHoursOut" type="number" step="0.1" className="input" defaultValue={b.boat.engineHours || ""} />
                </div>
              </div>
              {b.depositCents > 0 && b.depositStatus !== "held" && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="placeDeposit" defaultChecked />
                  3. Place {fmtMoney(b.depositCents)} deposit hold on saved card now
                </label>
              )}
              <button className="btn-success" disabled={!!checkoutBlocker}>
                ✓ Check out — boat is leaving the dock
              </button>
              {checkoutBlocker && <div className="muted">{checkoutBlocker}</div>}
            </form>
          )}

          {canCheckIn && (
            <form action={checkInBoat} className="card card-pad space-y-4 border-l-4 border-l-violet-500">
              {hidden}
              <h2 className="h2">Check in (return)</h2>
              <div>
                <div className="label">1. After photos ({photos("after").length})</div>
                <p className="muted mb-2">Same angles as departure. Photograph any new damage close-up with the &quot;damage&quot; uploader.</p>
                <div className="flex flex-wrap gap-3">
                  <PhotoUploader bookingId={b.id} phase="after" label="Add after photos" />
                  <PhotoUploader bookingId={b.id} phase="damage" label="Add damage photos" />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">2. Fuel level in</label>
                  <select name="fuelIn" className="input" defaultValue={b.fuelOut ?? "Full"}>{FUEL_LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
                </div>
                <div>
                  <label className="label">Engine hours in</label>
                  <input name="engineHoursIn" type="number" step="0.1" className="input" defaultValue={b.engineHoursOut ?? ""} />
                </div>
              </div>
              <div>
                <label className="label">3. Damage / issues (leave blank if none)</label>
                <textarea name="damageNotes" rows={2} className="input" defaultValue={b.damageNotes} />
              </div>
              <button className="btn-primary" disabled={photos("after").length === 0}>✓ Check in — boat is back</button>
              {photos("after").length === 0 && <div className="muted">Add at least one after photo to enable check-in.</div>}
            </form>
          )}

          {/* Deposit */}
          {b.depositCents > 0 && (
            <div className="card card-pad space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="h2">Security deposit · {fmtMoney(b.depositCents)}</h2>
                <Pill tone={b.depositStatus === "held" ? "green" : "slate"}>{DEPOSIT_LABELS[b.depositStatus]}</Pill>
              </div>
              {b.depositHeldAt && <div className="muted">Hold placed {fmtDateTime(b.depositHeldAt)}. Card holds expire after ~7 days.</div>}
              {b.depositCapturedCents > 0 && <div className="text-sm">Captured: <b>{fmtMoney(b.depositCapturedCents)}</b></div>}
              {["none", "card_saved"].includes(b.depositStatus) && !["cancelled", "completed"].includes(b.status) && (
                <form action={placeDepositAction}>{hidden}<button className="btn-secondary btn-sm">Place hold now</button></form>
              )}
              {b.depositStatus === "held" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <form action={releaseDepositAction} className="rounded-lg border border-slate-200 p-3">
                    {hidden}
                    <div className="mb-2 text-sm">No damage? Release the full hold.</div>
                    <button className="btn-success btn-sm">Release full deposit</button>
                  </form>
                  <form action={captureDepositAction} className="space-y-2 rounded-lg border border-rose-200 p-3">
                    {hidden}
                    <div className="text-sm">Charge for damage / fuel / cleaning / late fee (remainder is released):</div>
                    <input name="amount" placeholder="Amount $" className="input" defaultValue={centsToInput(b.depositCents)} />
                    <input name="reason" placeholder="Reason (required)" className="input" required />
                    <button className="btn-danger btn-sm">Capture</button>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* Photos */}
          <div className="card card-pad space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="h2">Photos ({b.photos.length})</h2>
              <div className="flex flex-wrap gap-2">
                <PhotoUploader bookingId={b.id} phase="before" label="Before" />
                <PhotoUploader bookingId={b.id} phase="after" label="After" />
                <PhotoUploader bookingId={b.id} phase="damage" label="Damage" />
              </div>
            </div>
            {(["before", "after", "damage", "other"] as const).map((phase) =>
              photos(phase).length === 0 ? null : (
                <div key={phase}>
                  <div className="mb-2 text-sm font-semibold capitalize">{phase} ({photos(phase).length})</div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                    {photos(phase).map((p) => (
                      <div key={p.id} className="group relative">
                        <a href={`/api/admin/photos/${p.id}`} target="_blank">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/admin/photos/${p.id}`} alt={`${phase} photo`} className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
                        </a>
                        <div className="mt-0.5 text-[10px] text-slate-500">{p.angle !== "other" ? `${ANGLE_LABELS[p.angle]} · ` : ""}{fmtDateTime(p.createdAt)} · {p.uploadedBy}</div>
                        {p.aiStatus === "pending" && <div className="text-[10px] text-sky-700">Checking for damage…</div>}
                        {p.aiStatus === "done" && p.aiSummary && <div className="text-[10px] text-slate-600" title={p.aiSummary}>🔎 {p.aiSummary.slice(0, 80)}{p.aiSummary.length > 80 ? "…" : ""}</div>}
                        <form action={deletePhotoAction} className="absolute right-1 top-1 hidden group-hover:block">
                          <input type="hidden" name="photoId" value={p.id} />
                          <button className="rounded bg-white/90 px-1.5 text-xs text-rose-600 shadow" title="Delete photo">✕</button>
                        </form>
                      </div>
                    ))}
                  </div>
                </div>
              ),
            )}
            {b.photos.length === 0 && <p className="muted">No photos yet.</p>}
          </div>

          {/* Damage */}
          {(flagged.length > 0 || loggedDamage.length > 0) && (
            <div className="card card-pad space-y-3">
              <h2 className="h2">Damage ({loggedDamage.length} logged{flagged.length ? `, ${flagged.length} to check` : ""})</h2>
              {flagged.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm">
                  <div>
                    <b>⚠ {ANGLE_LABELS[d.angle]}: {d.location}</b> – {d.description}
                    <span className="muted"> ({d.phase === "after" ? "possible new" : "existing"}, {d.severity}{d.confidence != null ? `, ${Math.round(d.confidence * 100)}%` : ""})</span>
                  </div>
                  <div className="flex gap-1">
                    <form action={resolveFlag}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="decision" value="confirm" /><input type="hidden" name="returnTo" value={`/admin/bookings/${b.id}`} /><button className="btn-secondary btn-sm">Confirm</button></form>
                    <form action={resolveFlag}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="decision" value="dismiss" /><input type="hidden" name="returnTo" value={`/admin/bookings/${b.id}`} /><button className="btn-secondary btn-sm">Dismiss</button></form>
                  </div>
                </div>
              ))}
              <ul className="space-y-1 text-sm">
                {loggedDamage.map((d) => (
                  <li key={d.id}>
                    <Pill tone={d.phase === "after" ? "red" : "slate"}>{d.phase === "after" ? "New this trip" : "Existing at check-out"}</Pill>{" "}
                    {ANGLE_LABELS[d.angle]}{d.location ? `, ${d.location}` : ""}: {d.description} <span className="muted">({d.severity} · {d.source === "ai" ? `photo check, confirmed by ${d.reviewedBy}` : d.createdBy})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Signatures */}
          <div className="card card-pad space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="h2">Signed agreements ({b.signatures.length})</h2>
              <div className="flex items-center gap-2 text-xs">
                Guest waiver link: <CopyButton text={await appUrl(`/w/${b.waiverToken}`)} label="Copy link" />
              </div>
            </div>
            {required.filter((t) => !primarySigs.some((s) => s.template.name === t.name)).map((t) => (
              <Notice key={t.id} tone="error">Missing renter signature: {t.name}. <a className="underline" href={`/b/${b.accessToken}/sign`} target="_blank">Sign on this device</a></Notice>
            ))}
            <div className="divide-y divide-slate-100">
              {b.signatures.map((s) => (
                <details key={s.id} className="py-2">
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      <b>{s.minorName ? `${s.minorName}` : s.signerName}</b> {s.isPrimary ? <Pill tone="blue">Renter</Pill> : s.minorName ? <Pill tone="amber">Minor · signed by {s.signerName} ({s.guardianRelationship})</Pill> : <Pill>Passenger</Pill>} · {s.template.name} v{s.template.version}
                    </span>
                    <span className="muted">{fmtDateTime(s.signedAt)}</span>
                  </summary>
                  <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
                    <div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.signatureData} alt="Signature" className="h-24 rounded border border-slate-200 bg-white" />
                      <dl className="mt-2 space-y-0.5 text-xs text-slate-600">
                        {s.dateOfBirth && <div>{s.minorName ? "Guardian DOB" : "DOB"}: {s.dateOfBirth}</div>}
                        {s.minorDob && <div>Child DOB: {s.minorDob}</div>}
                        {s.boaterEdNumber && <div>Boater ed #: {s.boaterEdNumber}</div>}
                        {s.signerEmail && <div>Email: {s.signerEmail}</div>}
                        <div>IP: {s.ipAddress ?? "—"}</div>
                        <div className="break-all">Device: {s.userAgent ?? "—"}</div>
                        <div className="break-all font-mono">SHA-256: {s.bodyHash}</div>
                        <div><a className="text-brand underline" href={copyUrls[s.id]} target="_blank">Open printable copy</a></div>
                      </dl>
                    </div>
                    <div className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs">{s.bodySnapshot}</div>
                  </div>
                </details>
              ))}
            </div>
          </div>

          {/* Activity */}
          <div className="card card-pad">
            <h2 className="h2 mb-3">Activity</h2>
            <ul className="space-y-2 text-sm">
              {b.events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="w-40 shrink-0 text-xs text-slate-500">{fmtDateTime(e.createdAt)}</span>
                  <span>{e.message}{e.actor && <span className="muted"> — {e.actor}</span>}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ------------------------------------------------ right: money & admin */}
        <div className="space-y-6">
          <div className="card card-pad space-y-2 text-sm">
            <h2 className="h2">Charges</h2>
            <Row l={`${b.rate?.label ?? "Rental"}`} r={fmtMoney(b.subtotalCents)} />
            {b.fees.filter((f) => f.mode === "included").map((f) => (
              <Row key={f.id} l={<span className="pl-3 text-xs text-slate-500">incl. {f.name}</span>} r={<span className="text-xs text-slate-500">{fmtMoney(f.amountCents)}</span>} />
            ))}
            {b.addOns.map((a) => <Row key={a.id} l={`${a.addOn.name} × ${a.quantity}`} r={fmtMoney(a.priceCents * a.quantity)} />)}
            {b.fees.filter((f) => f.mode !== "included").map((f) => <Row key={f.id} l={f.name} r={fmtMoney(f.amountCents)} />)}
            {b.fees.length === 0 && b.feesCents > 0 && <Row l="Fees" r={fmtMoney(b.feesCents)} />}
            <Row l="Tax" r={fmtMoney(b.taxCents)} />
            {b.convenienceFeeCents > 0 && <Row l="Card convenience fee" r={fmtMoney(b.convenienceFeeCents)} />}
            <Row l={<b>Total</b>} r={<b>{fmtMoney(b.totalCents)}</b>} />
            <Row l="Paid" r={fmtMoney(b.paidCents)} />
            {b.refundedCents > 0 && <Row l="Refunded" r={`−${fmtMoney(b.refundedCents)}`} />}
            {balance > 0 && <Row l={<b className="text-amber-700">Balance due</b>} r={<b className="text-amber-700">{fmtMoney(balance)}</b>} />}
          </div>

          <div className="card card-pad space-y-3">
            <h2 className="h2">Payment ledger</h2>
            {b.payments.length === 0 && <p className="muted">No transactions yet.</p>}
            <ul className="space-y-1 text-xs">
              {b.payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <span>
                    {p.kind.replace("_", " ")} · {p.method}
                    {p.note && <span className="muted"> · {p.note}</span>}
                    <div className="muted">{fmtDateTime(p.createdAt)}{p.createdBy ? ` · ${p.createdBy}` : ""}</div>
                  </span>
                  <span className={p.kind === "refund" ? "text-rose-600" : ""}>{fmtMoney(p.amountCents)}</span>
                </li>
              ))}
            </ul>
            {balance > 0 && (
              <form action={recordPaymentAction} className="space-y-2 border-t border-slate-100 pt-3">
                {hidden}
                <div className="text-sm font-medium">Record payment received</div>
                <div className="flex gap-2">
                  <input name="amount" className="input" defaultValue={centsToInput(balance)} />
                  <select name="method" className="input w-28"><option value="cash">Cash</option><option value="other">Card terminal</option><option value="check">Check</option></select>
                </div>
                <input name="note" placeholder="Note (optional)" className="input" />
                <button className="btn-secondary btn-sm">Record</button>
              </form>
            )}
            {b.paidCents - b.refundedCents > 0 && (
              <form action={refundAction} className="space-y-2 border-t border-slate-100 pt-3">
                {hidden}
                <div className="text-sm font-medium">Refund</div>
                <input name="amount" className="input" placeholder={`Up to ${fmtMoney(b.paidCents - b.refundedCents)}`} />
                <input name="reason" placeholder="Reason (e.g. weather)" className="input" />
                <button className="btn-secondary btn-sm">Issue refund</button>
              </form>
            )}
          </div>

          <div className="card card-pad space-y-3">
            <h2 className="h2">Customer link</h2>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={await appUrl(`/b/${b.accessToken}`)} label="Copy booking link" />
              <form action={sendPaymentLinkAction}>{hidden}<button className="btn-secondary btn-sm">Email link</button></form>
              {b.status !== "pending" && <form action={resendConfirmationAction}>{hidden}<button className="btn-secondary btn-sm">Resend confirmation</button></form>}
            </div>
            <div className="text-sm">
              <div>{b.customer.email}</div>
              {b.customerNotes && <div className="mt-2 rounded bg-amber-50 p-2 text-xs">Customer note: {b.customerNotes}</div>}
            </div>
          </div>

          <div className="card card-pad space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="h2">Texts</h2>
              {guestPhone && <Link className="text-xs text-brand underline" href={`/admin/messages?phone=${encodeURIComponent(guestPhone)}`}>Open in Messages</Link>}
            </div>
            {guestPhone ? (
              <>
                <div className="flex max-h-80 flex-col-reverse overflow-y-auto"><Thread messages={texts} /></div>
                <ReplyBox
                  action={sendMessageAction}
                  hidden={{ phone: guestPhone, customerId: b.customerId, bookingId: b.id, returnTo: `/admin/bookings/${b.id}` }}
                  templates={tpl}
                />
              </>
            ) : (
              <p className="muted">No valid mobile number on file.</p>
            )}
          </div>

          <BookingCrewCard bookingId={b.id} />
          <form action={saveBookingNotes} className="card card-pad space-y-2">
            {hidden}
            <h2 className="h2">Internal notes</h2>
            <textarea name="internalNotes" rows={3} className="input" defaultValue={b.internalNotes} />
            <button className="btn-secondary btn-sm">Save notes</button>
          </form>

          {b.status === "returned" && (
            <form action={completeBooking} className="card card-pad">
              {hidden}
              <p className="mb-2 text-sm">Deposit settled and photos reviewed? Close out this booking.</p>
              <button className="btn-primary w-full" disabled={b.depositStatus === "held"}>Mark completed</button>
              {b.depositStatus === "held" && <p className="muted mt-1">Release or capture the deposit first.</p>}
            </form>
          )}

          {["pending", "confirmed"].includes(b.status) && (
            <form action={rescheduleBooking} className="card card-pad space-y-2">
              {hidden}
              <h2 className="h2">Reschedule / swap boat</h2>
              <div className="grid grid-cols-2 gap-2">
                <input name="date" type="date" className="input" defaultValue={localDate(b.startsAt)} />
                <input name="startTime" type="time" className="input" defaultValue={localTime(b.startsAt)} />
              </div>
              <select name="boatId" className="input" defaultValue={b.boatId}>
                {boats.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <button className="btn-secondary btn-sm">Move booking</button>
            </form>
          )}

          <div className="card card-pad space-y-3">
            <h2 className="h2">Status</h2>
            <div className="text-sm">Current: <StatusBadge status={b.status} /></div>
            <div className="flex flex-wrap gap-2">
              {["confirmed", "checked_out", "returned", "completed", "no_show"]
                .filter((st) => st !== b.status)
                .map((st) => (
                  <form key={st} action={updateBookingStatus}>
                    {hidden}
                    <input type="hidden" name="status" value={st} />
                    <button className="btn-secondary btn-sm">Set {STATUS_LABELS[st].toLowerCase()}</button>
                  </form>
                ))}
            </div>
            <p className="muted">Manual override — normally status moves automatically with payment, check-out and check-in.</p>
            {b.status !== "cancelled" && (
              <form action={cancelBookingAction} className="space-y-2 border-t border-slate-100 pt-3">
                {hidden}
                <input name="reason" placeholder="Cancellation reason" className="input" />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="refund" defaultChecked /> Refund everything paid</label>
                <button className="btn-danger btn-sm">Cancel booking</button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ l, r }: { l: React.ReactNode; r: React.ReactNode }) {
  return <div className="flex justify-between gap-2"><span>{l}</span><span>{r}</span></div>;
}

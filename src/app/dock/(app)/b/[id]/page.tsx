import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { activeTemplates } from "@/lib/bookings";
import { checkOutReadiness } from "@/lib/operations";
import { isDamageReviewEnabled } from "@/lib/damageReview";
import { ANGLE_LABELS, FUEL_LEVELS, PHOTO_ANGLES, STATUS_LABELS } from "@/lib/constants";
import { fmtMoney } from "@/lib/money";
import { fmtTime } from "@/lib/time";
import FlashMessage from "@/components/FlashMessage";
import DockPhotoGrid, { type GridPhoto } from "@/components/dock/DockPhotoGrid";
import ReviewPoller from "@/components/dock/ReviewPoller";
import TowInfo from "@/components/dock/TowInfo";
import DockTipField from "@/components/crew/DockTipField";
import { dockCheckIn, dockCheckOut, logDamage, resolveFlag } from "../../../actions";

export default async function DockBooking({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const b = await prisma.booking.findUnique({
    where: { id },
    include: {
      boat: true,
      customer: true,
      rate: true,
      photos: { orderBy: { createdAt: "asc" } },
      damage: { orderBy: { createdAt: "asc" } },
      signatures: { include: { template: true } },
    },
  });
  if (!b) notFound();

  const phase: "before" | "after" | null = b.status === "confirmed" ? "before" : b.status === "checked_out" ? "after" : null;
  const flagsByPhoto = new Map<string, number>();
  for (const d of b.damage) if (d.status === "needs_check" && d.photoId) flagsByPhoto.set(d.photoId, (flagsByPhoto.get(d.photoId) ?? 0) + 1);
  const gridPhotos = (p: "before" | "after"): GridPhoto[] =>
    b.photos
      .filter((x) => x.phase === p)
      .map((x) => ({ id: x.id, angle: x.angle, aiStatus: x.aiStatus, aiSummary: x.aiSummary, flags: flagsByPhoto.get(x.id) ?? 0 }));
  const pending = b.photos.filter((p) => p.aiStatus === "pending").length;
  const flags = b.damage.filter((d) => d.status === "needs_check");
  const loggedThisTrip = b.damage.filter((d) => d.status === "confirmed");
  const boatDamage = await prisma.damageReport.findMany({
    where: { boatId: b.boatId, status: "confirmed", NOT: { bookingId: b.id } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const ready = phase === "before" ? await checkOutReadiness(b.id) : null;
  const templates = await activeTemplates();
  const operator = b.signatures.find((s) => s.isPrimary);
  const guestWaivers = b.signatures.filter((s) => !s.isPrimary).length;
  const hasGuestWaiver = templates.some((t) => t.signer === "all");
  const returnTo = `/dock/b/${b.id}`;
  const aiOn = isDamageReviewEnabled();

  return (
    <div className="space-y-4">
      <ReviewPoller bookingId={b.id} pending={pending} flags={flags.length} />
      <Link href="/dock" className="text-sm text-brand">← Today</Link>
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold">{b.boat.name}</h1>
          <span className="text-sm font-semibold text-slate-500">{STATUS_LABELS[b.status] ?? b.status}</span>
        </div>
        <div className="text-slate-700">{b.customer.firstName} {b.customer.lastName} · {b.partySize} guests</div>
        <div className="text-sm text-slate-500">{fmtTime(b.startsAt)} – {fmtTime(b.endsAt)} · {b.rate?.label} · #{b.code}</div>
        <div className="mt-3 flex gap-2">
          <a href={`tel:${b.customer.phone}`} className="btn-secondary flex-1 justify-center">📞 Call</a>
          <a href={`sms:${b.customer.phone}`} className="btn-secondary flex-1 justify-center">💬 Text</a>
        </div>
        <div className="mt-3"><TowInfo boat={b.boat} /></div>
        <Link href={`/dock/incidents/new?bookingId=${b.id}&boatId=${b.boatId}`} className="mt-2 block text-center text-sm font-semibold text-rose-700">⚠ Report incident</Link>
      </div>

      <FlashMessage msg={sp.msg} err={sp.err} />

      {flags.length > 0 && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
          <div className="text-lg font-bold text-amber-900">
            ⚠ {flags.length} spot{flags.length > 1 ? "s" : ""} to check {phase === "after" ? "(possible new damage)" : "(already on the boat?)"}
          </div>
          <p className="text-sm text-amber-900">
            {phase === "after"
              ? "The photo check found differences from the check-out photos. Walk over and look at each one."
              : "Document existing damage now so this guest isn't blamed for it later."}
          </p>
          <div className="mt-3 space-y-3">
            {flags.map((d) => (
              <div key={d.id} className="rounded-lg bg-white p-3 shadow-sm">
                <div className="flex gap-3">
                  {d.photoId && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/admin/photos/${d.photoId}`} alt="" className="h-20 w-24 shrink-0 rounded object-cover" />
                  )}
                  <div className="min-w-0 text-sm">
                    <div className="font-semibold">{ANGLE_LABELS[d.angle]}: {d.location}</div>
                    <div className="text-slate-700">{d.description}</div>
                    <div className="text-xs text-slate-500">{d.severity}{d.confidence != null ? ` · ${Math.round(d.confidence * 100)}% sure` : ""}</div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <form action={resolveFlag}>
                    <input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="decision" value="confirm" />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <button className="w-full rounded-lg bg-rose-600 px-3 py-2.5 text-sm font-semibold text-white">Yes, damage – log it</button>
                  </form>
                  <form action={resolveFlag}>
                    <input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="decision" value="dismiss" />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <button className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold">Not damage</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === "before" && ready && (
        <>
          <Step n={1} title="Before you hand over the keys">
            <Check ok={ready.signed} label="Rental agreement signed" />
            {operator && (
              <div className="ml-7 text-xs text-slate-500">
                Operator: {operator.signerName}
                {operator.dateOfBirth ? ` · DOB ${operator.dateOfBirth}` : ""}
                {operator.boaterEdNumber ? ` · Boater-ed #${operator.boaterEdNumber}` : ""}
              </div>
            )}
            <Check ok={ready.paid} label={ready.paid ? "Paid in full" : `Balance due ${fmtMoney(b.totalCents - b.paidCents)}, send them to the office`} />
            {hasGuestWaiver && <Check ok={guestWaivers >= b.partySize - 1} warn label={`Guest waivers ${guestWaivers}/${Math.max(0, b.partySize - 1)}`} />}
            <Check ok={false} manual label="Check photo ID matches the renter" />
            <Check ok={false} manual label="Safety briefing: life jackets, kill switch, no-go areas, weather" />
          </Step>

          <Step n={2} title="Before photos" note={aiOn ? "Each photo is checked for existing damage automatically." : undefined}>
            <DockPhotoGrid bookingId={b.id} phase="before" angles={PHOTO_ANGLES} photos={gridPhotos("before")} />
          </Step>

          <Step n={3} title="Check out">
            <form action={dockCheckOut} className="space-y-3">
              <input type="hidden" name="id" value={b.id} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Engine hours</label>
                  <input name="engineHoursOut" type="number" step="0.1" inputMode="decimal" className="input text-lg" defaultValue={b.boat.engineHours || ""} required />
                  <div className="mt-1 text-xs text-slate-500">Last: {b.boat.engineHours}</div>
                </div>
                <div>
                  <label className="label">Fuel</label>
                  <select name="fuelOut" className="input text-lg" defaultValue="Full">
                    {FUEL_LEVELS.map((f) => <option key={f}>{f}</option>)}
                  </select>
                </div>
              </div>
              {ready.missingAngles.length > 0 && (
                <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                  <input type="checkbox" name="allowMissingPhotos" className="mt-1" />
                  <span>Check out without {ready.missingAngles.length} photo(s): {ready.missingAngles.map((a) => a.label).join(", ")}</span>
                </label>
              )}
              {b.depositCents > 0 && b.depositStatus !== "held" && (
                <p className="text-xs text-slate-500">A {fmtMoney(b.depositCents)} deposit hold is placed on the guest&apos;s card at check-out.</p>
              )}
              <button
                className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white disabled:opacity-40"
                disabled={!ready.signed || !ready.paid || ready.beforePhotos === 0 || flags.length > 0}
              >
                Check out {b.boat.name}
              </button>
              {flags.length > 0 && <p className="text-center text-xs text-amber-700">Check the flagged spots above first.</p>}
            </form>
          </Step>
        </>
      )}

      {phase === "after" && (
        <>
          <Step n={1} title="After photos" note={aiOn ? "Each photo is compared with its check-out photo to spot new damage." : undefined}>
            <DockPhotoGrid bookingId={b.id} phase="after" angles={PHOTO_ANGLES} photos={gridPhotos("after")} />
          </Step>
          <Step n={2} title="Check in">
            <form action={dockCheckIn} className="space-y-3">
              <input type="hidden" name="id" value={b.id} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Engine hours</label>
                  <input name="engineHoursIn" type="number" step="0.1" inputMode="decimal" className="input text-lg" required min={b.engineHoursOut ?? 0} />
                  <div className="mt-1 text-xs text-slate-500">Out: {b.engineHoursOut ?? "?"}</div>
                </div>
                <div>
                  <label className="label">Fuel</label>
                  <select name="fuelIn" className="input text-lg" defaultValue="3/4">
                    {FUEL_LEVELS.map((f) => <option key={f}>{f}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Notes for the office (optional)</label>
                <textarea name="notes" rows={2} className="input" placeholder="Trash left, late, cleaning needed…" />
              </div>
              <DockTipField booking={b} />
              <button className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white disabled:opacity-40" disabled={flags.length > 0}>
                Check in {b.boat.name}
              </button>
              {flags.length > 0 && <p className="text-center text-xs text-amber-700">Check the flagged spots above first.</p>}
            </form>
          </Step>
        </>
      )}

      {phase === null && (
        <div className="rounded-xl bg-white p-4 shadow-sm text-sm">
          <div className="font-semibold">Trip {STATUS_LABELS[b.status]?.toLowerCase() ?? b.status}</div>
          <div>Engine hours: {b.engineHoursOut ?? "?"} → {b.engineHoursIn ?? "?"}{b.engineHoursIn != null && b.engineHoursOut != null ? ` (${(b.engineHoursIn - b.engineHoursOut).toFixed(1)} hrs)` : ""}</div>
          <div>Fuel: {b.fuelOut ?? "?"} → {b.fuelIn ?? "?"}</div>
        </div>
      )}

      {loggedThisTrip.length > 0 && (
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="mb-2 font-semibold">Damage logged on this trip</div>
          <ul className="space-y-1 text-sm">
            {loggedThisTrip.map((d) => (
              <li key={d.id}>
                <span className={d.phase === "after" ? "font-semibold text-rose-700" : "text-slate-600"}>{d.phase === "after" ? "NEW" : "Existing"}</span> ·{" "}
                {ANGLE_LABELS[d.angle]}{d.location ? `, ${d.location}` : ""}: {d.description} <span className="text-xs text-slate-500">({d.severity})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(phase === "before" || phase === "after") && (
        <details className="rounded-xl bg-white p-4 shadow-sm">
          <summary className="cursor-pointer font-semibold">+ Log damage you found</summary>
          <form action={logDamage} className="mt-3 space-y-3">
            <input type="hidden" name="bookingId" value={b.id} />
            <input type="hidden" name="boatId" value={b.boatId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Where</label>
                <select name="angle" className="input">
                  {PHOTO_ANGLES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="label">How bad</label>
                <select name="severity" className="input"><option value="minor">Minor</option><option value="moderate">Moderate</option><option value="major">Major</option></select>
              </div>
            </div>
            <input name="location" className="input" placeholder="Exact spot, e.g. port pontoon near gate" />
            <textarea name="description" rows={2} className="input" placeholder="What's wrong?" required />
            <p className="text-xs text-slate-500">Take a close-up with the photo tile for that side, then log it here.</p>
            <button className="btn-primary w-full">Log damage</button>
          </form>
        </details>
      )}

      {boatDamage.length > 0 && (
        <details className="rounded-xl bg-white p-4 shadow-sm">
          <summary className="cursor-pointer font-semibold">Known damage on {b.boat.name} ({boatDamage.length})</summary>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {boatDamage.map((d) => (
              <li key={d.id}>{ANGLE_LABELS[d.angle]}{d.location ? `, ${d.location}` : ""}: {d.description} <span className="text-xs text-slate-500">({d.createdAt.toLocaleDateString()})</span></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Step({ n, title, note, children }: { n: number; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{n}</span>
        <h2 className="text-lg font-bold">{title}</h2>
      </div>
      {note && <p className="-mt-2 mb-3 text-xs text-slate-500">{note}</p>}
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Check({ ok, label, warn, manual }: { ok: boolean; label: string; warn?: boolean; manual?: boolean }) {
  const icon = manual ? "☐" : ok ? "✅" : warn ? "⚠️" : "❌";
  return (
    <div className={`flex items-start gap-2 text-sm ${!ok && !manual && !warn ? "font-semibold text-rose-700" : ""}`}>
      <span className="w-5 shrink-0 text-center">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

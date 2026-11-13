import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { centsToInput, fmtMoney } from "@/lib/money";
import { fmtDate, localDate } from "@/lib/time";
import { daysUntil, expiryState, telHref } from "@/lib/incidentRules";
import { Pill } from "@/components/ui";
import { deleteInsurancePolicy, saveInsurancePolicy, saveTowInfo } from "@/app/admin/(panel)/boats/insurance-actions";

type Policy = Awaited<ReturnType<typeof prisma.insurancePolicy.findMany>>[number];

function ExpiryPill({ date }: { date: Date | null }) {
  if (!date) return null;
  const st = expiryState(date);
  if (st === "expired") return <Pill tone="red">Expired {fmtDate(date)}</Pill>;
  if (st === "expiring") return <Pill tone="amber">Expires in {daysUntil(date)} days</Pill>;
  return <Pill tone="green">Good until {fmtDate(date)}</Pill>;
}

const Tel = ({ phone, label }: { phone: string; label: string }) =>
  phone ? <a href={telHref(phone)} className="text-brand hover:underline">📞 {label} {phone}</a> : null;

/** Insurance + towing cards for a boat's edit page. Fetches its own data. */
export default async function BoatInsuranceTow({ boatId }: { boatId: string }) {
  const s = await getSession();
  const edit = can(s?.role, "pricing");
  const boat = await prisma.boat.findUnique({ where: { id: boatId }, include: { insurance: { orderBy: [{ expiresAt: "desc" }, { createdAt: "desc" }] } } });
  if (!boat) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div id="insurance" className="card card-pad space-y-3">
        <h2 className="h2">Insurance</h2>
        {boat.insurance.length === 0 && <p className="muted">No policy on file. Add the boat&apos;s policy so crew and office have claims numbers handy.</p>}
        {boat.insurance.map((p) => (
          <div key={p.id} className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{p.carrier}{p.policyNumber && <span className="font-normal text-slate-600"> · #{p.policyNumber}</span>}</span>
              <ExpiryPill date={p.expiresAt} />
            </div>
            {p.coverage && <div>{p.coverage}</div>}
            <div className="muted">
              {[
                p.hullValueCents != null && `Hull ${fmtMoney(p.hullValueCents)}`,
                p.liabilityLimitCents != null && `Liability ${fmtMoney(p.liabilityLimitCents)}`,
                p.deductibleCents != null && `Deductible ${fmtMoney(p.deductibleCents)}`,
                p.annualPremiumCents != null && `Premium ${fmtMoney(p.annualPremiumCents)}/yr`,
              ].filter(Boolean).join(" · ")}
            </div>
            <div className="muted">
              {p.effectiveDate ? fmtDate(p.effectiveDate) : "?"} → {p.expiresAt ? fmtDate(p.expiresAt) : "?"}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Tel phone={p.claimsPhone} label="Claims" />
              <Tel phone={p.agentPhone} label={p.agentName ? `Agent ${p.agentName}` : "Agent"} />
              {!p.agentPhone && p.agentName && <span>Agent: {p.agentName}</span>}
              {p.agentEmail && <a href={`mailto:${p.agentEmail}`} className="text-brand hover:underline">✉ {p.agentEmail}</a>}
              {p.documentKey && <a href={`/api/admin/insurance/${p.id}/document`} target="_blank" rel="noreferrer" className="text-brand hover:underline">📄 Policy document</a>}
            </div>
            {p.notes && <div className="whitespace-pre-wrap text-slate-600">{p.notes}</div>}
            {edit && (
              <details className="pt-1">
                <summary className="cursor-pointer text-xs text-brand">Edit</summary>
                <PolicyForm boatId={boat.id} p={p} />
                <form action={deleteInsurancePolicy} className="mt-2 text-right">
                  <input type="hidden" name="id" value={p.id} />
                  <button className="text-xs text-rose-600">Delete this policy</button>
                </form>
              </details>
            )}
          </div>
        ))}
        {edit && (
          <details className="rounded-lg border border-dashed border-slate-300 p-3">
            <summary className="cursor-pointer text-sm font-medium text-brand">+ Add policy</summary>
            <PolicyForm boatId={boat.id} />
          </details>
        )}
      </div>

      <div id="towing" className="card card-pad space-y-3">
        <h2 className="h2">Towing / on-water assistance</h2>
        <p className="muted text-xs">Crew see this on the dock app with a tap-to-call button.</p>
        {(boat.towCompany || boat.towPhone) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-semibold">{boat.towCompany}</span>
            <Tel phone={boat.towPhone} label="Call" />
            {boat.towMemberNumber && <span>Member # {boat.towMemberNumber}</span>}
            <ExpiryPill date={boat.towExpiresAt} />
          </div>
        )}
        <form action={saveTowInfo} className="grid gap-2 sm:grid-cols-2">
          <fieldset disabled={!edit} className="contents">
            <input type="hidden" name="boatId" value={boat.id} />
            <div><label className="label text-xs">Company</label><input name="towCompany" className="input" defaultValue={boat.towCompany} placeholder="TowBoatUS, Sea Tow…" /></div>
            <div><label className="label text-xs">Dispatch phone</label><input name="towPhone" type="tel" className="input" defaultValue={boat.towPhone} /></div>
            <div><label className="label text-xs">Member / account #</label><input name="towMemberNumber" className="input" defaultValue={boat.towMemberNumber} /></div>
            <div><label className="label text-xs">Plan</label><input name="towPlan" className="input" defaultValue={boat.towPlan} placeholder="e.g. Commercial / Unlimited" /></div>
            <div><label className="label text-xs">Membership expires</label><input name="towExpiresAt" type="date" className="input" defaultValue={boat.towExpiresAt ? localDate(boat.towExpiresAt) : ""} /></div>
            <div><label className="label text-xs">Notes for crew</label><input name="towNotes" className="input" defaultValue={boat.towNotes} placeholder="VHF 16, give boat name + member #" /></div>
            <label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" name="applyAll" /> Same company, phone, plan &amp; expiry for every boat (fleet membership)</label>
            {edit && <div className="sm:col-span-2"><button className="btn-secondary btn-sm">Save tow info</button></div>}
          </fieldset>
        </form>
      </div>
    </div>
  );
}

function PolicyForm({ boatId, p }: { boatId: string; p?: Policy }) {
  const d = (x: Date | null | undefined) => (x ? localDate(x) : "");
  return (
    <form action={saveInsurancePolicy} className="mt-2 grid gap-2 sm:grid-cols-2">
      <input type="hidden" name="boatId" value={boatId} />
      <input type="hidden" name="id" value={p?.id ?? ""} />
      <div><label className="label text-xs">Insurance company</label><input name="carrier" className="input" required defaultValue={p?.carrier} /></div>
      <div><label className="label text-xs">Policy #</label><input name="policyNumber" className="input" defaultValue={p?.policyNumber} /></div>
      <div className="sm:col-span-2"><label className="label text-xs">Coverage</label><input name="coverage" className="input" defaultValue={p?.coverage} placeholder="Hull & machinery + liability (rental/charter)" /></div>
      <div><label className="label text-xs">Hull value $</label><input name="hullValue" className="input" defaultValue={centsToInput(p?.hullValueCents)} /></div>
      <div><label className="label text-xs">Liability limit $</label><input name="liabilityLimit" className="input" defaultValue={centsToInput(p?.liabilityLimitCents)} /></div>
      <div><label className="label text-xs">Deductible $</label><input name="deductible" className="input" defaultValue={centsToInput(p?.deductibleCents)} /></div>
      <div><label className="label text-xs">Yearly premium $</label><input name="annualPremium" className="input" defaultValue={centsToInput(p?.annualPremiumCents)} /></div>
      <div><label className="label text-xs">Starts</label><input name="effectiveDate" type="date" className="input" defaultValue={d(p?.effectiveDate)} /></div>
      <div><label className="label text-xs">Expires</label><input name="expiresAt" type="date" className="input" defaultValue={d(p?.expiresAt)} /></div>
      <div><label className="label text-xs">Claims phone</label><input name="claimsPhone" type="tel" className="input" defaultValue={p?.claimsPhone} /></div>
      <div><label className="label text-xs">Agent name</label><input name="agentName" className="input" defaultValue={p?.agentName} /></div>
      <div><label className="label text-xs">Agent phone</label><input name="agentPhone" type="tel" className="input" defaultValue={p?.agentPhone} /></div>
      <div><label className="label text-xs">Agent email</label><input name="agentEmail" type="email" className="input" defaultValue={p?.agentEmail} /></div>
      <div className="sm:col-span-2"><label className="label text-xs">Notes</label><textarea name="notes" rows={2} className="input" defaultValue={p?.notes} /></div>
      <div className="sm:col-span-2">
        <label className="label text-xs">Policy document (PDF or photo){p?.documentKey ? ", replaces the current one" : ""}</label>
        <input name="document" type="file" accept="application/pdf,image/*" className="text-sm" />
        {p?.documentKey && <label className="ml-3 inline-flex items-center gap-1 text-xs"><input type="checkbox" name="removeDocument" /> Remove current document</label>}
      </div>
      <div className="sm:col-span-2"><button className="btn-primary btn-sm">{p ? "Save policy" : "Add policy"}</button></div>
    </form>
  );
}

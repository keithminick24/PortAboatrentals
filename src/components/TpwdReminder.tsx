import { TPWD_ACCIDENT_URL, TPWD_PHONE, telHref } from "@/lib/incidentRules";

/** Reminder shown for injuries, collisions, groundings and serious incidents. */
export default function TpwdReminder({ claimsPhone, carrier }: { claimsPhone?: string | null; carrier?: string | null }) {
  return (
    <div className="space-y-2 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-sm text-amber-950">
      <div className="font-bold">A Texas boating accident report may be required</div>
      <p>
        Texas Parks &amp; Wildlife asks the boat operator to report an accident when someone dies, is hurt badly enough to need more
        than first aid, or there is more than $2,000 in damage. Deaths must be reported within 48 hours; the written report is due within 30 days.
        Check TPWD guidance to see if this one applies.
      </p>
      <div className="flex flex-wrap gap-2">
        <a href={TPWD_ACCIDENT_URL} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">TPWD reporting page</a>
        <a href={telHref(TPWD_PHONE)} className="btn-secondary btn-sm">📞 TPWD {TPWD_PHONE}</a>
      </div>
      <p>
        Also let the insurance company know{carrier ? ` (${carrier})` : ""}.
        {claimsPhone && <> <a href={telHref(claimsPhone)} className="font-semibold underline">📞 Claims {claimsPhone}</a></>}
      </p>
    </div>
  );
}

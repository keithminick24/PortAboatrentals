import { expiryState, telHref } from "@/lib/incidentRules";
import { fmtDate } from "@/lib/time";

type TowBoat = { towCompany: string; towPhone: string; towMemberNumber: string; towPlan: string; towExpiresAt: Date | null; towNotes: string };

/** Big tap-to-call tow button for crew. Renders nothing if no tow info is on file. */
export default function TowInfo({ boat }: { boat: TowBoat }) {
  if (!boat.towCompany && !boat.towPhone) return null;
  const state = boat.towExpiresAt ? expiryState(boat.towExpiresAt) : "ok";
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-sky-950">🛟 Tow: {boat.towCompany || "Tow service"}</span>
        {boat.towMemberNumber && <span className="text-sky-900">Member # <b className="select-all">{boat.towMemberNumber}</b></span>}
      </div>
      {(boat.towPlan || boat.towNotes) && <div className="text-xs text-sky-900">{[boat.towPlan, boat.towNotes].filter(Boolean).join(" · ")}</div>}
      {state === "expired" && <div className="text-xs font-semibold text-rose-700">Membership expired {fmtDate(boat.towExpiresAt!)}. Tell the office.</div>}
      {boat.towPhone && (
        <a href={telHref(boat.towPhone)} className="btn-primary mt-2 w-full justify-center py-3 text-base">📞 Call tow {boat.towPhone}</a>
      )}
    </div>
  );
}

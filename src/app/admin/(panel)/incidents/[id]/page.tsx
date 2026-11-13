import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/time";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_STATUS_LABELS,
  INCIDENT_TYPE_LABELS,
  needsTpwdReminder,
  severityTone,
  statusTone,
  telHref,
} from "@/lib/incidentRules";
import { PageHeader, Pill } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import TpwdReminder from "@/components/TpwdReminder";
import { deleteIncidentPhoto, editIncidentDetails, updateIncident } from "../actions";

export default async function IncidentDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireAdmin();
  const i = await prisma.incident.findUnique({
    where: { id },
    include: {
      photos: { orderBy: { createdAt: "asc" } },
      boat: { include: { insurance: { orderBy: { expiresAt: "desc" } } } },
      booking: { include: { customer: true } },
    },
  });
  if (!i) notFound();
  const boats = await prisma.boat.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const manage = can(me.role, "incidents");
  const policy = i.boat?.insurance.find((p) => p.claimsPhone) ?? i.boat?.insurance[0];

  const rows: [string, React.ReactNode][] = [
    ["When", fmtDateTime(i.occurredAt)],
    ["Where", i.location || "—"],
    ["Boat", i.boat ? <Link href={`/admin/boats/${i.boat.id}`} className="text-brand hover:underline">{i.boat.name}</Link> : "—"],
    [
      "Trip",
      i.booking ? (
        <Link href={`/admin/bookings/${i.booking.id}`} className="text-brand hover:underline">
          #{i.booking.code} · {i.booking.customer.firstName} {i.booking.customer.lastName}
        </Link>
      ) : "—",
    ],
    [
      "Reported by",
      <>
        {i.reporterType === "guest" ? "Guest" : "Crew"}: {i.reporterName}
        {i.reporterPhone && <> · <a href={telHref(i.reporterPhone)} className="text-brand">{i.reporterPhone}</a></>}
        <span className="muted"> · filed {fmtDateTime(i.createdAt)}</span>
      </>,
    ],
    ["Injuries", i.injuries ? <b className="text-rose-700">Yes</b> : "No"],
    ["EMS called", i.emsCalled ? "Yes" : "No"],
    ["People involved", i.peopleInvolved || "—"],
    ["Witnesses", i.witnesses || "—"],
    ["Authorities notified", i.authoritiesNotified || "—"],
    ["Actions taken", i.actionsTaken || "—"],
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <Link href="/admin/incidents" className="text-sm text-brand">← Incidents</Link>
      <PageHeader
        title={`${INCIDENT_TYPE_LABELS[i.type] ?? i.type}${i.boat ? ` · ${i.boat.name}` : ""}`}
        subtitle={
          <span className="flex flex-wrap gap-2">
            <Pill tone={statusTone(i.status)}>{INCIDENT_STATUS_LABELS[i.status] ?? i.status}</Pill>
            <Pill tone={severityTone(i.severity)}>Severity: {i.severity}</Pill>
          </span>
        }
      />
      <FlashMessage msg={sp.msg} err={sp.err} />
      {needsTpwdReminder(i) && <TpwdReminder claimsPhone={policy?.claimsPhone} carrier={policy?.carrier} />}

      <div className="card card-pad space-y-4">
        <div>
          <h2 className="h2 mb-1">What happened</h2>
          <p className="whitespace-pre-wrap text-sm">{i.description}</p>
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-medium text-slate-500">{k}</dt>
              <dd className="whitespace-pre-wrap">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="card card-pad">
        <h2 className="h2 mb-3">Photos ({i.photos.length})</h2>
        {i.photos.length === 0 && <p className="muted">No photos.</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {i.photos.map((p) => (
            <div key={p.id} className="space-y-1">
              <a href={`/api/admin/incidents/photos/${p.id}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/admin/incidents/photos/${p.id}`} alt="Incident photo" className="aspect-square w-full rounded-lg object-cover" />
              </a>
              {manage && (
                <form action={deleteIncidentPhoto}>
                  <input type="hidden" name="photoId" value={p.id} />
                  <button className="text-xs text-rose-700">Delete</button>
                </form>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card card-pad space-y-3">
        <h2 className="h2">Follow-up</h2>
        {i.followUp ? <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm">{i.followUp}</pre> : <p className="muted">No notes yet.</p>}
        {manage ? (
          <form action={updateIncident} className="space-y-2">
            <input type="hidden" name="id" value={i.id} />
            <textarea name="note" rows={3} className="input" placeholder="Called the guest, filed TPWD report, sent to insurance, repair booked…" />
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="label">Status</label>
                <select name="status" className="input" defaultValue={i.status}>
                  {INCIDENT_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
              <button className="btn-primary">Save</button>
            </div>
          </form>
        ) : (
          <p className="muted text-sm">A manager or admin can update the status and add notes.</p>
        )}
      </div>

      {manage && (
        <details className="card card-pad">
          <summary className="cursor-pointer font-semibold">Correct details</summary>
          <form action={editIncidentDetails} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={i.id} />
            <div>
              <label className="label">Severity</label>
              <select name="severity" className="input" defaultValue={i.severity}>
                {INCIDENT_SEVERITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Boat</label>
              <select name="boatId" className="input" defaultValue={i.boatId ?? ""}>
                <option value="">None</option>
                {boats.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2"><label className="label">Authorities notified</label><input name="authoritiesNotified" className="input" defaultValue={i.authoritiesNotified} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="injuries" defaultChecked={i.injuries} /> Injuries</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="emsCalled" defaultChecked={i.emsCalled} /> EMS called</label>
            <div className="sm:col-span-2"><button className="btn-secondary">Save details</button></div>
          </form>
        </details>
      )}
    </div>
  );
}

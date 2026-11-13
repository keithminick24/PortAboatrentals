"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { shrink } from "@/lib/shrinkImage";
import { GUEST_INCIDENT_TYPES, INCIDENT_SEVERITIES } from "@/lib/incidentRules";
import { INCIDENT_TYPES } from "@/lib/constants";

export type IncidentResult = { id?: string; error?: string };
type Option = { id: string; label: string; boatId?: string };

/**
 * Incident report form for crew (mode="crew") and guests (mode="guest").
 * Saves the report through `action`, then uploads photos one at a time to `uploadUrl`.
 */
export default function IncidentForm({
  mode,
  action,
  uploadUrl,
  doneHref,
  bookings = [],
  boats = [],
  defaults,
}: {
  mode: "crew" | "guest";
  action: (f: FormData) => Promise<IncidentResult>;
  uploadUrl: string;
  doneHref: string;
  bookings?: Option[];
  boats?: Option[];
  defaults: { date: string; time: string; bookingId?: string; boatId?: string; name?: string; phone?: string };
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boatId, setBoatId] = useState(defaults.boatId ?? "");
  const guest = mode === "guest";
  const maxPhotos = guest ? 8 : 20;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStatus("Saving report…");
    try {
      const res = await action(new FormData(e.currentTarget));
      if (res.error || !res.id) throw new Error(res.error || "Could not save the report");
      let failed = 0;
      for (let n = 0; n < files.length; n++) {
        setStatus(`Uploading photo ${n + 1} of ${files.length}…`);
        const form = new FormData();
        form.set("incidentId", res.id);
        form.append("files", await shrink(files[n]));
        const up = await fetch(uploadUrl, { method: "POST", body: form }).catch(() => null);
        if (!up || !up.ok) failed++;
      }
      const msg = failed ? `Report sent, but ${failed} photo(s) didn't upload.` : "Report sent. Thank you.";
      router.push(`${doneHref}${doneHref.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStatus(null);
      setBusy(false);
    }
  }

  const types = guest ? GUEST_INCIDENT_TYPES : INCIDENT_TYPES;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className={guest ? "card card-pad space-y-3" : "space-y-3 rounded-xl bg-white p-4 shadow-sm"}>
        <div>
          <label className="label">What happened?</label>
          <select name="type" className="input" required defaultValue="">
            <option value="" disabled>Pick one</option>
            {types.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        {!guest && (
          <div>
            <label className="label">How serious?</label>
            <select name="severity" className="input" defaultValue="low">
              {INCIDENT_SEVERITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Date</label><input name="date" type="date" className="input" defaultValue={defaults.date} required /></div>
          <div><label className="label">About what time</label><input name="time" type="time" className="input" defaultValue={defaults.time} required /></div>
        </div>
        <div>
          <label className="label">Where</label>
          <input name="location" className="input" placeholder={guest ? "e.g. near the jetties, at the dock" : "e.g. Lydia Ann Channel, our dock, fuel dock"} />
        </div>
        <div>
          <label className="label">Tell us what happened</label>
          <textarea name="description" rows={4} className="input" required placeholder="What happened, in your own words" />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="injuries" className="h-5 w-5" /> Someone was hurt</label>
        {!guest && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="emsCalled" className="h-5 w-5" /> EMS / 911 was called</label>}
      </div>

      {!guest && (
        <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
          <div>
            <label className="label">Trip (optional)</label>
            <select
              name="bookingId"
              className="input"
              defaultValue={defaults.bookingId ?? ""}
              onChange={(e) => {
                const b = bookings.find((x) => x.id === e.target.value);
                if (b?.boatId) setBoatId(b.boatId);
              }}
            >
              <option value="">Not tied to a trip</option>
              {bookings.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Boat (optional)</label>
            <select name="boatId" className="input" value={boatId} onChange={(e) => setBoatId(e.target.value)}>
              <option value="">No boat / not sure</option>
              {boats.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>
          <div><label className="label">People involved</label><textarea name="peopleInvolved" rows={2} className="input" placeholder="Names, phone numbers, boat numbers" /></div>
          <div><label className="label">Witnesses</label><textarea name="witnesses" rows={2} className="input" placeholder="Names and phone numbers" /></div>
          <div><label className="label">Who was notified?</label><input name="authoritiesNotified" className="input" placeholder="e.g. Coast Guard, game warden, police" /></div>
          <div><label className="label">What we did about it</label><textarea name="actionsTaken" rows={2} className="input" placeholder="First aid, towed in, swapped boats…" /></div>
        </div>
      )}

      {guest && (
        <div className="card card-pad space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div><label className="label">Your name</label><input name="reporterName" className="input" defaultValue={defaults.name} required /></div>
            <div><label className="label">Best phone</label><input name="reporterPhone" type="tel" className="input" defaultValue={defaults.phone} /></div>
          </div>
          <div><label className="label">Anyone else involved? (optional)</label><textarea name="peopleInvolved" rows={2} className="input" placeholder="Names, other boat, phone numbers" /></div>
        </div>
      )}

      <div className={guest ? "card card-pad space-y-2" : "space-y-2 rounded-xl bg-white p-4 shadow-sm"}>
        <div className="label">Photos (optional)</div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            setFiles((prev) => [...prev, ...picked].slice(0, maxPhotos));
            if (fileInput.current) fileInput.current.value = "";
          }}
        />
        <button type="button" className="btn-secondary w-full justify-center" onClick={() => fileInput.current?.click()} disabled={busy || files.length >= maxPhotos}>
          📷 Add photos
        </button>
        {files.length > 0 && (
          <ul className="space-y-1 text-sm">
            {files.map((f, n) => (
              <li key={n} className="flex items-center justify-between gap-2">
                <span className="truncate">{f.name}</span>
                <button type="button" className="text-xs text-rose-700" onClick={() => setFiles(files.filter((_, k) => k !== n))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-500">Up to {maxPhotos} photos.</p>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>}
      <button className="btn-primary w-full justify-center py-3 text-base" disabled={busy}>{busy ? status ?? "Sending…" : "Send report"}</button>
    </form>
  );
}

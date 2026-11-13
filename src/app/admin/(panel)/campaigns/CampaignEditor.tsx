"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MERGE_TAGS, TRIGGER_LABELS, describeTiming, hoursFromTiming, renderTemplate, timingFromHours, type MergeData, type Segment } from "@/lib/campaignLogic";
import { countAudience, saveCampaign, sendTestCampaign } from "./actions";

type C = {
  id: string;
  name: string;
  kind: string;
  trigger: string;
  offsetHours: number;
  channel: string;
  subject: string;
  body: string;
  isMarketing: boolean;
  active: boolean;
  segment: Segment;
};

export default function CampaignEditor({ campaign, sample, sampleLabel }: { campaign: C; sample: MergeData; sampleLabel: string }) {
  const [kind, setKind] = useState(campaign.kind);
  const [trigger, setTrigger] = useState(campaign.kind === "broadcast" ? "manual" : campaign.trigger);
  const initial = campaign.trigger === "win_back" ? { value: Math.round(campaign.offsetHours / 24), unit: "days" as const } : timingFromHours(campaign.offsetHours);
  const [timingValue, setTimingValue] = useState(String(initial.value));
  const [timingUnit, setTimingUnit] = useState<"hours" | "days">(initial.unit);
  const [channel, setChannel] = useState(campaign.channel);
  const [subject, setSubject] = useState(campaign.subject);
  const [body, setBody] = useState(campaign.body);
  const [isMarketing, setIsMarketing] = useState(campaign.isMarketing);
  const [segTags, setSegTags] = useState((campaign.segment.tags ?? []).join(", "));
  const [segMinTrips, setSegMinTrips] = useState(campaign.segment.minTrips ? String(campaign.segment.minTrips) : "");
  const [segWithin, setSegWithin] = useState(campaign.segment.lastTripWithinDays ? String(campaign.segment.lastTripWithinDays) : "");
  const [segFuture, setSegFuture] = useState(campaign.segment.hasFutureBooking === undefined ? "any" : campaign.segment.hasFutureBooking ? "yes" : "no");
  const [audience, setAudience] = useState<number | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const isBroadcast = kind === "broadcast";
  const effTrigger = isBroadcast ? "manual" : trigger === "manual" ? "before_trip" : trigger;
  const unit = effTrigger === "win_back" ? "days" : timingUnit;

  const segmentJson = useMemo(() => {
    const seg: Segment = {};
    const tags = segTags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (tags.length) seg.tags = tags;
    if (Number(segMinTrips) > 0) seg.minTrips = Math.floor(Number(segMinTrips));
    if (Number(segWithin) > 0) seg.lastTripWithinDays = Math.floor(Number(segWithin));
    if (segFuture !== "any") seg.hasFutureBooking = segFuture === "yes";
    return JSON.stringify(seg);
  }, [segTags, segMinTrips, segWithin, segFuture]);

  useEffect(() => {
    if (!isBroadcast) return;
    let live = true;
    const t = setTimeout(() => {
      countAudience(segmentJson, isMarketing).then((n) => live && setAudience(n)).catch(() => live && setAudience(null));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [segmentJson, isMarketing, isBroadcast]);

  function insertTag(tag: string) {
    const el = bodyRef.current;
    const token = `{{${tag}}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const preview = renderTemplate(body, sample);
  const previewSubject = renderTemplate(subject || "(no subject)", sample);
  const hasEmail = channel !== "sms";
  const hasSms = channel !== "email";

  return (
    <form action={saveCampaign} className="grid gap-6 lg:grid-cols-5">
      <input type="hidden" name="id" value={campaign.id} />
      <input type="hidden" name="kind" value={kind} />
      <div className="card card-pad space-y-4 lg:col-span-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Name (only staff see this)</label>
            <input name="name" className="input" defaultValue={campaign.name} placeholder="e.g. Pre-arrival email" required />
          </div>
          <div>
            <label className="label">Type</label>
            <div className="flex gap-2">
              {[
                { k: "automation", l: "Automatic" },
                { k: "broadcast", l: "One-time blast" },
              ].map((o) => (
                <button type="button" key={o.k} onClick={() => setKind(o.k)} className={`btn-sm flex-1 ${kind === o.k ? "btn-primary" : "btn-secondary"}`}>
                  {o.l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Send by</label>
            <select name="channel" className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="sms">Text</option>
              <option value="email">Email</option>
              <option value="both">Text and email</option>
            </select>
          </div>
        </div>

        {!isBroadcast && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <label className="label">When to send</label>
            <div className="flex flex-wrap items-center gap-2">
              <input name="timingValue" type="number" min="0" className="input w-24" value={timingValue} onChange={(e) => setTimingValue(e.target.value)} />
              {effTrigger === "win_back" ? (
                <>
                  <input type="hidden" name="timingUnit" value="days" />
                  <span className="text-sm">days</span>
                </>
              ) : (
                <select name="timingUnit" className="input w-28" value={timingUnit} onChange={(e) => setTimingUnit(e.target.value as "hours" | "days")}>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
              )}
              <select name="trigger" className="input w-auto" value={effTrigger} onChange={(e) => setTrigger(e.target.value)}>
                <option value="before_trip">before the trip</option>
                <option value="after_trip">after the trip ends</option>
                <option value="after_booking">after they book</option>
                <option value="win_back">after their last trip (win-back)</option>
              </select>
            </div>
            <p className="muted mt-2 text-xs">
              Sends {describeTiming(effTrigger, hoursFromTiming(Number(timingValue) || 0, unit))}.{" "}
              {effTrigger === "win_back" && "Only to guests with no upcoming booking."}
            </p>
          </div>
        )}
        {isBroadcast && <input type="hidden" name="trigger" value="manual" />}

        {hasEmail && (
          <div>
            <label className="label">Email subject</label>
            <input name="subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Your boat day is almost here!" />
          </div>
        )}
        {!hasEmail && <input type="hidden" name="subject" value={subject} />}

        <div>
          <label className="label">Message</label>
          <div className="mb-2 flex flex-wrap gap-1">
            {MERGE_TAGS.map((t) => (
              <button type="button" key={t.tag} onClick={() => insertTag(t.tag)} className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100" title={`Insert {{${t.tag}}}`}>
                + {t.label}
              </button>
            ))}
          </div>
          <textarea ref={bodyRef} name="body" rows={10} className="input font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} />
          {hasSms && <p className="muted mt-1 text-xs">{preview.length} characters{preview.length > 160 ? ` (about ${Math.ceil(preview.length / 153)} text segments)` : ""}</p>}
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <label className="flex items-start gap-2 font-medium">
            <input type="checkbox" name="isMarketing" checked={isMarketing} onChange={(e) => setIsMarketing(e.target.checked)} className="mt-1" />
            This is a promotion (deals, &ldquo;come back&rdquo;, news)
          </label>
          <p className="mt-1 text-xs">
            Promotions only go to guests who checked &ldquo;send me deals&rdquo; when they booked. Trip info (directions, reminders, thank-yous) can go to every guest. Anyone who replied STOP never gets texts, and anyone who unsubscribed never gets emails.
          </p>
        </div>

        {isBroadcast && (
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="label">Who gets it</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label text-xs">Has any of these tags (comma separated)</label>
                <input name="segTags" className="input" value={segTags} onChange={(e) => setSegTags(e.target.value)} placeholder="vip, local" />
              </div>
              <div>
                <label className="label text-xs">At least this many trips</label>
                <input name="segMinTrips" type="number" min="0" className="input" value={segMinTrips} onChange={(e) => setSegMinTrips(e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">Last trip within (days)</label>
                <input name="segWithinDays" type="number" min="0" className="input" value={segWithin} onChange={(e) => setSegWithin(e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">Upcoming booking</label>
                <select name="segFuture" className="input" value={segFuture} onChange={(e) => setSegFuture(e.target.value)}>
                  <option value="any">Doesn&apos;t matter</option>
                  <option value="yes">Has one</option>
                  <option value="no">Doesn&apos;t have one</option>
                </select>
              </div>
            </div>
            <p className="mt-3 text-sm">
              Audience: <b>{audience == null ? "…" : `${audience} guest${audience === 1 ? "" : "s"}`}</b>
              {isMarketing && <span className="muted"> (opted-in guests only)</span>}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={campaign.active} /> {isBroadcast ? "Ready" : "On (sends automatically)"}
          </label>
          <button className="btn-primary">Save</button>
        </div>
      </div>

      <div className="space-y-4 lg:col-span-2">
        <div className="card card-pad">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="h2">Preview</h2>
            <span className="muted text-xs">{sampleLabel}</span>
          </div>
          {hasEmail && (
            <div className="mb-3 rounded-lg border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <b>Subject:</b> {previewSubject}
              </div>
              <div className="whitespace-pre-wrap break-words px-3 py-3 text-sm">{preview}</div>
              <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400">Don&apos;t want these emails? Unsubscribe.</div>
            </div>
          )}
          {hasSms && (
            <div className="flex">
              <div className="max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-sm">{preview || "…"}</div>
            </div>
          )}
          <p className="muted mt-3 text-xs">
            Trip details: {TRIGGER_LABELS[effTrigger]}. Tags with nothing to fill in (e.g. a waiver reminder when everyone signed) are left out.
          </p>
        </div>
        <div className="card card-pad space-y-2">
          <h2 className="h2">Send a test to me</h2>
          <p className="muted text-xs">Uses the message above (even before saving) with the sample trip.</p>
          {hasSms && <input name="testPhone" className="input" placeholder="Your cell, e.g. 361-555-0123" />}
          {hasEmail && <input name="testEmail" type="email" className="input" placeholder="you@example.com" />}
          <button formAction={sendTestCampaign} formNoValidate className="btn-secondary btn-sm">
            Send test
          </button>
        </div>
      </div>
    </form>
  );
}

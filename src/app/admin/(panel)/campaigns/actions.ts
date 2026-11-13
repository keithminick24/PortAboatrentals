"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audienceCount, seedCampaigns, sendBroadcast, sendTest } from "@/lib/campaigns";
import { hoursFromTiming, parseSegment, parseTags, type Segment, type TimingUnit } from "@/lib/campaignLogic";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, msg?: string, err?: string): never => {
  const q = new URLSearchParams();
  if (msg) q.set("msg", msg);
  if (err) q.set("err", err);
  redirect(`${path}${q.size ? `?${q}` : ""}`);
};

const TRIGGERS = ["before_trip", "after_trip", "after_booking", "win_back"];

function segmentFromForm(f: FormData): Segment {
  const seg: Segment = {};
  const tags = parseTags(str(f, "segTags"));
  if (tags.length) seg.tags = tags;
  const minTrips = Number(str(f, "segMinTrips"));
  if (minTrips > 0) seg.minTrips = Math.floor(minTrips);
  const within = Number(str(f, "segWithinDays"));
  if (within > 0) seg.lastTripWithinDays = Math.floor(within);
  const fut = str(f, "segFuture");
  if (fut === "yes") seg.hasFutureBooking = true;
  if (fut === "no") seg.hasFutureBooking = false;
  return seg;
}

function campaignFromForm(f: FormData) {
  const kind = str(f, "kind") === "broadcast" ? "broadcast" : "automation";
  const trigger = kind === "broadcast" ? "manual" : TRIGGERS.includes(str(f, "trigger")) ? str(f, "trigger") : "before_trip";
  const unit: TimingUnit = trigger === "win_back" ? "days" : str(f, "timingUnit") === "days" ? "days" : "hours";
  const channel = ["sms", "email", "both"].includes(str(f, "channel")) ? str(f, "channel") : "sms";
  return {
    name: str(f, "name"),
    kind,
    trigger,
    offsetHours: kind === "broadcast" ? 0 : hoursFromTiming(Number(str(f, "timingValue")) || 0, unit),
    channel,
    subject: str(f, "subject"),
    body: String(f.get("body") ?? "").replace(/\r\n/g, "\n").trim(),
    isMarketing: f.get("isMarketing") === "on",
    active: f.get("active") === "on",
    segment: JSON.stringify(kind === "broadcast" ? segmentFromForm(f) : {}),
  };
}

export async function saveCampaign(f: FormData) {
  await requirePermission("marketing");
  const id = str(f, "id");
  const data = campaignFromForm(f);
  if (!data.name) return back(`/admin/campaigns/${id || "new"}`, undefined, "Give the campaign a name.");
  if (!data.body) return back(`/admin/campaigns/${id || "new"}`, undefined, "The message can't be empty.");
  if (data.channel !== "sms" && !data.subject) data.subject = data.name;
  const saved = id ? await prisma.campaign.update({ where: { id }, data }) : await prisma.campaign.create({ data });
  revalidatePath("/admin/campaigns");
  back(`/admin/campaigns/${saved.id}`, "Saved");
}

export async function toggleCampaign(f: FormData) {
  await requirePermission("marketing");
  const id = str(f, "id");
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) return back("/admin/campaigns", undefined, "Campaign not found");
  await prisma.campaign.update({ where: { id }, data: { active: !c.active } });
  back("/admin/campaigns", c.active ? `"${c.name}" paused` : `"${c.name}" is on`);
}

export async function deleteCampaign(f: FormData) {
  await requirePermission("marketing");
  await prisma.campaign.delete({ where: { id: str(f, "id") } }).catch(() => null);
  back("/admin/campaigns", "Campaign deleted");
}

export async function addStarterCampaigns() {
  await requirePermission("marketing");
  const n = await seedCampaigns();
  back("/admin/campaigns", n ? `Added ${n} starter campaign${n === 1 ? "" : "s"}` : "Starter campaigns are already here");
}

/** Sends the message as it is in the form right now (saved or not) to the phone/email typed in. */
export async function sendTestCampaign(f: FormData) {
  const s = await requirePermission("marketing");
  const id = str(f, "id");
  const path = `/admin/campaigns/${id || "new"}`;
  const data = campaignFromForm(f);
  const phone = str(f, "testPhone");
  const email = str(f, "testEmail");
  if (!data.body) return back(path, undefined, "Write a message first.");
  if (!phone && !email) return back(path, undefined, "Type your phone or email to get a test.");
  const r = await sendTest(data, { phone, email }, s.name);
  if (!r.done.length) return back(path, undefined, r.errors[0] ?? "Nothing sent. Check that the channel matches what you typed (text needs a phone, email needs an email).");
  back(path, `Test ${r.done.join(" and ")} sent${id ? "" : " (campaign not saved yet)"}`, r.errors[0]);
}

export async function sendBroadcastNow(f: FormData) {
  const s = await requirePermission("marketing");
  const id = str(f, "id");
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c || c.kind !== "broadcast") return back("/admin/campaigns", undefined, "Only saved broadcasts can be sent.");
  const r = await sendBroadcast(id, s.name);
  revalidatePath("/admin/campaigns");
  back(`/admin/campaigns/${id}`, `Sent to ${r.sent} · skipped ${r.skipped}${r.failed ? ` · failed ${r.failed}` : ""} (audience ${r.audience})`);
}

/** Live audience count for the segment builder. */
export async function countAudience(segmentJson: string, isMarketing: boolean): Promise<number> {
  await requirePermission("marketing");
  return audienceCount(parseSegment(segmentJson), isMarketing);
}

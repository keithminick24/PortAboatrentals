"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { refreshReviews } from "@/lib/reviews";
import { zonedToUtc, isValidDateStr } from "@/lib/time";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (msg?: string, err?: string): never => {
  const q = new URLSearchParams();
  if (msg) q.set("msg", msg);
  if (err) q.set("err", err);
  redirect(`/admin/reviews${q.size ? `?${q}` : ""}`);
};
const SOURCES = ["google", "facebook", "manual"];

export async function saveReviewSettings(f: FormData) {
  await requirePermission("marketing");
  const url = (k: string) => {
    const v = str(f, k);
    return v && !/^https?:\/\//.test(v) ? `https://${v}` : v;
  };
  await prisma.settings.upsert({
    where: { id: 1 },
    update: { googlePlaceId: str(f, "googlePlaceId"), facebookPageId: str(f, "facebookPageId"), googleReviewUrl: url("googleReviewUrl"), facebookReviewUrl: url("facebookReviewUrl") },
    create: { id: 1, googlePlaceId: str(f, "googlePlaceId"), facebookPageId: str(f, "facebookPageId"), googleReviewUrl: url("googleReviewUrl"), facebookReviewUrl: url("facebookReviewUrl") },
  });
  back("Review settings saved");
}

export async function refreshNow() {
  await requirePermission("marketing");
  const r = await refreshReviews();
  const parts = (["google", "facebook"] as const).map((k) => {
    const x = r[k];
    const name = k === "google" ? "Google" : "Facebook";
    if (x.status === "skipped") return `${name}: not connected`;
    if (x.status === "error") return `${name}: ${x.error}`;
    return `${name}: ${x.rating ?? "–"}★ (${x.count ?? 0})`;
  });
  const anyError = r.google.status === "error" || r.facebook.status === "error";
  back(anyError ? undefined : parts.join(" · "), anyError ? parts.join(" · ") : undefined);
}

export async function toggleResponded(f: FormData) {
  await requirePermission("marketing");
  const r = await prisma.review.findUnique({ where: { id: str(f, "id") } });
  if (r) await prisma.review.update({ where: { id: r.id }, data: { responded: !r.responded } });
  back();
}

export async function deleteReview(f: FormData) {
  await requirePermission("marketing");
  await prisma.review.delete({ where: { id: str(f, "id") } }).catch(() => null);
  back("Review removed");
}

export async function addReview(f: FormData) {
  await requirePermission("marketing");
  const source = SOURCES.includes(str(f, "source")) ? str(f, "source") : "manual";
  const rating = Number(str(f, "rating"));
  const date = str(f, "date");
  if (!(rating >= 1 && rating <= 5)) return back(undefined, "Pick a star rating from 1 to 5.");
  await prisma.review.create({
    data: {
      source,
      author: str(f, "author"),
      rating,
      text: str(f, "text"),
      url: str(f, "url"),
      reviewedAt: isValidDateStr(date) ? zonedToUtc(date, "12:00") : new Date(),
    },
  });
  back("Review added");
}

/** When Google/Facebook aren't connected, staff can type in today's overall rating so the trend still works. */
export async function recordRating(f: FormData) {
  await requirePermission("marketing");
  const source = str(f, "source");
  const rating = Number(str(f, "rating"));
  const count = Math.floor(Number(str(f, "count")));
  if (!["google", "facebook"].includes(source)) return back(undefined, "Unknown source");
  if (!(rating >= 1 && rating <= 5) || !(count >= 0)) return back(undefined, "Enter a rating from 1 to 5 and the number of reviews.");
  await prisma.reviewSnapshot.create({ data: { source, rating, count } });
  back("Rating recorded");
}

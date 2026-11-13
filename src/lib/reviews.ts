import "server-only";
import { createHash } from "node:crypto";
import { prisma, getSettings } from "./db";

/**
 * Online reputation: pulls the overall rating, review count and recent reviews
 * from Google (Places API, New) and Facebook (Graph API), saves them as Review
 * rows (upserted by externalId) and writes a ReviewSnapshot for the trend chart.
 *
 * Test mode: without GOOGLE_PLACES_API_KEY / FACEBOOK_PAGE_ACCESS_TOKEN (or the
 * Place ID / Page ID in Settings) that source is skipped quietly.
 */

const FB_GRAPH = "https://graph.facebook.com/v27.0";

export const isGoogleReviewsEnabled = (placeId: string) => !!(process.env.GOOGLE_PLACES_API_KEY && placeId.trim());
export const isFacebookReviewsEnabled = (pageId: string) => !!(process.env.FACEBOOK_PAGE_ACCESS_TOKEN && pageId.trim());

type SourceResult = { status: "ok" | "skipped" | "error"; rating?: number; count?: number; reviews?: number; error?: string };

type GoogleReview = {
  name?: string;
  rating?: number;
  text?: { text?: string };
  originalText?: { text?: string };
  authorAttribution?: { displayName?: string; uri?: string };
  publishTime?: string;
  googleMapsUri?: string;
};

async function refreshGoogle(placeId: string): Promise<SourceResult> {
  if (!isGoogleReviewsEnabled(placeId)) return { status: "skipped" };
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId.trim())}`, {
      headers: {
        "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY!,
        "X-Goog-FieldMask": "rating,userRatingCount,reviews,googleMapsUri",
      },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      rating?: number;
      userRatingCount?: number;
      googleMapsUri?: string;
      reviews?: GoogleReview[];
      error?: { message?: string };
    };
    if (!res.ok) return { status: "error", error: data.error?.message ?? `Google returned ${res.status}` };
    let saved = 0;
    for (const r of data.reviews ?? []) {
      const externalId = `google:${r.name ?? hash(`${r.authorAttribution?.displayName}|${r.publishTime}`)}`;
      const fields = {
        author: r.authorAttribution?.displayName ?? "",
        rating: r.rating ?? null,
        text: r.originalText?.text ?? r.text?.text ?? "",
        url: r.googleMapsUri ?? data.googleMapsUri ?? "",
        reviewedAt: r.publishTime ? new Date(r.publishTime) : new Date(),
      };
      await prisma.review.upsert({ where: { externalId }, update: fields, create: { ...fields, source: "google", externalId } });
      saved++;
    }
    if (typeof data.rating === "number") {
      await prisma.reviewSnapshot.create({ data: { source: "google", rating: data.rating, count: data.userRatingCount ?? 0 } });
    }
    return { status: "ok", rating: data.rating, count: data.userRatingCount, reviews: saved };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : "Google request failed" };
  }
}

type FbRating = {
  created_time?: string;
  recommendation_type?: "positive" | "negative";
  review_text?: string;
  rating?: number;
  reviewer?: { name?: string; id?: string };
  open_graph_story?: { id?: string };
};

async function refreshFacebook(pageId: string): Promise<SourceResult> {
  if (!isFacebookReviewsEnabled(pageId)) return { status: "skipped" };
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN!;
  const id = encodeURIComponent(pageId.trim());
  try {
    const pageRes = await fetch(`${FB_GRAPH}/${id}?fields=overall_star_rating,rating_count&access_token=${encodeURIComponent(token)}`, { cache: "no-store" });
    const page = (await pageRes.json().catch(() => ({}))) as { overall_star_rating?: number; rating_count?: number; error?: { message?: string } };
    if (!pageRes.ok) return { status: "error", error: page.error?.message ?? `Facebook returned ${pageRes.status}` };

    const listRes = await fetch(
      `${FB_GRAPH}/${id}/ratings?fields=created_time,recommendation_type,review_text,reviewer,rating,open_graph_story&limit=25&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" },
    );
    const list = (await listRes.json().catch(() => ({}))) as { data?: FbRating[]; error?: { message?: string } };
    let saved = 0;
    if (listRes.ok) {
      for (const r of list.data ?? []) {
        const externalId = `facebook:${r.open_graph_story?.id ?? hash(`${r.reviewer?.id ?? r.reviewer?.name}|${r.created_time}`)}`;
        // Facebook "recommendations" have no stars: count positive as 5, negative as 1
        const rating = typeof r.rating === "number" ? r.rating : r.recommendation_type === "positive" ? 5 : r.recommendation_type === "negative" ? 1 : null;
        const fields = {
          author: r.reviewer?.name ?? "",
          rating,
          text: r.review_text ?? "",
          url: `https://www.facebook.com/${pageId.trim()}/reviews`,
          reviewedAt: r.created_time ? new Date(r.created_time) : new Date(),
        };
        await prisma.review.upsert({ where: { externalId }, update: fields, create: { ...fields, source: "facebook", externalId } });
        saved++;
      }
    }
    if (typeof page.overall_star_rating === "number") {
      await prisma.reviewSnapshot.create({ data: { source: "facebook", rating: page.overall_star_rating, count: page.rating_count ?? 0 } });
    }
    return {
      status: listRes.ok ? "ok" : "error",
      rating: page.overall_star_rating,
      count: page.rating_count,
      reviews: saved,
      error: listRes.ok ? undefined : (list.error?.message ?? `Facebook ratings returned ${listRes.status}`),
    };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : "Facebook request failed" };
  }
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

/** Pulls both sources now. */
export async function refreshReviews() {
  const s = await getSettings();
  const [google, facebook] = await Promise.all([refreshGoogle(s.googlePlaceId), refreshFacebook(s.facebookPageId)]);
  return { google, facebook };
}

/** For the scheduled job: refresh only if the last automatic snapshot is 12+ hours old. */
export async function refreshReviewsIfDue(now = new Date()) {
  const s = await getSettings();
  if (!isGoogleReviewsEnabled(s.googlePlaceId) && !isFacebookReviewsEnabled(s.facebookPageId)) return { status: "not_connected" as const };
  const last = await prisma.reviewSnapshot.findFirst({ where: { source: { in: ["google", "facebook"] } }, orderBy: { takenAt: "desc" } });
  if (last && now.getTime() - last.takenAt.getTime() < 12 * 3600000) return { status: "not_due" as const };
  return { status: "refreshed" as const, ...(await refreshReviews()) };
}

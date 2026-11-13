import { prisma, getSettings } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { isFacebookReviewsEnabled, isGoogleReviewsEnabled } from "@/lib/reviews";
import { reviewLinkFrom } from "@/lib/campaignLogic";
import { dailySeries, sparkPoints, trendSummary } from "@/lib/reviewStats";
import { fmtDate, fmtDateTime, todayLocal } from "@/lib/time";
import { Empty, PageHeader, Pill, Stat } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import { addReview, deleteReview, recordRating, refreshNow, saveReviewSettings, toggleResponded } from "./actions";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = { google: "Google", facebook: "Facebook", manual: "Other" };

function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="muted">no stars</span>;
  const full = Math.round(rating);
  return (
    <span className="text-amber-500" aria-label={`${rating} stars`}>
      {"★".repeat(full)}
      <span className="text-slate-300">{"★".repeat(Math.max(0, 5 - full))}</span>
    </span>
  );
}

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  await requirePermission("marketing");
  const sp = await searchParams;
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * 86400000);
  const settings = await getSettings();
  const [snaps, reviews, newReviews30, requestCampaigns] = await Promise.all([
    prisma.reviewSnapshot.findMany({ where: { takenAt: { gte: new Date(now.getTime() - 180 * 86400000) } }, orderBy: { takenAt: "asc" } }),
    prisma.review.findMany({ orderBy: { reviewedAt: "desc" }, take: 50 }),
    prisma.review.count({ where: { reviewedAt: { gte: since30 } } }),
    prisma.campaign.findMany({ where: { body: { contains: "{{reviewLink}}" } }, select: { id: true, name: true } }),
  ]);
  const requests30 = requestCampaigns.length
    ? await prisma.campaignSend.count({ where: { campaignId: { in: requestCampaigns.map((c) => c.id) }, status: "sent", createdAt: { gte: since30 } } })
    : 0;

  const sources = [
    {
      key: "google",
      name: "Google",
      connected: isGoogleReviewsEnabled(settings.googlePlaceId),
      link: settings.googleReviewUrl || (settings.googlePlaceId ? reviewLinkFrom({ googlePlaceId: settings.googlePlaceId }) : ""),
      steps: [
        "Find your Place ID (box below) and paste it in.",
        "In Google Cloud, turn on “Places API (New)” and create an API key.",
        "Add it to the app as GOOGLE_PLACES_API_KEY. Ratings then update twice a day.",
      ],
    },
    {
      key: "facebook",
      name: "Facebook",
      connected: isFacebookReviewsEnabled(settings.facebookPageId),
      link: settings.facebookReviewUrl,
      steps: [
        "Paste your Facebook Page ID (Page → About → Page transparency) below.",
        "Create a Meta app, then get a Page access token with pages_read_user_content and pages_read_engagement.",
        "Add it to the app as FACEBOOK_PAGE_ACCESS_TOKEN.",
      ],
    },
  ];
  const sentCount30 = requests30;
  const gained30 = sources.reduce((sum, s) => sum + trendSummary(snaps.filter((x) => x.source === s.key), 30, now).countChange, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reviews"
        subtitle="Your Google and Facebook ratings, recent reviews, and how review requests are doing."
        actions={
          <form action={refreshNow}>
            <button className="btn-secondary">Refresh now</button>
          </form>
        }
      />
      <FlashMessage msg={sp.msg} err={sp.err} />

      <div className="grid gap-4 md:grid-cols-2">
        {sources.map((s) => {
          const mine = snaps.filter((x) => x.source === s.key);
          const t = trendSummary(mine, 30, now);
          const series = dailySeries(mine, 90, now);
          const pts = sparkPoints(series.map((x) => x.rating), 240, 40);
          return (
            <div key={s.key} className="card card-pad space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="h2">{s.name}</h2>
                <Pill tone={s.connected ? "green" : "slate"}>{s.connected ? "Connected" : "Not connected"}</Pill>
              </div>
              {t.latest ? (
                <div className="flex flex-wrap items-end gap-6">
                  <div>
                    <div className="text-3xl font-bold">{t.latest.rating.toFixed(1)}<span className="ml-1 text-xl text-amber-500">★</span></div>
                    <div className="muted">{t.latest.count} reviews</div>
                  </div>
                  <div className="text-sm">
                    <div className={t.countChange > 0 ? "text-emerald-700" : "text-slate-600"}>{t.countChange >= 0 ? "+" : ""}{t.countChange} reviews in 30 days</div>
                    <div className={t.ratingChange > 0 ? "text-emerald-700" : t.ratingChange < 0 ? "text-rose-700" : "text-slate-600"}>
                      {t.ratingChange === 0 ? "Rating steady" : `Rating ${t.ratingChange > 0 ? "up" : "down"} ${Math.abs(t.ratingChange).toFixed(2)}`}
                    </div>
                  </div>
                  {series.length > 1 && (
                    <svg viewBox="0 0 240 40" className="h-10 w-full max-w-[240px]" role="img" aria-label={`${s.name} rating trend, last 90 days`}>
                      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" className="text-brand" strokeLinejoin="round" strokeLinecap="round" />
                    </svg>
                  )}
                </div>
              ) : (
                <p className="muted">No rating recorded yet.</p>
              )}
              {t.latest && <p className="muted text-xs">Updated {fmtDateTime(t.latest.takenAt)}</p>}
              {!s.connected && (
                <>
                  <div className="rounded-lg bg-slate-50 p-3 text-sm">
                    <div className="font-medium">To connect {s.name}:</div>
                    <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-slate-600">
                      {s.steps.map((x) => <li key={x}>{x}</li>)}
                    </ol>
                  </div>
                  <form action={recordRating} className="flex flex-wrap items-end gap-2 text-sm">
                    <input type="hidden" name="source" value={s.key} />
                    <div><label className="label text-xs">Or type today&apos;s rating</label><input name="rating" type="number" step="0.1" min="1" max="5" className="input w-24" placeholder="4.9" /></div>
                    <div><label className="label text-xs"># of reviews</label><input name="count" type="number" min="0" className="input w-24" /></div>
                    <button className="btn-secondary btn-sm">Save</button>
                  </form>
                </>
              )}
              {s.link && <a href={s.link} target="_blank" rel="noreferrer" className="text-sm text-brand hover:underline">Your review link ↗</a>}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Review requests sent (30 days)" value={sentCount30} href="/admin/campaigns" />
        <Stat label="New reviews (30 days)" value={Math.max(newReviews30, gained30)} />
        <Stat label="Reviews per 10 requests" value={sentCount30 ? ((Math.max(newReviews30, gained30) / sentCount30) * 10).toFixed(1) : "–"} />
      </div>
      {requestCampaigns.length === 0 && <p className="muted text-sm">No campaign asks for reviews yet. The starter &ldquo;Thank you + review&rdquo; text on the Campaigns page does.</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <h2 className="h2">Recent reviews</h2>
          {reviews.length === 0 ? (
            <Empty>No reviews yet. Connect Google or Facebook, or add one by hand.</Empty>
          ) : (
            reviews.map((r) => (
              <div key={r.id} className="card card-pad space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Stars rating={r.rating} />
                  <b>{r.author || "Guest"}</b>
                  <span className="muted">{fmtDate(r.reviewedAt)}</span>
                  <Pill tone="blue">{SOURCE_LABEL[r.source] ?? r.source}</Pill>
                  {r.responded && <Pill tone="green">Responded</Pill>}
                </div>
                {r.text && <p className="whitespace-pre-wrap text-sm text-slate-700">{r.text}</p>}
                <div className="flex flex-wrap items-center gap-4 pt-1 text-xs">
                  <form action={toggleResponded}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="text-brand hover:underline">{r.responded ? "Mark not responded" : "Mark responded"}</button>
                  </form>
                  {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">Open and reply ↗</a>}
                  {!r.externalId && (
                    <form action={deleteReview}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="text-rose-700 hover:underline">Remove</button>
                    </form>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="space-y-6">
          <form action={addReview} className="card card-pad space-y-3">
            <h2 className="h2">Add a review by hand</h2>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Where</label>
                <select name="source" className="input" defaultValue="google">
                  <option value="google">Google</option>
                  <option value="facebook">Facebook</option>
                  <option value="manual">Other (TripAdvisor, Yelp…)</option>
                </select>
              </div>
              <div>
                <label className="label">Stars</label>
                <select name="rating" className="input" defaultValue="5">
                  {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}
                </select>
              </div>
            </div>
            <div><label className="label">Name</label><input name="author" className="input" /></div>
            <div><label className="label">Date</label><input name="date" type="date" className="input" defaultValue={todayLocal()} /></div>
            <div><label className="label">What they said</label><textarea name="text" rows={3} className="input" /></div>
            <div><label className="label">Link (optional)</label><input name="url" className="input" placeholder="https://" /></div>
            <button className="btn-primary btn-sm">Add review</button>
          </form>

          <form action={saveReviewSettings} className="card card-pad space-y-3">
            <h2 className="h2">Review settings</h2>
            <div>
              <label className="label">Google Place ID</label>
              <input name="googlePlaceId" className="input" defaultValue={settings.googlePlaceId} placeholder="ChIJ…" />
              <p className="muted mt-1 text-xs">
                Find it by searching your business on{" "}
                <a className="text-brand underline" href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noreferrer">Google&apos;s Place ID Finder</a>.
              </p>
            </div>
            <div><label className="label">Google review link</label><input name="googleReviewUrl" className="input" defaultValue={settings.googleReviewUrl} placeholder="Leave blank to build it from the Place ID" /></div>
            <div><label className="label">Facebook Page ID</label><input name="facebookPageId" className="input" defaultValue={settings.facebookPageId} /></div>
            <div><label className="label">Facebook review link</label><input name="facebookReviewUrl" className="input" defaultValue={settings.facebookReviewUrl} placeholder="https://www.facebook.com/yourpage/reviews" /></div>
            <p className="muted text-xs">The {"{{reviewLink}}"} in texts uses the Google link first, then Facebook.</p>
            <button className="btn-primary btn-sm">Save</button>
          </form>
        </div>
      </div>
    </div>
  );
}

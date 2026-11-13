import { prisma, getSettings } from "@/lib/db";
import { resubscribe, unsubscribe } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email preferences", robots: { index: false } };

export default async function Unsubscribe({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string; back?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const s = await getSettings();
  const isSample = token === "sample";
  const c = isSample ? null : await prisma.customer.findUnique({ where: { unsubToken: token } });

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <div className="card card-pad space-y-4">
        <h1 className="h1">Email preferences</h1>
        {!c && !isSample ? (
          <p className="muted">This link isn&apos;t valid anymore. To stop emails, reply to any of our emails or call us at {s.phone}.</p>
        ) : sp.back ? (
          <p>Welcome back! You&apos;ll get emails from {s.businessName} again.</p>
        ) : sp.done || (c?.emailOptOut && !sp.back) ? (
          <>
            <p>
              You&apos;re unsubscribed{c ? <> ({c.email})</> : null}. You won&apos;t get any more emails from {s.businessName}.
              {c?.smsOptOut && " Texts are turned off too."}
            </p>
            <p className="muted">If you have a trip booked, your booking still stands. Questions? Call {s.phone}.</p>
            {c && (
              <form action={resubscribe}>
                <input type="hidden" name="token" value={token} />
                <button className="text-sm text-brand underline">Oops, keep sending me emails</button>
              </form>
            )}
          </>
        ) : (
          <form action={unsubscribe} className="space-y-4">
            <input type="hidden" name="token" value={token} />
            <p>Stop emails from {s.businessName}{c ? <> to <b>{c.email}</b></> : null}?</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="texts" /> Also stop texts
            </label>
            <button className="btn-primary w-full">Unsubscribe</button>
            <p className="muted text-xs">You can also reply STOP to any text from us at any time.</p>
          </form>
        )}
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getSettings, prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/money";
import { fmtDate } from "@/lib/time";
import { isMockPayments } from "@/lib/payments";
import { finalizeTipCheckout, hasCardOnFile, tipSuggestions, tripCrew } from "@/lib/tips";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tip your crew", robots: { index: false } };

const ERRORS: Record<string, string> = {
  amount: "Please pick an amount between $1 and $1,000.",
  card: "Your card on file didn't go through. You can use a different card below.",
  checkout: "We couldn't open the payment page. Please try again in a minute.",
};

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;
function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

export default async function TipPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ tipped?: string; tip_session?: string; err?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const b = await prisma.booking.findUnique({ where: { accessToken: token }, include: { boat: true, customer: true } });
  if (!b) notFound();
  const settings = await getSettings();

  let thanked = sp.tipped ? Number(sp.tipped) || 0 : 0;
  if (sp.tip_session && !isMockPayments()) {
    const ok = await finalizeTipCheckout(sp.tip_session).catch((e) => (console.error(e), false));
    if (ok) {
      const last = await prisma.tip.findFirst({ where: { bookingId: b.id, source: "post_trip" }, orderBy: { createdAt: "desc" } });
      thanked = last?.amountCents ?? 1;
    }
  }

  const crew = await tripCrew([b.id]);
  const names = joinNames([...new Set(crew.map((c) => firstName(c.name)))]);
  const done = ["returned", "completed"].includes(b.status);
  const suggestions = tipSuggestions(b.subtotalCents, settings.tipPercents);
  const defaultPct = suggestions[Math.floor(suggestions.length / 2)]?.pct;
  const card = hasCardOnFile(b);
  const earlier = await prisma.tip.aggregate({ where: { bookingId: b.id }, _sum: { amountCents: true } });

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-10">
      {thanked > 0 ? (
        <div className="card card-pad space-y-3 text-center">
          <div className="text-5xl">🙌</div>
          <h1 className="h1">Thank you, {b.customer.firstName}!</h1>
          <p className="text-slate-700">
            {thanked > 1 ? `Your ${fmtMoney(thanked)} tip` : "Your tip"} goes straight to {names || "the crew"}. We hope to see you back on the water soon.
          </p>
          <Link href="/book" className="btn-primary w-full py-3">Book your next trip</Link>
        </div>
      ) : !settings.tipsEnabled ? (
        <div className="card card-pad text-center">
          <h1 className="h1">Thanks for boating with us!</h1>
          <p className="muted mt-2">We hope you had a great day on the water.</p>
        </div>
      ) : !done ? (
        <div className="card card-pad text-center">
          <h1 className="h1">See you on the water!</h1>
          <p className="muted mt-2">You can tip your crew here after your trip on {fmtDate(b.startsAt)}.</p>
        </div>
      ) : (
        <form action={`/api/t/${token}/checkout`} method="post" className="card card-pad space-y-5">
          <div className="text-center">
            <div className="text-5xl">⛵</div>
            <h1 className="h1 mt-2">Thanks for boating with us, {b.customer.firstName}!</h1>
            <p className="mt-2 text-slate-700">
              Tip your crew{names ? <>: <b>{names}</b></> : ""}? 100% goes to the people who got your {b.boat.name} ready and welcomed you back.
            </p>
          </div>

          {sp.err && ERRORS[sp.err] && <Notice tone="error">{ERRORS[sp.err]}</Notice>}
          {(earlier._sum.amountCents ?? 0) > 0 && (
            <p className="muted text-center text-sm">You&apos;ve already tipped {fmtMoney(earlier._sum.amountCents ?? 0)}. Thank you!</p>
          )}

          <fieldset className="grid grid-cols-3 gap-2">
            <legend className="sr-only">Tip amount</legend>
            {suggestions.map((s) => (
              <label key={s.pct} className="cursor-pointer">
                <input type="radio" name="choice" value={`pct:${s.pct}`} defaultChecked={s.pct === defaultPct} className="peer sr-only" />
                <div className="rounded-lg border-2 border-slate-200 bg-white p-3 text-center peer-checked:border-brand peer-checked:bg-sky-50">
                  <div className="text-lg font-bold">{s.pct}%</div>
                  <div className="text-sm text-slate-600">{fmtMoney(s.cents)}</div>
                </div>
              </label>
            ))}
          </fieldset>
          <div>
            <label className="label" htmlFor="custom">Or enter your own amount</label>
            <input id="custom" name="custom" inputMode="decimal" className="input text-lg" placeholder="$" />
          </div>

          <div className="space-y-2">
            {card && (
              <button name="mode" value="card_on_file" className="btn-primary w-full py-3 text-base">
                Charge my card on file
              </button>
            )}
            <button name="mode" value="new_card" className={`${card ? "btn-secondary" : "btn-primary"} w-full py-3 text-base`}>
              {card ? "Use a different card" : "Continue to payment"}
            </button>
          </div>
          {isMockPayments() && <p className="muted text-center text-xs">Test mode: no card will be charged.</p>}
        </form>
      )}
    </div>
  );
}

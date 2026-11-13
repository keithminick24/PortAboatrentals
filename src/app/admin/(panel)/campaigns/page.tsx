import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { describeSegment, describeTiming, parseSegment } from "@/lib/campaignLogic";
import { fmtDateTime } from "@/lib/time";
import { Empty, Notice, PageHeader, Pill } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import { addStarterCampaigns, toggleCampaign } from "./actions";

export const dynamic = "force-dynamic";

const CHANNEL: Record<string, string> = { sms: "Text", email: "Email", both: "Text + email" };

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  await requirePermission("marketing");
  const sp = await searchParams;
  const since = new Date(Date.now() - 30 * 86400000);
  const [campaigns, stats, optedIn, customers] = await Promise.all([
    prisma.campaign.findMany({ orderBy: [{ kind: "asc" }, { createdAt: "asc" }] }),
    prisma.campaignSend.groupBy({ by: ["campaignId", "status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.customer.count({ where: { marketingOptIn: true } }),
    prisma.customer.count(),
  ]);
  const count = (id: string, status: string) => stats.find((s) => s.campaignId === id && s.status === status)?._count._all ?? 0;
  const automations = campaigns.filter((c) => c.kind === "automation");
  const broadcasts = campaigns.filter((c) => c.kind === "broadcast");

  const Row = ({ c }: { c: (typeof campaigns)[number] }) => (
    <tr className="hover:bg-slate-50">
      <td>
        <Link href={`/admin/campaigns/${c.id}`} className="font-medium text-brand hover:underline">{c.name}</Link>
        {c.isMarketing && <span className="ml-2"><Pill tone="amber">Promotion</Pill></span>}
      </td>
      <td>{c.kind === "broadcast" ? describeSegment(parseSegment(c.segment)) : describeTiming(c.trigger, c.offsetHours)}</td>
      <td>{CHANNEL[c.channel] ?? c.channel}</td>
      <td className="text-right">{count(c.id, "sent")}</td>
      <td className="text-right">{count(c.id, "skipped")}{count(c.id, "failed") > 0 && <span className="ml-1 text-rose-700">({count(c.id, "failed")} failed)</span>}</td>
      <td>
        {c.kind === "broadcast" ? (
          c.sentAt ? <Pill tone="green">Sent {fmtDateTime(c.sentAt)}</Pill> : <Pill>Draft</Pill>
        ) : (
          <form action={toggleCampaign}>
            <input type="hidden" name="id" value={c.id} />
            <button title={c.active ? "Click to pause" : "Click to turn on"}>
              <Pill tone={c.active ? "green" : "slate"}>{c.active ? "On" : "Paused"}</Pill>
            </button>
          </form>
        )}
      </td>
    </tr>
  );

  const Table = ({ rows }: { rows: typeof campaigns }) => (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr><th>Name</th><th>When / who</th><th>By</th><th className="text-right">Sent (30 days)</th><th className="text-right">Skipped</th><th>Status</th></tr>
        </thead>
        <tbody>{rows.map((c) => <Row key={c.id} c={c} />)}</tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        subtitle="Automatic texts and emails around each trip, plus one-time promotions."
        actions={<Link href="/admin/campaigns/new" className="btn-primary">+ New campaign</Link>}
      />
      <FlashMessage msg={sp.msg} err={sp.err} />
      <Notice>
        <b>Consent:</b> promotional messages only go to guests who opted in ({optedIn} of {customers} customers). Anyone who replies STOP never gets another text, and every email has an unsubscribe link. Trip confirmations and the day-before reminder are sent separately (Settings).
      </Notice>

      <section className="space-y-2">
        <h2 className="h2">Automatic</h2>
        {automations.length ? (
          <Table rows={automations} />
        ) : (
          <Empty>
            No automatic campaigns yet.
            <form action={addStarterCampaigns} className="mt-3">
              <button className="btn-primary btn-sm">Add the starter set (pre-arrival, day-of, thank-you, win-back)</button>
            </form>
          </Empty>
        )}
        {automations.length > 0 && automations.length < 4 && (
          <form action={addStarterCampaigns}>
            <button className="text-xs text-brand hover:underline">Add any missing starter campaigns</button>
          </form>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="h2">One-time blasts</h2>
        {broadcasts.length ? <Table rows={broadcasts} /> : <Empty>No blasts yet. Use &ldquo;+ New campaign&rdquo; and choose &ldquo;One-time blast&rdquo;.</Empty>}
      </section>
    </div>
  );
}

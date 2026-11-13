import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { sampleMergeData } from "@/lib/campaigns";
import { parseSegment } from "@/lib/campaignLogic";
import { fmtDateTime } from "@/lib/time";
import { Notice, PageHeader, Pill } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import CampaignEditor from "../CampaignEditor";
import { deleteCampaign, sendBroadcastNow } from "../actions";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  await requirePermission("marketing");
  const { id } = await params;
  const sp = await searchParams;
  const c = id === "new" ? null : await prisma.campaign.findUnique({ where: { id } });
  if (id !== "new" && !c) notFound();
  const sample = await sampleMergeData();
  const recent = c
    ? await prisma.campaignSend.findMany({ where: { campaignId: c.id }, orderBy: { createdAt: "desc" }, take: 25, include: { customer: true } })
    : [];

  return (
    <div className="space-y-6">
      <PageHeader title={c ? c.name : "New campaign"} subtitle={<Link href="/admin/campaigns" className="hover:underline">← Campaigns</Link>} />
      <FlashMessage msg={sp.msg} err={sp.err} />
      <CampaignEditor
        campaign={{
          id: c?.id ?? "",
          name: c?.name ?? "",
          kind: c?.kind ?? "automation",
          trigger: c?.trigger ?? "before_trip",
          offsetHours: c?.offsetHours ?? 24,
          channel: c?.channel ?? "sms",
          subject: c?.subject ?? "",
          body: c?.body ?? "Hi {{firstName}}! ",
          isMarketing: c?.isMarketing ?? false,
          active: c?.active ?? true,
          segment: parseSegment(c?.segment),
        }}
        sample={sample}
        sampleLabel={sample.firstName ? `Sample: ${sample.firstName} ${sample.lastName}${sample.boat ? `, ${sample.boat}` : ""}` : "Sample trip"}
      />

      {c?.kind === "broadcast" && (
        <div className="card card-pad space-y-2">
          <h2 className="h2">Send now</h2>
          {c.sentAt && <Notice>Last sent {fmtDateTime(c.sentAt)}. Sending again only reaches people who haven&apos;t gotten it yet.</Notice>}
          <p className="muted">Save your changes first. Sends to everyone in the audience right away (opted-out guests are skipped).</p>
          <form action={sendBroadcastNow}>
            <input type="hidden" name="id" value={c.id} />
            <button className="btn-primary">Send now</button>
          </form>
        </div>
      )}

      {c && (
        <div className="card overflow-x-auto">
          <div className="card-pad pb-0"><h2 className="h2">Recent sends</h2></div>
          {recent.length ? (
            <table className="table">
              <thead><tr><th>When</th><th>Guest</th><th>By</th><th>Result</th></tr></thead>
              <tbody>
                {recent.map((s) => (
                  <tr key={s.id}>
                    <td>{fmtDateTime(s.createdAt)}</td>
                    <td><Link className="text-brand hover:underline" href={`/admin/customers/${s.customerId}`}>{s.customer.firstName} {s.customer.lastName}</Link></td>
                    <td>{s.channel === "sms" ? "Text" : "Email"}</td>
                    <td>
                      <Pill tone={s.status === "sent" ? "green" : s.status === "failed" ? "red" : "slate"}>{s.status}</Pill>
                      {s.error && <span className="muted ml-2 text-xs">{s.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="card-pad muted">Nothing sent yet.</p>
          )}
        </div>
      )}

      {c && (
        <form action={deleteCampaign}>
          <input type="hidden" name="id" value={c.id} />
          <button className="text-sm text-rose-700 hover:underline">Delete this campaign</button>
        </form>
      )}
    </div>
  );
}

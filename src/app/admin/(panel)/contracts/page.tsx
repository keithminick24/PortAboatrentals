import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/time";
import { Notice, PageHeader, Pill } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import { publishContractVersion, retireContract } from "../../actions";

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const all = await prisma.contractTemplate.findMany({ orderBy: [{ name: "asc" }, { version: "desc" }], include: { _count: { select: { signatures: true } } } });
  const names = [...new Set(all.map((t) => t.name))];
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Contracts & waivers" subtitle="Editing publishes a new version. Every signature keeps an exact copy of the text that was signed." />
      <FlashMessage msg={sp.msg} err={sp.err} />
      <Notice tone="warn">The starter agreement is a template, not legal advice. Have a Texas maritime attorney review it before going live.</Notice>
      {names.map((name) => {
        const versions = all.filter((t) => t.name === name);
        const current = versions.find((v) => v.active) ?? versions[0];
        return (
          <div key={name} className="card card-pad space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="h2">{name}</h2>
              <div className="flex gap-1.5">
                {current.active ? <Pill tone="green">Active v{current.version}</Pill> : <Pill tone="slate">Retired</Pill>}
                <Pill>{current.signer === "renter" ? "Renter signs" : "Every passenger"}</Pill>
                {current.required && <Pill tone="blue">Required before payment</Pill>}
              </div>
            </div>
            <form action={publishContractVersion} className="space-y-3">
              <input type="hidden" name="name" value={name} />
              <textarea name="body" rows={14} className="input font-mono text-xs" defaultValue={current.body} />
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-1"><input type="checkbox" name="required" defaultChecked={current.required} /> Renter must sign before paying</label>
                <select name="signer" defaultValue={current.signer} className="input w-auto">
                  <option value="renter">Signed by renter</option>
                  <option value="all">Signed by each passenger (waiver link)</option>
                </select>
                <button className="btn-primary btn-sm">Publish as v{versions[0].version + 1}</button>
              </div>
            </form>
            {current.active && (
              <form action={retireContract}><input type="hidden" name="name" value={name} /><button className="text-xs text-rose-600 hover:underline">Retire this contract</button></form>
            )}
            <div className="muted">
              History: {versions.map((v) => `v${v.version} (${fmtDate(v.createdAt)}, ${v._count.signatures} signed)`).join(" · ")}
            </div>
          </div>
        );
      })}
      <div className="card card-pad space-y-3">
        <h2 className="h2">New contract</h2>
        <form action={publishContractVersion} className="space-y-3">
          <input name="name" placeholder="e.g. Paddle Board Addendum" className="input" required />
          <textarea name="body" rows={8} className="input font-mono text-xs" placeholder="Full contract text…" required />
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-1"><input type="checkbox" name="required" defaultChecked /> Renter must sign before paying</label>
            <select name="signer" className="input w-auto"><option value="renter">Signed by renter</option><option value="all">Signed by each passenger</option></select>
            <button className="btn-primary btn-sm">Create</button>
          </div>
        </form>
      </div>
    </div>
  );
}

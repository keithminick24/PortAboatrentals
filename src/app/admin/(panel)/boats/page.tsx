import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/money";
import { PageHeader, Pill } from "@/components/ui";
import { boatInsuranceState } from "@/lib/incidentRules";

export default async function BoatsPage() {
  const boats = await prisma.boat.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { rates: { where: { active: true }, orderBy: { minutes: "asc" } }, maintenance: { orderBy: { performedAt: "desc" }, take: 1 }, insurance: { select: { expiresAt: true } } },
  });
  return (
    <div>
      <PageHeader title="Fleet" subtitle="Your boats, their rates, deposits, and maintenance" actions={<Link href="/admin/boats/new" className="btn-primary">Add boat</Link>} />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {boats.map((b) => (
          <Link key={b.id} href={`/admin/boats/${b.id}`} className="card card-pad block hover:ring-2 hover:ring-brand/30">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{b.name}</div>
              <Pill tone={b.status === "available" ? "green" : b.status === "maintenance" ? "amber" : "slate"}>{b.status}</Pill>
            </div>
            <div className="muted">{b.type} · {b.capacity} guests · deposit {fmtMoney(b.depositCents)}</div>
            <div className="mt-2 text-sm">{b.rates.map((r) => `${r.label} ${fmtMoney(r.priceCents)}`).join(" · ") || <span className="text-rose-600">No active rates — not bookable</span>}</div>
            {b.status !== "retired" && <InsuranceBadge state={boatInsuranceState(b.insurance)} />}
            <div className="muted mt-2">Engine: {b.engineHours} hrs{b.maintenance[0] ? ` · last service ${b.maintenance[0].performedAt.toLocaleDateString()}` : ""}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function InsuranceBadge({ state }: { state: ReturnType<typeof boatInsuranceState> }) {
  if (state === "ok") return null;
  const text = { missing: "No insurance on file", expired: "Insurance expired", expiring: "Insurance expiring soon" }[state];
  return <div className="mt-2"><Pill tone={state === "expiring" ? "amber" : "red"}>{text}</Pill></div>;
}

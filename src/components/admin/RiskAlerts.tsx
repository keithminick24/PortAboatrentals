import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { boatInsuranceState } from "@/lib/incidentRules";

const WINDOW_DAYS = 45;

/** Dashboard banner for Admin/Manager: open incidents, insurance and tow memberships expiring. */
export default async function RiskAlerts() {
  const s = await getSession();
  if (!s || !["owner", "manager"].includes(s.role)) return null;
  const soon = new Date(Date.now() + WINDOW_DAYS * 86_400_000);
  const [openIncidents, boats] = await Promise.all([
    prisma.incident.count({ where: { status: { in: ["open", "investigating"] } } }),
    prisma.boat.findMany({
      where: { status: { not: "retired" } },
      select: { id: true, name: true, towCompany: true, towExpiresAt: true, insurance: { select: { expiresAt: true } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);
  const insurance = boats
    .map((b) => ({ b, st: boatInsuranceState(b.insurance, new Date(), WINDOW_DAYS) }))
    .filter((x) => x.st === "expired" || x.st === "expiring");
  const tow = boats.filter((b) => b.towExpiresAt && b.towExpiresAt < soon);
  if (!openIncidents && !insurance.length && !tow.length) return null;

  const items: React.ReactNode[] = [];
  if (openIncidents)
    items.push(<Link key="i" href="/admin/incidents" className="font-semibold underline">{openIncidents} open incident{openIncidents > 1 ? "s" : ""}</Link>);
  for (const { b, st } of insurance)
    items.push(<Link key={`ins-${b.id}`} href={`/admin/boats/${b.id}#insurance`} className="underline">{b.name}: insurance {st === "expired" ? "expired" : "expiring soon"}</Link>);
  for (const b of tow)
    items.push(
      <Link key={`tow-${b.id}`} href={`/admin/boats/${b.id}#towing`} className="underline">
        {b.name}: tow membership {b.towExpiresAt! < new Date() ? "expired" : "expiring soon"}
      </Link>,
    );

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <span className="font-semibold">⚠ Needs attention:</span>
      {items}
    </div>
  );
}

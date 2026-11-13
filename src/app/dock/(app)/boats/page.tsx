import Link from "next/link";
import { prisma } from "@/lib/db";
import { dueStatus } from "@/lib/maintenance";

export default async function DockBoats() {
  const boats = await prisma.boat.findMany({
    where: { status: { not: "retired" } },
    orderBy: { sortOrder: "asc" },
    include: { schedules: { where: { active: true } }, _count: { select: { damage: { where: { status: "confirmed" } } } } },
  });
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Boats</h1>
      {boats.map((boat) => {
        const states = boat.schedules.map((s) => dueStatus(s, boat.engineHours).state);
        const due = states.filter((s) => s === "due").length;
        const soon = states.filter((s) => s === "soon").length;
        return (
          <Link key={boat.id} href={`/dock/boats/${boat.id}`} className="block rounded-xl bg-white p-4 shadow-sm">
            <div className="flex items-baseline justify-between">
              <div className="text-lg font-bold">{boat.name}</div>
              <div className="text-sm text-slate-500">{boat.engineHours.toFixed(1)} hrs</div>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
              {boat.status === "maintenance" && <span className="badge border-rose-200 bg-rose-50 text-rose-800">Out of service</span>}
              {due > 0 && <span className="badge border-rose-200 bg-rose-50 text-rose-800">{due} service due</span>}
              {soon > 0 && <span className="badge border-amber-200 bg-amber-50 text-amber-900">{soon} due soon</span>}
              {due + soon === 0 && <span className="badge border-emerald-200 bg-emerald-50 text-emerald-800">Service up to date</span>}
              {boat._count.damage > 0 && <span className="badge border-slate-200 bg-slate-100 text-slate-700">{boat._count.damage} damage on record</span>}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

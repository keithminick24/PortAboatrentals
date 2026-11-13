import BookingWizard from "@/components/BookingWizard";
import { getSettings, prisma } from "@/lib/db";
import { addDays, todayLocal } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Chrome-less booking widget for embedding in WordPress via <iframe>. */
export default async function EmbedBook({ searchParams }: { searchParams: Promise<{ boat?: string; date?: string }> }) {
  const sp = await searchParams;
  const settings = await getSettings();
  const addOns = await prisma.addOn.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const today = todayLocal();
  return (
    <div className="p-2">
      <BookingWizard
        embedded
        minDate={today}
        maxDate={addDays(today, settings.maxAdvanceDays)}
        initialDate={sp.date}
        initialBoatId={sp.boat}
        addOns={addOns.map((a) => ({ id: a.id, name: a.name, description: a.description, priceCents: a.priceCents, max: a.quantity }))}
        taxRateBps={settings.taxRateBps}
        feeRateBps={settings.feeRateBps}
      />
    </div>
  );
}

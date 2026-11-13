import BookingWizard from "@/components/BookingWizard";
import { getSettings, prisma } from "@/lib/db";
import { addDays, todayLocal } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book a boat" };

export default async function BookPage({ searchParams }: { searchParams: Promise<{ boat?: string; date?: string }> }) {
  const sp = await searchParams;
  const settings = await getSettings();
  const addOns = await prisma.addOn.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const today = todayLocal();
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <BookingWizard
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

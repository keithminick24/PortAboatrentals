import "server-only";
import { getSettings, prisma } from "./db";
import { activeFees, convenienceSettings } from "./bookings";
import { addDays, todayLocal } from "./time";

/** Server-side props for <BookingWizard>, shared by /book and /embed/book. */
export async function bookingWizardProps(sp: { boat?: string; date?: string }) {
  const [settings, addOns, fees] = await Promise.all([
    getSettings(),
    prisma.addOn.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    activeFees(),
  ]);
  const today = todayLocal();
  const conv = convenienceSettings(settings);
  return {
    minDate: today,
    maxDate: addDays(today, settings.maxAdvanceDays),
    initialDate: sp.date,
    initialBoatId: sp.boat,
    addOns: addOns.map((a) => ({ id: a.id, name: a.name, description: a.description, priceCents: a.priceCents, max: a.quantity })),
    taxRateBps: settings.taxRateBps,
    fees,
    convenience: conv ? { ...conv, label: settings.convenienceFeeLabel } : null,
    tipsEnabled: settings.tipsEnabled,
    tipPercents: settings.tipPercents.split(",").map((p) => Number(p.trim())).filter((n) => Number.isFinite(n) && n > 0 && n <= 100),
  };
}

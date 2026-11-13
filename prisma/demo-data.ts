/** Adds sample bookings for testing: `npm run db:demo`. Never run against production. */
import { prisma } from "../src/lib/db";
import { createBooking } from "../src/lib/bookings";
import { recordRentalPayment } from "../src/lib/payments";
import { addDays, todayLocal } from "../src/lib/time";
(async () => {
  const boats = await prisma.boat.findMany({ include: { rates: true }, orderBy: { name: "asc" } });
  const addOns = await prisma.addOn.findMany();
  const t = todayLocal();
  const rate = (i: number, label: string) => boats[i].rates.find((r) => r.label.toLowerCase().includes(label))!;
  const people = [
    ["Jake", "Morales"], ["Sarah", "Whitfield"], ["Tommy", "Nguyen"], ["Lisa", "Carter"],
    ["Mike", "Reyes"], ["Amanda", "Brooks"], ["Chris", "Delgado"], ["Rachel", "Kim"],
  ];
  const plan: [number, string, number, string, number, boolean][] = [
    [0, "half", 0, "09:00", 8, true], [1, "full", 0, "09:00", 10, true], [2, "sunset", 0, "17:30", 6, false],
    [0, "half", 1, "13:00", 7, true], [2, "full", 1, "09:00", 12, true], [1, "half", 2, "09:00", 5, true],
    [0, "sunset", 3, "17:30", 4, false], [2, "half", 4, "13:00", 9, true],
  ];
  for (let i = 0; i < plan.length; i++) {
    const [bi, lab, d, time, party, pay] = plan[i];
    const r = rate(bi, lab);
    if (!r) { console.log("no rate", bi, lab); continue; }
    const [fn, ln] = people[i];
    try {
      const b = await createBooking({
        boatId: boats[bi].id, rateId: r.id, date: addDays(t, d), startTime: time, partySize: Math.min(party, boats[bi].capacity),
        customer: { firstName: fn, lastName: ln, email: `${fn.toLowerCase()}@example.com`, phone: "361-555-01" + (10 + i) },
        addOns: i % 2 === 0 && addOns[0] ? [{ addOnId: addOns[0].id, quantity: 1 }] : [],
        source: i % 3 === 0 ? "phone" : "online", actor: "demo", staffOverride: true,
      });
      if (pay) await recordRentalPayment(b.id, b.totalCents, "mock", null, null, "demo");
      console.log("ok", fn, ln, addDays(t, d), time);
    } catch (e: any) { console.log("skip", fn, e.message); }
  }
  await prisma.$disconnect();
})();

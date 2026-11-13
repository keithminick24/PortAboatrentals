/** Adds sample bookings for testing: `npm run db:demo`. Never run against production. */
import { prisma } from "../src/lib/db";
import { createBooking } from "../src/lib/bookings";
import { recordRentalPayment } from "../src/lib/payments";
import { addDays, todayLocal } from "../src/lib/time";
import { createHash } from "node:crypto";

// 1x1 transparent PNG as a stand-in drawn signature for sample data
const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
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
      if (pay) {
        // Today's sample renters have already signed so the dock check-out can be tried right away.
        // Later trips are left UNSIGNED so you can walk through the signing page yourself.
        const tpl = await prisma.contractTemplate.findFirst({ where: { required: true, active: true }, orderBy: { version: "desc" } });
        if (tpl && d === 0) {
          await prisma.signature.create({
            data: {
              bookingId: b.id, templateId: tpl.id, signerName: `${fn} ${ln}`, signerEmail: `${fn.toLowerCase()}@example.com`,
              isPrimary: true, dateOfBirth: "1988-05-14", boaterEdNumber: "TX-SAMPLE-" + (1000 + i), signatureData: SIG,
              bodySnapshot: tpl.body, bodyHash: createHash("sha256").update(tpl.body).digest("hex"), ipAddress: "sample",
            },
          });
        }
        await recordRentalPayment(b.id, b.totalCents, "mock", null, null, "demo");
      }
      console.log("ok", fn, ln, addDays(t, d), time);
    } catch (e: any) { console.log("skip", fn, e.message); }
  }
  // Sample dock crew login for trying the dock app at /dock
  const bcrypt = (await import("bcryptjs")).default;
  await prisma.adminUser.upsert({
    where: { email: "dock@portaboatrentals.com" },
    update: {},
    create: { email: "dock@portaboatrentals.com", name: "Dock Crew", role: "dock", passwordHash: await bcrypt.hash("dock-test", 10) },
  });
  await prisma.adminUser.upsert({
    where: { email: "accounting@portaboatrentals.com" },
    update: {},
    create: { email: "accounting@portaboatrentals.com", name: "Bookkeeper", role: "accounting", passwordHash: await bcrypt.hash("acct-test", 10) },
  });
  console.log("Dock crew login: dock@portaboatrentals.com / dock-test");
  console.log("Accounting login: accounting@portaboatrentals.com / acct-test");
  await prisma.$disconnect();
})();

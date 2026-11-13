/* Seeds settings, an owner login, sample fleet, add-ons, and contract templates.
 * Safe to re-run: only creates things that don't exist yet. */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const RENTAL_AGREEMENT = `PORT A BOAT RENTALS – BOAT RENTAL AGREEMENT

This Rental Agreement ("Agreement") is between Port A Boat Rentals ("Owner") and the person signing below ("Renter"). By signing, Renter agrees to every term below.

1. THE RENTAL. Owner rents the vessel identified in this booking ("Boat") to Renter for the reserved time only. Renter must return the Boat to the Owner's dock no later than the scheduled return time. Late returns are billed at the Boat's hourly rate in 30-minute increments, plus any cost of recovering the Boat.

2. OPERATOR REQUIREMENTS. Renter is the primary operator and must be at least 21 years old with a valid government photo ID. Under Texas law, anyone born on or after September 1, 1993 must have completed a boater education course to operate a motorboat over 15 hp. Only persons listed by Renter and meeting these requirements may operate the Boat. Renter will not operate the Boat while under the influence of alcohol or drugs, and will not allow anyone else to.

3. CAPACITY AND SAFETY EQUIPMENT. Renter will not exceed the Boat's posted passenger capacity. Renter confirms receipt of a safety briefing and that U.S. Coast Guard–approved life jackets are aboard for every passenger. Children under 13 must wear a life jacket at all times while underway.

4. OPERATING AREA. The Boat may only be operated in the bay and approved areas reviewed in the safety briefing. The Boat may NOT be taken into the Gulf of Mexico, the ship channel jetties, or any area marked off-limits. Renter will obey all navigation rules, no-wake zones, and posted markers, and will return immediately if weather deteriorates or Owner requests it.

5. CONDITION AND INSPECTION. Renter has inspected the Boat with Owner's staff before departure and agrees it is in good, safe working condition except as noted in the pre-departure photos. Before and after photos taken by Owner are part of this Agreement and may be used to determine damage.

6. SECURITY DEPOSIT. Renter authorizes Owner to place a hold on Renter's card for the security deposit shown in the booking. The hold is released after the Boat is returned on time, clean, and undamaged. Renter authorizes Owner to charge the deposit (and any amount above it) for: damage to the Boat, motor, propeller, or equipment; lost or damaged equipment; fuel beyond the included amount; excessive cleaning; towing or recovery; late return fees; and any fines incurred during the rental.

7. DAMAGE AND LOSS. Renter is responsible for all loss of or damage to the Boat and its equipment occurring during the rental, including running aground and propeller damage, regardless of fault, except normal wear and tear.

8. FUEL. The Boat is provided fueled. Fuel used beyond the included amount, if any, will be charged at Owner's posted rate.

9. CANCELLATION AND WEATHER. Renter may cancel for a full refund at least 48 hours before the start time. Later cancellations are non-refundable. If Owner cancels due to unsafe weather or mechanical issues, Renter may reschedule or receive a full refund. Owner may end a rental early for unsafe weather or conduct; no refund is due for early termination caused by Renter's conduct.

10. ASSUMPTION OF RISK. Renter understands that boating, swimming, floating, and related water activities involve inherent risks including drowning, collision, falls, sun and heat exposure, marine life, changing weather, and other hazards, and that these risks can cause serious injury or death. Renter voluntarily assumes all such risks for Renter and Renter's passengers.

11. RELEASE AND INDEMNITY. To the fullest extent permitted by law, Renter releases, waives, and agrees not to sue Owner, its owners, employees, and agents for any injury, death, loss, or damage arising out of the rental or use of the Boat, INCLUDING CLAIMS ARISING FROM THE OWNER'S OWN NEGLIGENCE. Renter will defend, indemnify, and hold Owner harmless from all claims by Renter's passengers or third parties arising from Renter's use or operation of the Boat.

12. GOVERNING LAW. This Agreement is governed by applicable U.S. maritime law and, where not inconsistent, the laws of the State of Texas, with venue in Nueces County, Texas. If any part of this Agreement is found unenforceable, the rest remains in effect.

13. ELECTRONIC SIGNATURE. Renter agrees that signing electronically has the same effect as a handwritten signature and that Renter has read and understands this entire Agreement.`;

const PASSENGER_WAIVER = `PORT A BOAT RENTALS – PASSENGER RELEASE AND WAIVER

I am a passenger (or the parent/guardian of a minor passenger) on a boat rented from Port A Boat Rentals ("Owner").

1. I understand that boating, swimming, floating, paddle boarding, and related water activities carry inherent risks including drowning, collision, falls, sun and heat exposure, marine life, and changing weather, which can cause serious injury or death. I voluntarily assume these risks.

2. I will follow the instructions of the boat operator and Owner's staff, wear a life jacket when appropriate (children under 13 at all times while underway), and not operate the boat unless I meet the legal requirements and am approved by the renter.

3. To the fullest extent permitted by law, I release, waive, and agree not to sue Owner, its owners, employees, and agents for any injury, death, loss, or damage arising from my participation, INCLUDING CLAIMS ARISING FROM THE OWNER'S OWN NEGLIGENCE.

4. If I am signing for a minor, I confirm I am their parent or legal guardian and agree to these terms on their behalf.

5. I agree that my electronic signature has the same effect as a handwritten signature.`;

async function main() {
  await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  const email = (process.env.ADMIN_EMAIL || "admin@portaboatrentals.com").toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "change-me";
  if (!(await prisma.adminUser.findUnique({ where: { email } }))) {
    await prisma.adminUser.create({
      data: { email, name: "Owner", role: "owner", passwordHash: await bcrypt.hash(password, 10) },
    });
    console.log(`Created owner login ${email}`);
  }

  if ((await prisma.boat.count()) === 0) {
    const fleet = [
      { name: "Tritoon #1", slug: "tritoon-1", sortOrder: 1 },
      { name: "Tritoon #2", slug: "tritoon-2", sortOrder: 2 },
      { name: "Tritoon #3", slug: "tritoon-3", sortOrder: 3 },
    ];
    for (const f of fleet) {
      await prisma.boat.create({
        data: {
          ...f,
          type: "Tritoon Pontoon",
          capacity: 10,
          lengthFt: 24,
          horsepower: 150,
          depositCents: 50000,
          description:
            "Smooth-riding tritoon with full Bimini shade, comfortable lounge seating, swim ladder, and Bluetooth sound. Perfect for cruising the bay, sandbar hangs, and dockside lunches.",
          schedules: {
            create: [
              { name: "Engine oil & filter", everyHours: 100, everyDays: 365 },
              { name: "Lower unit gear oil", everyHours: 100, everyDays: 365 },
              { name: "Water pump impeller", everyHours: 300, everyDays: 730 },
              { name: "Safety gear check (PFDs, fire extinguisher, throwable, flares)", everyDays: 30 },
            ],
          },
          rates: {
            create: [
              { label: "Half Day (4 hrs)", minutes: 240, priceCents: 45000, weekendPriceCents: 50000, sortOrder: 1 },
              { label: "Full Day (9 hrs)", minutes: 540, priceCents: 75000, weekendPriceCents: 82500, sortOrder: 2 },
              { label: "Sunset Cruise (2 hrs)", minutes: 120, priceCents: 27500, sortOrder: 3 },
            ],
          },
        },
      });
    }
    console.log("Created sample fleet (edit in Admin → Fleet)");
  }

  if ((await prisma.addOn.count()) === 0) {
    await prisma.addOn.createMany({
      data: [
        { name: "Mega Chill floating hammock", priceCents: 5000, quantity: 4, sortOrder: 1, description: "Giant floating lounger for the whole crew." },
        { name: "Paddle board", priceCents: 4000, quantity: 6, sortOrder: 2, description: "Stand-up paddle board with paddle and leash." },
        { name: "Cooler with ice", priceCents: 2500, quantity: 10, sortOrder: 3, description: "Large cooler, iced and ready." },
      ],
    });
  }

  if ((await prisma.fee.count()) === 0) {
    await prisma.fee.create({
      data: {
        name: "Damage Waiver",
        description: "Mandatory. Covers accidental damage up to the waiver limit; see rental agreement.",
        mode: "added",
        calc: "flat",
        sortOrder: 1,
        tiers: { create: [{ minMinutes: 0, amountCents: 5000 }, { minMinutes: 300, amountCents: 10000 }] },
      },
    });
    await prisma.fee.create({
      data: {
        name: "Fuel",
        description: "Fuel for your trip is included in the boat price.",
        mode: "included",
        calc: "flat",
        sortOrder: 2,
        // Placeholder amounts - set your real fuel portion in Admin → Fees
        tiers: { create: [{ minMinutes: 0, amountCents: 4000 }, { minMinutes: 300, amountCents: 7500 }] },
      },
    });
    console.log("Created Damage Waiver and Fuel fees (edit in Admin → Fees)");
  }

  if ((await prisma.contractTemplate.count()) === 0) {
    await prisma.contractTemplate.create({
      data: { name: "Rental Agreement & Liability Waiver", version: 1, body: RENTAL_AGREEMENT, signer: "renter" },
    });
    await prisma.contractTemplate.create({
      data: { name: "Passenger Waiver", version: 1, body: PASSENGER_WAIVER, signer: "all", required: false },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

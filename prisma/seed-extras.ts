/** Starter campaigns and placeholder cost assumptions. Safe to re-run. */
import { seedCampaigns } from "../src/lib/campaigns";
import { seedCostAssumptions } from "../src/lib/profit";
import { prisma } from "../src/lib/db";

(async () => {
  await seedCampaigns();
  await seedCostAssumptions();
  console.log("Starter campaigns and placeholder cost assumptions ready (edit in Admin → Campaigns and Profit → Cost assumptions)");
  await prisma.$disconnect();
})();

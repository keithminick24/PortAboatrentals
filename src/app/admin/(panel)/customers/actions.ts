"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { parseTags } from "@/lib/campaignLogic";

/** Tags and message consent for one customer. */
export async function saveCustomerCrm(f: FormData) {
  await requirePermission("ops");
  const id = String(f.get("id") ?? "");
  await prisma.customer.update({
    where: { id },
    data: {
      tags: parseTags(String(f.get("tags") ?? "")).join(","),
      source: String(f.get("source") ?? "").trim(),
      marketingOptIn: f.get("marketingOptIn") === "on",
      smsOptOut: f.get("smsOptOut") === "on",
      emailOptOut: f.get("emailOptOut") === "on",
    },
  });
  redirect(`/admin/customers/${id}?msg=${encodeURIComponent("Saved")}`);
}

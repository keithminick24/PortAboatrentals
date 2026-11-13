"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

/** Customer-facing unsubscribe. The secret token in the link is the only "login". */
export async function unsubscribe(f: FormData) {
  const token = String(f.get("token") ?? "");
  if (!token || token === "sample") redirect(`/u/${encodeURIComponent(token)}?done=1`);
  const c = await prisma.customer.findUnique({ where: { unsubToken: token } });
  if (!c) redirect(`/u/${encodeURIComponent(token)}`);
  const alsoTexts = f.get("texts") === "on";
  await prisma.customer.update({
    where: { id: c.id },
    data: { emailOptOut: true, ...(alsoTexts ? { smsOptOut: true } : {}) },
  });
  redirect(`/u/${encodeURIComponent(token)}?done=1`);
}

export async function resubscribe(f: FormData) {
  const token = String(f.get("token") ?? "");
  const c = token ? await prisma.customer.findUnique({ where: { unsubToken: token } }) : null;
  if (c) await prisma.customer.update({ where: { id: c.id }, data: { emailOptOut: false } });
  redirect(`/u/${encodeURIComponent(token)}?back=1`);
}

"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { parseMoney } from "@/lib/money";
import { zonedToUtc } from "@/lib/time";
import { deleteObject, putObject } from "@/lib/storage";

const DOC_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const DOC_MAX = 15 * 1024 * 1024;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, msg?: string, err?: string): never => {
  const q = new URLSearchParams();
  if (msg) q.set("msg", msg);
  if (err) q.set("err", err);
  redirect(`${path}${q.size ? `?${q}` : ""}#insurance`);
};
const date = (f: FormData, k: string, time: string) => (/^\d{4}-\d{2}-\d{2}$/.test(str(f, k)) ? zonedToUtc(str(f, k), time) : null);

export async function saveInsurancePolicy(f: FormData) {
  await requirePermission("pricing");
  const boatId = str(f, "boatId");
  const id = str(f, "id");
  const path = `/admin/boats/${boatId}`;
  const carrier = str(f, "carrier");
  if (!carrier) return back(path, undefined, "Insurance company is required");
  const data = {
    carrier,
    policyNumber: str(f, "policyNumber"),
    coverage: str(f, "coverage"),
    agentName: str(f, "agentName"),
    agentPhone: str(f, "agentPhone"),
    agentEmail: str(f, "agentEmail"),
    claimsPhone: str(f, "claimsPhone"),
    hullValueCents: parseMoney(str(f, "hullValue")),
    liabilityLimitCents: parseMoney(str(f, "liabilityLimit")),
    deductibleCents: parseMoney(str(f, "deductible")),
    annualPremiumCents: parseMoney(str(f, "annualPremium")),
    effectiveDate: date(f, "effectiveDate", "00:00"),
    expiresAt: date(f, "expiresAt", "23:59"),
    notes: str(f, "notes"),
  };
  if (data.effectiveDate && data.expiresAt && data.expiresAt <= data.effectiveDate) return back(path, undefined, "Expiration must be after the start date");

  const file = f.get("document");
  let doc: { documentKey: string; documentType: string } | null = null;
  if (file instanceof File && file.size > 0) {
    if (!DOC_TYPES.includes(file.type)) return back(path, undefined, "Policy document must be a PDF or photo");
    if (file.size > DOC_MAX) return back(path, undefined, "Policy document too large (max 15 MB)");
    const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1].replace("jpeg", "jpg");
    const key = `insurance/${boatId}/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
    await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
    doc = { documentKey: key, documentType: file.type };
  }

  if (id) {
    const old = await prisma.insurancePolicy.findUnique({ where: { id } });
    if (!old || old.boatId !== boatId) return back(path, undefined, "Policy not found");
    const removeDoc = str(f, "removeDocument") === "on";
    await prisma.insurancePolicy.update({
      where: { id },
      data: { ...data, ...(doc ?? (removeDoc ? { documentKey: null, documentType: null } : {})) },
    });
    if (old.documentKey && (doc || removeDoc)) await deleteObject(old.documentKey);
  } else {
    if (!(await prisma.boat.findUnique({ where: { id: boatId }, select: { id: true } }))) return back("/admin/boats", undefined, "Boat not found");
    await prisma.insurancePolicy.create({ data: { ...data, ...(doc ?? {}), boatId } });
  }
  back(path, "Insurance saved");
}

export async function deleteInsurancePolicy(f: FormData) {
  await requirePermission("pricing");
  const p = await prisma.insurancePolicy.delete({ where: { id: str(f, "id") } });
  if (p.documentKey) await deleteObject(p.documentKey);
  back(`/admin/boats/${p.boatId}`, "Policy removed");
}

export async function saveTowInfo(f: FormData) {
  await requirePermission("pricing");
  const boatId = str(f, "boatId");
  const applyAll = str(f, "applyAll") === "on";
  const data = {
    towCompany: str(f, "towCompany"),
    towPhone: str(f, "towPhone"),
    towMemberNumber: str(f, "towMemberNumber"),
    towPlan: str(f, "towPlan"),
    towExpiresAt: date(f, "towExpiresAt", "23:59"),
    towNotes: str(f, "towNotes"),
  };
  if (applyAll) {
    // Fleet-wide memberships: same company/phone/plan/expiry, keep each boat's own member # if it has one.
    const { towMemberNumber, ...shared } = data;
    await prisma.boat.updateMany({ data: shared });
    await prisma.boat.update({ where: { id: boatId }, data: { towMemberNumber } });
  } else {
    await prisma.boat.update({ where: { id: boatId }, data });
  }
  redirect(`/admin/boats/${boatId}?msg=${encodeURIComponent(applyAll ? "Tow info saved for all boats" : "Tow info saved")}#towing`);
}

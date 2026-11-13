import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "./db";
import { logEvent } from "./bookings";
import { appUrl, emailLayout, sendMail } from "./mail";
import { fmtDateTime, fmtRange } from "./time";
import { checkAges } from "./ages";
export { ageOn, checkAges } from "./ages";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const signatureSchema = z
  .object({
    templateId: z.string().min(1),
    signerName: z.string().trim().min(2, "Enter your full name").max(120),
    signerEmail: z.string().trim().email("Enter a valid email").optional(),
    dateOfBirth: isoDate.optional(),
    boaterEdNumber: z.string().trim().max(60).optional(),
    // Parent/guardian signing for a child
    minorName: z.string().trim().min(2, "Enter the child's full name").max(120).optional(),
    minorDob: isoDate.optional(),
    guardianRelationship: z.string().trim().min(2, "Enter your relationship to the child").max(60).optional(),
    signatureData: z
      .string()
      .startsWith("data:image/png;base64,", "Invalid signature")
      .max(500_000, "Signature image too large"),
  })
  .refine((v) => !!v.dateOfBirth, { message: "Enter your date of birth", path: ["dateOfBirth"] })
  .refine((v) => !v.minorName || (!!v.minorDob && !!v.guardianRelationship), {
    message: "Enter the child's date of birth and your relationship to them",
    path: ["minorDob"],
  });

export type SignatureInput = z.infer<typeof signatureSchema>;

/** Unguessable per-signature key for the "view signed copy" link. */
export function signedCopyKey(signatureId: string): string {
  const secret = process.env.SESSION_SECRET || "dev-only-insecure-session-secret";
  return createHmac("sha256", secret).update(`signed-copy:${signatureId}`).digest("base64url").slice(0, 22);
}

export function verifySignedCopyKey(signatureId: string, key: string | undefined): boolean {
  if (!key) return false;
  const a = Buffer.from(signedCopyKey(signatureId));
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function signedCopyUrl(signatureId: string) {
  return appUrl(`/signed/${signatureId}?k=${signedCopyKey(signatureId)}`);
}

export async function recordSignature(bookingId: string, input: SignatureInput, isPrimary: boolean, req: Request) {
  const template = await prisma.contractTemplate.findUnique({ where: { id: input.templateId } });
  if (!template || !template.active) throw new Error("That agreement is no longer active. Please refresh.");
  const ageProblem = checkAges(input, isPrimary);
  if (ageProblem) throw new Error(ageProblem);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || null;
  const sig = await prisma.signature.create({
    data: {
      bookingId,
      templateId: template.id,
      signerName: input.signerName,
      signerEmail: input.signerEmail ?? null,
      isPrimary,
      dateOfBirth: input.dateOfBirth ?? null,
      boaterEdNumber: input.boaterEdNumber ?? null,
      minorName: input.minorName ?? null,
      minorDob: input.minorName ? (input.minorDob ?? null) : null,
      guardianRelationship: input.minorName ? (input.guardianRelationship ?? null) : null,
      signatureData: input.signatureData,
      bodySnapshot: template.body,
      bodyHash: createHash("sha256").update(template.body).digest("hex"),
      ipAddress: ip,
      userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    },
  });
  await logEvent(
    bookingId,
    "signed",
    input.minorName
      ? `${input.signerName} (${input.guardianRelationship}) signed "${template.name}" v${template.version} for minor ${input.minorName}`
      : `${input.signerName} signed "${template.name}" v${template.version}${isPrimary ? " (renter)" : " (passenger)"}`,
    input.signerName,
  );
  await emailSignedCopy(sig.id).catch((e) => console.error("[signature] copy email failed", e));
  return sig;
}

/** Emails the signer a copy of exactly what they signed, with a link to view/print it anytime. */
export async function emailSignedCopy(signatureId: string) {
  const s = await prisma.signature.findUnique({
    where: { id: signatureId },
    include: { template: true, booking: { include: { boat: true, customer: true } } },
  });
  if (!s) return;
  const to = s.signerEmail || (s.isPrimary ? s.booking.customer.email : null);
  if (!to || to.endsWith(".invalid")) return;
  const link = await signedCopyUrl(s.id);
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  await sendMail({
    to,
    subject: `Your signed copy: ${s.template.name}`,
    html: emailLayout(
      "Your signed copy",
      `<p>Hi ${esc(s.signerName.split(" ")[0])}, thanks for signing. Keep this email for your records.</p>
<p><b>${esc(s.template.name)}</b> (version ${s.template.version})<br>
${s.minorName ? `Signed on behalf of <b>${esc(s.minorName)}</b> (${esc(s.guardianRelationship ?? "parent/guardian")})<br>` : ""}
Trip: ${esc(s.booking.boat.name)}, ${fmtRange(s.booking.startsAt, s.booking.endsAt)} · Booking ${s.booking.code}<br>
Signed: ${fmtDateTime(s.signedAt)}</p>
<p><a href="${link}" style="background:#0B2E4F;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">View or print your signed copy</a></p>
<details><summary>Full text you agreed to</summary><pre style="white-space:pre-wrap;font-family:inherit;font-size:13px">${esc(s.bodySnapshot)}</pre></details>
<p style="font-size:12px;color:#64748b">Document fingerprint (SHA-256): ${s.bodyHash}</p>`,
    ),
  });
}

import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "./db";
import { logEvent } from "./bookings";

export const signatureSchema = z.object({
  templateId: z.string().min(1),
  signerName: z.string().trim().min(2, "Enter your full name").max(120),
  signerEmail: z.string().trim().email().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter your date of birth").optional(),
  boaterEdNumber: z.string().trim().max(60).optional(),
  signatureData: z
    .string()
    .startsWith("data:image/png;base64,", "Invalid signature")
    .max(500_000, "Signature image too large"),
});

export async function recordSignature(
  bookingId: string,
  input: z.infer<typeof signatureSchema>,
  isPrimary: boolean,
  req: Request,
) {
  const template = await prisma.contractTemplate.findUnique({ where: { id: input.templateId } });
  if (!template || !template.active) throw new Error("That agreement is no longer active. Please refresh.");
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
    `${input.signerName} signed "${template.name}" v${template.version}${isPrimary ? " (renter)" : " (passenger)"}`,
    input.signerName,
  );
  return sig;
}

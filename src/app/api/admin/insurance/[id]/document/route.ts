import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getObject } from "@/lib/storage";

// Policy documents are private: office staff only.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(s.role, "ops")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const { id } = await params;
  const p = await prisma.insurancePolicy.findUnique({ where: { id }, include: { boat: { select: { slug: true } } } });
  if (!p?.documentKey) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await getObject(p.documentKey);
  if (!body) return NextResponse.json({ error: "File missing" }, { status: 404 });
  const ext = p.documentKey.split(".").pop();
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": p.documentType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${p.boat.slug}-insurance.${ext}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

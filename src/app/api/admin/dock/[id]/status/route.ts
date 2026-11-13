import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [pending, flags] = await Promise.all([
    prisma.photo.count({ where: { bookingId: id, aiStatus: "pending" } }),
    prisma.damageReport.count({ where: { bookingId: id, status: "needs_check" } }),
  ]);
  return NextResponse.json({ pending, flags });
}

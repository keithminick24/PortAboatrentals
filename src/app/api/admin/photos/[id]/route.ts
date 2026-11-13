import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getObject } from "@/lib/storage";

// Photos are private: only signed-in staff can view them.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const photo = await prisma.photo.findUnique({ where: { id } });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await getObject(photo.storageKey);
  if (!body) return NextResponse.json({ error: "File missing" }, { status: 404 });
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": photo.contentType, "Cache-Control": "private, max-age=86400" },
  });
}

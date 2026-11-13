import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";

/** Dashboard banner: "2 phone booking requests to review →". Renders nothing when there are none. */
export default async function PhoneOrdersAlert() {
  const s = await getSession();
  if (!can(s?.role, "phoneOrders")) return null;
  const n = await prisma.phoneOrder.count({ where: { status: { in: ["needs_review", "failed"] } } });
  if (!n) return null;
  return (
    <Link
      href="/admin/phone-orders"
      className="block rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-900 hover:bg-sky-100"
    >
      {n} phone booking {n === 1 ? "request" : "requests"} to review →
    </Link>
  );
}

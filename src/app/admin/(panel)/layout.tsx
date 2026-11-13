import AdminNav from "@/components/AdminNav";
import { requireAdmin } from "@/lib/auth";
import { isMockPayments } from "@/lib/payments";
import { logoutAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operations", robots: { index: false } };

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const s = await requireAdmin();
  return (
    <div className="min-h-screen bg-slate-50">
      <AdminNav userName={s.name} role={s.role} logout={logoutAction} />
      {isMockPayments() && (
        <div className="bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
          Test payment mode — Stripe isn&apos;t connected, so no real charges are made. Add STRIPE_SECRET_KEY to go live.
        </div>
      )}
      <div className="mx-auto max-w-7xl px-4 py-6">{children}</div>
    </div>
  );
}

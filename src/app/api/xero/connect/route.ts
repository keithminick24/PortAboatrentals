import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { appUrl } from "@/lib/mail";
import { buildAuthorizeUrl, isXeroConfigured, newOAuthState, XERO_STATE_COOKIE } from "@/lib/xero";

export const dynamic = "force-dynamic";

/** Start "Connect to Xero": send the owner to Xero's sign-in with a one-time state value. */
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.redirect(await appUrl("/admin/login?next=/admin/accounting"));
  if (!can(s.role, "accounting")) return NextResponse.json({ error: "You don't have access to that." }, { status: 403 });
  if (!isXeroConfigured()) {
    return NextResponse.redirect(await appUrl("/admin/accounting?err=" + encodeURIComponent("Xero isn't set up yet. Follow the setup steps below first.")));
  }
  const state = newOAuthState();
  const res = NextResponse.redirect(await buildAuthorizeUrl(state));
  res.cookies.set(XERO_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/xero",
    maxAge: 600,
  });
  return res;
}

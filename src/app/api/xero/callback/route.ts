import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { appUrl } from "@/lib/mail";
import { completeXeroConnect, syncXeroAccounts, XERO_STATE_COOKIE } from "@/lib/xero";

export const dynamic = "force-dynamic";

/** Xero sends the owner back here after they approve (or cancel) the connection. */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.redirect(await appUrl("/admin/login?next=/admin/accounting"));
  if (!can(s.role, "accounting")) return NextResponse.json({ error: "You don't have access to that." }, { status: 403 });

  const back = async (key: "msg" | "err", text: string) => {
    const res = NextResponse.redirect(await appUrl(`/admin/accounting?${key}=${encodeURIComponent(text)}`));
    res.cookies.set(XERO_STATE_COOKIE, "", { path: "/api/xero", maxAge: 0 });
    return res;
  };

  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back("err", `Xero didn't connect: ${sp.get("error_description") || sp.get("error")}`);
  const expected = req.cookies.get(XERO_STATE_COOKIE)?.value;
  const state = sp.get("state");
  const code = sp.get("code");
  if (!expected || !state || state !== expected) return back("err", "That Xero sign-in expired or didn't match. Please click Connect again.");
  if (!code) return back("err", "Xero didn't send a sign-in code. Please try again.");

  try {
    const org = await completeXeroConnect(code);
    try {
      await syncXeroAccounts();
    } catch (e) {
      console.warn("[xero] account list failed after connect:", e);
    }
    return back("msg", `Connected to Xero${org ? ` (${org})` : ""}. Map your accounts below, then click Sync now.`);
  } catch (e) {
    return back("err", e instanceof Error ? e.message : "Couldn't connect to Xero.");
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { checkAccess } from "@/lib/routeAccess";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/admin/login") || pathname.startsWith("/dock/login")) return NextResponse.next();
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = pathname.startsWith("/dock") ? "/dock/login" : "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  // Role-based access (see lib/routeAccess.ts and lib/permissions.ts).
  const access = checkAccess(session.role, pathname);
  if (!access.ok) {
    if (access.api) return NextResponse.json({ error: "You don't have access to that." }, { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = access.redirectTo;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*", "/dock/:path*"] };

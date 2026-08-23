import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE_NAME,
  PARTNER_SESSION_COOKIE_NAME,
  verifyAdminSessionToken,
  verifyPartnerSessionToken,
} from "@/lib/signed-session";

function isPublicApiRequest(request: NextRequest, pathname: string) {
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname.startsWith("/api/register")) return true;
  // 학교 관리자 영역: 로그인은 공개, summary/teachers 는 라우트 내부에서 학교 세션(snorkl-school-auth)으로 인증
  if (pathname.startsWith("/api/school/")) return true;
  if (pathname.startsWith("/api/schools/lookup")) return true;
  if (pathname.startsWith("/api/schools/search")) return true;
  if (pathname.startsWith("/api/confirm/")) return true;
  if (pathname.startsWith("/api/account-confirm/")) return true;
  if (pathname.startsWith("/api/domain-confirm/")) return true;
  if (pathname.startsWith("/api/partner/auth")) return true;
  if (pathname.startsWith("/api/cron/")) return true;
  if (pathname.startsWith("/api/translate")) return true;

  if (pathname === "/api/school-requests" && request.method === "POST") {
    return true;
  }

  if (pathname === "/api/account-requests" && request.method === "POST") {
    return true;
  }

  return false;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect /admin routes
  if (pathname.startsWith("/admin")) {
    const auth = request.cookies.get(ADMIN_SESSION_COOKIE_NAME);
    if (!(await verifyAdminSessionToken(auth?.value))) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  // Protect /partner routes
  if (pathname.startsWith("/partner") && !pathname.startsWith("/partner/login")) {
    const auth = request.cookies.get(PARTNER_SESSION_COOKIE_NAME);
    if (!(await verifyPartnerSessionToken(auth?.value))) {
      return NextResponse.redirect(new URL("/partner/login", request.url));
    }
  }

  // Protect /api/partner routes (except auth)
  if (pathname.startsWith("/api/partner") && !pathname.startsWith("/api/partner/auth")) {
    const partnerAuth = request.cookies.get(PARTNER_SESSION_COOKIE_NAME);
    const adminAuth = request.cookies.get(ADMIN_SESSION_COOKIE_NAME);
    const [partnerRole, adminAuthenticated] = await Promise.all([
      verifyPartnerSessionToken(partnerAuth?.value),
      verifyAdminSessionToken(adminAuth?.value),
    ]);
    if (!partnerRole && !adminAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Protect other API routes
  if (pathname.startsWith("/api/") && !isPublicApiRequest(request, pathname)) {
    const auth = request.cookies.get(ADMIN_SESSION_COOKIE_NAME);
    if (!(await verifyAdminSessionToken(auth?.value))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/partner/:path*", "/api/:path*"],
};

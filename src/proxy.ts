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

  // market 상태 되읽기: 라우트 내부에서 x-api-key(INTEGRATION_API_KEY)로 기계 인증한다.
  // 키 미설정/불일치 판정은 라우트가 503/401로 직접 응답하므로 proxy는 통과만 시킨다.
  if (pathname === "/api/account-requests/market-status" && request.method === "GET") {
    return true;
  }

  // Market 협력사 제품 신청 배치 수신부: 동적 ID 한 구간 + PUT만 통과시킨다.
  // 관리자 쿠키 대신 라우트 내부 x-api-key로만 기계 인증한다.
  if (/^\/api\/account-requests\/market-partner\/[^/]+$/.test(pathname)
    && request.method === "PUT") {
    return true;
  }

  // 구 Market writer 주문번호 감사: exact path + GET만 통과시키며 세션 폴백은 없다.
  // 라우트 내부 x-api-key가 미설정 503과 누락/불일치 401을 구분한다.
  if (pathname === "/api/account-requests/market-legacy-audit" && request.method === "GET") {
    return true;
  }

  // Market 주문 취소 2단계 수신부: exact path + POST만 통과시킨다.
  // 세션 폴백 없이 라우트 내부 x-api-key가 503/401을 구분한다.
  if (pathname === "/api/account-requests/market-void" && request.method === "POST") {
    return true;
  }

  // Cailie 인보이스 확인 페이지: exact path + GET만 통과시킨다. 이 화면은 읽기 전용이며
  // 쓰기 경로를 두지 않는다. 라우트 내부에서 ?k= 고정 토큰을 검증하고, 세션 폴백은 없다 —
  // 토큰 미설정 503과 누락/불일치 401을 라우트가 직접 구분한다.
  if (pathname === "/api/invoice" && request.method === "GET") {
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

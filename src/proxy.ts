import { NextRequest, NextResponse } from "next/server";

function isPublicApiRequest(request: NextRequest, pathname: string) {
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname.startsWith("/api/register")) return true;
  if (pathname.startsWith("/api/schools/lookup")) return true;
  if (pathname.startsWith("/api/schools/search")) return true;
  if (pathname.startsWith("/api/confirm/")) return true;
  if (pathname.startsWith("/api/seat-order")) return true;
  if (pathname.startsWith("/api/seat-register/")) return true;
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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect /admin routes
  if (pathname.startsWith("/admin")) {
    const auth = request.cookies.get("snorkl-admin-auth");
    if (auth?.value !== "authenticated") {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  // Protect /partner routes
  if (pathname.startsWith("/partner") && !pathname.startsWith("/partner/login")) {
    const auth = request.cookies.get("snorkl-partner-auth");
    if (auth?.value !== "jon" && auth?.value !== "jeff") {
      return NextResponse.redirect(new URL("/partner/login", request.url));
    }
  }

  // Protect /api/partner routes (except auth)
  if (pathname.startsWith("/api/partner") && !pathname.startsWith("/api/partner/auth")) {
    const partnerAuth = request.cookies.get("snorkl-partner-auth");
    const adminAuth = request.cookies.get("snorkl-admin-auth");
    if ((partnerAuth?.value !== "jon" && partnerAuth?.value !== "jeff") && adminAuth?.value !== "authenticated") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Protect other API routes
  if (pathname.startsWith("/api/") && !isPublicApiRequest(request, pathname)) {
    const auth = request.cookies.get("snorkl-admin-auth");
    if (auth?.value !== "authenticated") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/partner/:path*", "/api/:path*"],
};

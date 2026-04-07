import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect /admin routes (not /api/auth or /api/register or /api/schools/lookup)
  if (pathname.startsWith("/admin")) {
    const auth = request.cookies.get("snorkl-admin-auth");
    if (auth?.value !== "authenticated") {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  // Protect admin API routes
  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/register") &&
    !pathname.startsWith("/api/schools/lookup") &&
    !pathname.startsWith("/api/schools/search") &&
    !pathname.startsWith("/api/school-requests") &&
    !pathname.startsWith("/api/account-requests") &&
    !pathname.startsWith("/api/confirm/") &&
    !pathname.startsWith("/api/cron/") &&
    !pathname.startsWith("/api/auth")
  ) {
    const auth = request.cookies.get("snorkl-admin-auth");
    if (auth?.value !== "authenticated") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/:path*"],
};

import { NextRequest, NextResponse } from "next/server";

function isPublicApiRequest(request: NextRequest, pathname: string) {
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname.startsWith("/api/register")) return true;
  if (pathname.startsWith("/api/schools/lookup")) return true;
  if (pathname.startsWith("/api/schools/search")) return true;
  if (pathname.startsWith("/api/confirm/")) return true;
  if (pathname.startsWith("/api/cron/")) return true;

  if (pathname === "/api/school-requests" && request.method === "POST") {
    return true;
  }

  if (pathname === "/api/account-requests" && request.method === "POST") {
    return true;
  }

  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect /admin routes.
  if (pathname.startsWith("/admin")) {
    const auth = request.cookies.get("snorkl-admin-auth");
    if (auth?.value !== "authenticated") {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  if (pathname.startsWith("/api/") && !isPublicApiRequest(request, pathname)) {
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

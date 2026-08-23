import { NextRequest, NextResponse } from "next/server";
import { verifyPassword, COOKIE_NAME, isAdminPasswordConfigured } from "@/lib/auth";
import { checkRateLimit, createRateLimitResponse } from "@/lib/security";
import { ADMIN_SESSION_MAX_AGE, createAdminSessionToken } from "@/lib/signed-session";

export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit({
    request: req,
    key: "admin-login",
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });

  if (!rateLimit.ok) {
    return createRateLimitResponse("Too many login attempts. Please try again later.", rateLimit.retryAfter);
  }

  const { password } = await req.json();

  if (!isAdminPasswordConfigured()) {
    return NextResponse.json({ error: "Admin password is not configured" }, { status: 500 });
  }

  if (typeof password !== "string" || !verifyPassword(password)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const sessionToken = await createAdminSessionToken();
  if (!sessionToken) {
    return NextResponse.json({ error: "Admin session is not configured" }, { status: 500 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: ADMIN_SESSION_MAX_AGE,
    path: "/",
  });

  return response;
}

import { NextRequest, NextResponse } from "next/server";
import { verifyPartnerPassword, PARTNER_COOKIE_NAME } from "@/lib/auth";
import { isPartnerRole } from "@/lib/partner-roles";
import { checkRateLimit, createRateLimitResponse } from "@/lib/security";
import {
  PARTNER_SESSION_MAX_AGE,
  createPartnerSessionToken,
  verifyPartnerSessionToken,
} from "@/lib/signed-session";

export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit({
    request: req,
    key: "partner-login",
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });

  if (!rateLimit.ok) {
    return createRateLimitResponse("Too many login attempts. Please try again later.", rateLimit.retryAfter);
  }

  const { password } = await req.json();

  if (typeof password !== "string") {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const role = verifyPartnerPassword(password);
  if (!isPartnerRole(role)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const sessionToken = await createPartnerSessionToken(role);
  if (!sessionToken) {
    return NextResponse.json({ error: "Partner session is not configured" }, { status: 500 });
  }

  const response = NextResponse.json({ success: true, role });
  response.cookies.set(PARTNER_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: PARTNER_SESSION_MAX_AGE,
    path: "/",
  });

  return response;
}

// GET: return current role
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(PARTNER_COOKIE_NAME);
  const role = await verifyPartnerSessionToken(cookie?.value);
  if (role) {
    return NextResponse.json({ role });
  }
  return NextResponse.json({ role: null }, { status: 401 });
}

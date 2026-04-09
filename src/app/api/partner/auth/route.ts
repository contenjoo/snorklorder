import { NextRequest, NextResponse } from "next/server";
import { verifyPartnerPassword, PARTNER_COOKIE_NAME } from "@/lib/auth";
import { checkRateLimit, createRateLimitResponse } from "@/lib/security";

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
  if (!role) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const response = NextResponse.json({ success: true, role });
  response.cookies.set(PARTNER_COOKIE_NAME, role, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 90,
    path: "/",
  });

  return response;
}

// GET: return current role
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(PARTNER_COOKIE_NAME);
  const role = cookie?.value;
  if (role === "jon" || role === "jeff") {
    return NextResponse.json({ role });
  }
  return NextResponse.json({ role: null }, { status: 401 });
}

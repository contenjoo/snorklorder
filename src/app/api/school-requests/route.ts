export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { schoolRequests } from "@/db/schema";
import { desc } from "drizzle-orm";
import { checkAuth } from "@/lib/auth";
import { checkRateLimit, createRateLimitResponse, isValidEmail, normalizeText } from "@/lib/security";

// POST: 교사가 학교 등록 요청 (public)
export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit({
    request: req,
    key: "public-school-request",
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });

  if (!rateLimit.ok) {
    return createRateLimitResponse("Too many school requests. Please try again later.", rateLimit.retryAfter);
  }

  const { name, nameEn, region, domain, contactName, contactEmail } = await req.json();

  if (!name || !contactName || !contactEmail) {
    return NextResponse.json({ error: "학교명, 담당자 이름, 이메일은 필수입니다." }, { status: 400 });
  }

  const normalizedName = normalizeText(name, 120);
  const normalizedNameEn = typeof nameEn === "string" ? normalizeText(nameEn, 120) : null;
  const normalizedRegion = typeof region === "string" ? normalizeText(region, 40) : null;
  const normalizedDomain = typeof domain === "string"
    ? normalizeText(domain, 120).toLowerCase().replace(/^https?:\/\//, "").replace(/^@/, "").replace(/\/$/, "") || null
    : null;
  const normalizedContactName = normalizeText(contactName, 80);
  const normalizedContactEmail = normalizeText(contactEmail, 254).toLowerCase();

  if (!normalizedName || !normalizedContactName || !isValidEmail(normalizedContactEmail)) {
    return NextResponse.json({ error: "입력값이 올바르지 않습니다." }, { status: 400 });
  }

  if (normalizedDomain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalizedDomain)) {
    return NextResponse.json({ error: "도메인 형식이 올바르지 않습니다. (예: school.kr)" }, { status: 400 });
  }

  const [request] = await db
    .insert(schoolRequests)
    .values({
      name: normalizedName,
      nameEn: normalizedNameEn,
      region: normalizedRegion,
      domain: normalizedDomain,
      contactName: normalizedContactName,
      contactEmail: normalizedContactEmail,
    })
    .returning();

  // 관리자에게 알림 이메일 (non-blocking)
  import("@/lib/email").then(({ sendAdminNotification }) => {
    sendAdminNotification(request).catch(console.error);
  });

  return NextResponse.json({ success: true });
}

// GET: 관리자용 요청 목록 (admin protected by middleware)
export async function GET() {
  if (!(await checkAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await db
    .select()
    .from(schoolRequests)
    .orderBy(desc(schoolRequests.createdAt));

  return NextResponse.json(result);
}

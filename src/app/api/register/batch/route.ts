export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { teachers, schools } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { checkRateLimit, createRateLimitResponse, isValidEmail } from "@/lib/security";
import { resolveApproval } from "@/lib/verification";

export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit({
    request: req,
    key: "public-register-batch",
    limit: 4,
    windowMs: 10 * 60 * 1000,
  });

  if (!rateLimit.ok) {
    return createRateLimitResponse("Too many batch registration attempts. Please try again later.", rateLimit.retryAfter);
  }

  const body = await req.json();
  const { schoolCode, emails } = body as { schoolCode: string; emails: string[] };

  if (!schoolCode || !emails?.length) {
    return NextResponse.json({ error: "School code and emails are required" }, { status: 400 });
  }

  const [school] = await db
    .select()
    .from(schools)
    .where(eq(schools.code, schoolCode.toUpperCase()));

  if (!school) {
    return NextResponse.json({ error: "Invalid school code" }, { status: 404 });
  }

  // 이메일 정리
  const cleanEmails = emails
    .map((e) => e.toLowerCase().trim())
    .filter((e) => e && isValidEmail(e));
  const uniqueEmails = [...new Set(cleanEmails)];

  if (uniqueEmails.length === 0) {
    return NextResponse.json({ error: "No valid emails" }, { status: 400 });
  }

  if (uniqueEmails.length > 50) {
    return NextResponse.json({ error: "You can register up to 50 emails at once" }, { status: 400 });
  }

  // 기존 등록 체크
  const existing = await db
    .select({ email: teachers.email })
    .from(teachers)
    .where(
      and(
        eq(teachers.schoolId, school.id),
        inArray(teachers.email, uniqueEmails)
      )
    );
  const existingSet = new Set(existing.map((e) => e.email));

  // 새 이메일만 필터
  const newEmails = uniqueEmails.filter((e) => !existingSet.has(e));
  const duplicateCount = cleanEmails.length - newEmails.length;

  if (newEmails.length === 0) {
    return NextResponse.json({
      success: true,
      schoolName: school.name,
      registered: 0,
      duplicates: cleanEmails.length,
      total: cleanEmails.length,
    });
  }

  // 일괄 삽입 (이름은 이메일 @ 앞부분)
  const now = new Date();
  const values = newEmails.map((email) => ({
    schoolId: school.id,
    name: email.split("@")[0],
    email,
    subject: null,
    status: "pending" as const,
    emailVerifiedAt: now, // 접수 시각 (OTP 없음)
  }));

  const inserted = await db.insert(teachers).values(values).returning({ id: teachers.id });

  // 각 교사 승인 판정: 도메인 일치 → 자동승인 / 아니면 관리자 큐
  let approved = 0;
  for (const t of inserted) {
    const status = await resolveApproval(t.id, school.id);
    if (status === "approved") approved++;
  }

  return NextResponse.json({
    success: true,
    schoolName: school.name,
    registered: newEmails.length,
    approved,
    pendingReview: newEmails.length - approved,
    duplicates: duplicateCount,
    total: cleanEmails.length,
  });
}

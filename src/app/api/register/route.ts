export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { teachers, schools } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { checkRateLimit, createRateLimitResponse, isValidEmail, normalizeText } from "@/lib/security";
import { createTeacherVerification } from "@/lib/verification";
import { sendTeacherVerificationEmail } from "@/lib/verification-email";

export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit({
    request: req,
    key: "public-register",
    limit: 12,
    windowMs: 10 * 60 * 1000,
  });

  if (!rateLimit.ok) {
    return createRateLimitResponse("Too many registration attempts. Please try again later.", rateLimit.retryAfter);
  }

  const body = await req.json();
  const { schoolCode, name, email, subject } = body;

  if (!schoolCode || !name || !email) {
    return NextResponse.json(
      { error: "School code, name, and email are required" },
      { status: 400 }
    );
  }

  const normalizedName = normalizeText(name, 80);
  const normalizedEmail = normalizeText(email, 254).toLowerCase();
  const normalizedSubject = typeof subject === "string" ? normalizeText(subject, 80) : null;

  if (!normalizedName || !isValidEmail(normalizedEmail)) {
    return NextResponse.json({ error: "Invalid name or email" }, { status: 400 });
  }

  const [school] = await db
    .select()
    .from(schools)
    .where(eq(schools.code, schoolCode.toUpperCase()));

  if (!school) {
    return NextResponse.json({ error: "Invalid school code" }, { status: 404 });
  }

  // Check duplicate
  const [existing] = await db
    .select({ id: teachers.id, verificationStatus: teachers.verificationStatus })
    .from(teachers)
    .where(
      and(
        eq(teachers.schoolId, school.id),
        eq(teachers.email, normalizedEmail)
      )
    );

  let teacherId: number;
  if (existing) {
    // 이미 검증/승인된 등록이면 중복 차단. 미검증 상태면 재발송 허용.
    if (existing.verificationStatus !== "unverified") {
      return NextResponse.json(
        { error: "This email is already registered for this school" },
        { status: 409 }
      );
    }
    teacherId = existing.id;
  } else {
    const [inserted] = await db
      .insert(teachers)
      .values({
        schoolId: school.id,
        name: normalizedName,
        email: normalizedEmail,
        subject: normalizedSubject,
        status: "pending",
        verificationStatus: "unverified",
      })
      .returning({ id: teachers.id });
    teacherId = inserted.id;
  }

  // 이메일 소유 증명: OTP + 매직링크 발송
  const { code, token } = await createTeacherVerification(teacherId);
  void sendTeacherVerificationEmail({
    teacherId,
    email: normalizedEmail,
    name: normalizedName,
    schoolName: school.name,
    schoolNameEn: school.nameEn,
    code,
    token,
  });

  return NextResponse.json({
    success: true,
    needsVerification: true,
    teacherId,
    schoolName: school.name,
  });
}

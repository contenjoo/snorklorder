export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/db";
import { teachers } from "@/db/schema";
import { getSchoolSession } from "@/lib/school-auth";
import { isValidEmail, normalizeText } from "@/lib/security";

// 학교 관리자가 인증된 대시보드에서 교사 일괄 추가 → 업로드 자체가 보증이므로 자동 승인(approved).
// (공개 자가등록 폼 /api/register* 와 달리 OTP/큐를 거치지 않음)
export async function POST(req: NextRequest) {
  const schoolId = await getSchoolSession();
  if (!schoolId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const raw: string[] = Array.isArray(body.emails)
    ? body.emails
    : String(body.emails ?? body.email ?? "").split(/[\n,;]+/);
  const emails = [...new Set(raw.map((e) => normalizeText(String(e), 254).toLowerCase()).filter((e) => e && isValidEmail(e)))];
  if (emails.length === 0) return NextResponse.json({ error: "No valid emails" }, { status: 400 });
  if (emails.length > 200) return NextResponse.json({ error: "Too many emails (max 200)" }, { status: 400 });

  // 기존 등록 제외 (같은 학교)
  const existing = await db
    .select({ email: teachers.email })
    .from(teachers)
    .where(and(eq(teachers.schoolId, schoolId), inArray(teachers.email, emails)));
  const existingSet = new Set(existing.map((e) => e.email));
  const newEmails = emails.filter((e) => !existingSet.has(e));

  if (newEmails.length === 0) {
    return NextResponse.json({ success: true, added: 0, duplicates: emails.length });
  }

  const now = new Date();
  await db.insert(teachers).values(
    newEmails.map((email) => ({
      schoolId,
      name: email.split("@")[0],
      email,
      status: "pending" as const,
      // 관리자 업로드 = 보증 → 자동 승인
      verificationStatus: "approved" as const,
      emailVerifiedAt: now,
      approvedAt: now,
      approvedBy: "school_admin_upload",
    }))
  );

  return NextResponse.json({ success: true, added: newEmails.length, duplicates: emails.length - newEmails.length });
}

export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountRequests, teachers } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { sendTeacherUpgradedEmail, sendAccountConfirmNotification } from "@/lib/email";

// GET: 토큰으로 요청 상세 조회 (Jon이 확인 페이지 열었을 때)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const [r] = await db
    .select()
    .from(accountRequests)
    .where(eq(accountRequests.confirmToken, token));

  if (!r) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }

  // 같은 학교에 처리 대기(draft/sent) 다른 요청들 — Jon이 한꺼번에 확인하도록 노출
  const { and, ne, inArray: inArr } = await import("drizzle-orm");
  const siblings = await db
    .select({
      id: accountRequests.id,
      type: accountRequests.type,
      applicantType: accountRequests.applicantType,
      emails: accountRequests.emails,
      accountType: accountRequests.accountType,
      quantity: accountRequests.quantity,
      status: accountRequests.status,
      notes: accountRequests.notes,
      createdAt: accountRequests.createdAt,
    })
    .from(accountRequests)
    .where(and(eq(accountRequests.schoolName, r.schoolName), ne(accountRequests.id, r.id), inArr(accountRequests.status, ["draft", "sent"])));

  return NextResponse.json({ request: r, siblings });
}

// POST: Jon이 "Upgrade Done" 클릭 → status=processed (alsoConfirmIds 있으면 같은 학교 형제 요청도 함께)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  const alsoConfirmIds: number[] = Array.isArray(body?.alsoConfirmIds) ? body.alsoConfirmIds.filter((n: unknown) => Number.isInteger(n)) : [];
  const [r] = await db
    .select()
    .from(accountRequests)
    .where(eq(accountRequests.confirmToken, token));

  if (!r) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }

  const allIds = [r.id, ...alsoConfirmIds];
  // 형제 요청도 같은 학교에 한해서만 처리 (보안: 임의 id 처리 방지)
  const validSiblings = alsoConfirmIds.length > 0
    ? await db
        .select({ id: accountRequests.id, emails: accountRequests.emails, schoolName: accountRequests.schoolName, schoolNameEn: accountRequests.schoolNameEn, type: accountRequests.type, applicantType: accountRequests.applicantType })
        .from(accountRequests)
        .where(inArray(accountRequests.id, alsoConfirmIds))
    : [];
  const sameSchoolIds = validSiblings.filter((s) => s.schoolName === r.schoolName).map((s) => s.id);
  const finalIds = [r.id, ...sameSchoolIds];
  void allIds;

  await db
    .update(accountRequests)
    .set({ status: "processed", confirmedAt: new Date(), updatedAt: new Date() })
    .where(inArray(accountRequests.id, finalIds));

  // 교사 환영 메일은 응답 후 백그라운드로 발송 (형제 요청 포함)
  const siblingEmailStrings = validSiblings
    .filter((s) => s.schoolName === r.schoolName)
    .map((s) => s.emails)
    .filter(Boolean);
  const combinedEmailString = [r.emails, ...siblingEmailStrings].join(",");
  const emails = combinedEmailString
    .split(/[,;\n]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

  if (emails.length > 0) {
    void (async () => {
      try {
        const matched = await db
          .select({ email: teachers.email, name: teachers.name })
          .from(teachers)
          .where(inArray(teachers.email, emails));
        const nameByEmail = new Map(matched.map((t) => [t.email.toLowerCase(), t.name]));

        const [, teacherResults] = await Promise.all([
          sendAccountConfirmNotification({
            schoolName: r.schoolName,
            schoolNameEn: r.schoolNameEn,
            emails,
            type: r.type,
            applicantType: r.applicantType || "school",
            confirmedAt: new Date(),
          }),
          Promise.allSettled(
            emails.map((email) =>
              sendTeacherUpgradedEmail({
                name: nameByEmail.get(email) || "선생님",
                email,
                schoolName: r.schoolName,
                schoolNameEn: r.schoolNameEn,
              })
            )
          ),
        ]);
        const failed = teacherResults.filter((res) => res.status === "rejected" || (res.status === "fulfilled" && !res.value.success && !res.value.skipped)).length;
        if (failed > 0) console.warn(`[account-confirm] ${failed}/${emails.length} teacher emails failed`);
      } catch (err) {
        console.warn("[account-confirm] notification email failed:", err);
      }
    })();
  }

  return NextResponse.json({ success: true });
}

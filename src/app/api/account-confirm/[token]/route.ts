export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountRequests, teachers } from "@/db/schema";
import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
import { sendAccountConfirmNotification, sendTeacherUpgradedEmail } from "@/lib/email";
import { claimAccountRequestSideEffects } from "@/lib/market-void-db";
import { getReceiverFulfillmentPausedResponse } from "@/lib/receiver-fulfillment-pause";

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
  if (["prepared", "voided"].includes(r.marketVoidState)) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }

  // 같은 학교에 실제로 발송된(sent) 다른 요청들만 노출 — Jon이 받아보지 못한 draft까지 확인 페이지에 뜨는 것 방지
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
    .where(and(
      eq(accountRequests.schoolName, r.schoolName),
      ne(accountRequests.id, r.id),
      eq(accountRequests.status, "sent"),
      notInArray(accountRequests.marketVoidState, ["prepared", "voided"]),
    ));

  return NextResponse.json({ request: r, siblings });
}

// POST: Jon이 "Upgrade Done" 클릭 → status=processed (alsoConfirmIds 있으면 같은 학교 형제 요청도 함께)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const pausedResponse = getReceiverFulfillmentPausedResponse();
  if (pausedResponse) return pausedResponse;

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
        .select({ id: accountRequests.id, emails: accountRequests.emails, schoolName: accountRequests.schoolName, schoolNameEn: accountRequests.schoolNameEn, type: accountRequests.type, applicantType: accountRequests.applicantType, status: accountRequests.status })
        .from(accountRequests)
        .where(inArray(accountRequests.id, alsoConfirmIds))
    : [];
  const sameSchoolSiblings = validSiblings.filter((s) => s.schoolName === r.schoolName);
  void allIds;

  const sideEffectIds = [...new Set([r.id, ...sameSchoolSiblings.map((s) => s.id)])];
  if (!(await claimAccountRequestSideEffects(sideEffectIds))) {
    return NextResponse.json({
      code: "MARKET_VOID_FENCED",
      error: "One or more Market orders are being cancelled or have already been voided.",
    }, { status: 409 });
  }

  // 이미 processed/invoiced/paid 인 요청은 재클릭해도 상태·확인시각을 덮어쓰지 않음 (정산 단계 후퇴 방지)
  // — Jon 입장에선 "이미 처리됨"도 정상 완료이므로 아래에서 success 응답은 그대로 반환
  const isMainUpdatable = ["draft", "sent"].includes(r.status);
  const updatableSiblingIds = sameSchoolSiblings
    .filter((s) => ["draft", "sent"].includes(s.status))
    .map((s) => s.id);
  const finalIds = [...(isMainUpdatable ? [r.id] : []), ...updatableSiblingIds];

  if (finalIds.length > 0) {
    await db
      .update(accountRequests)
      .set({ status: "processed", confirmedAt: new Date(), updatedAt: new Date() })
      .where(inArray(accountRequests.id, finalIds));
  }

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

  // 이미 처리완료(processed/invoiced/paid)였던 건을 다시 클릭하면 완료 메일 재발송 방지 (r.status는 이 확인 직전 상태)
  if (emails.length > 0 && ["draft", "sent"].includes(r.status)) {
    void (async () => {
      try {
        const { schools: schoolsTable } = await import("@/db/schema");
        const { and } = await import("drizzle-orm");
        // 같은 학교에 속한 교사만 매칭 — 동일 이메일이 다른 학교에 있어도 오매칭 방지
        const [school] = await db.select({ id: schoolsTable.id }).from(schoolsTable).where(eq(schoolsTable.name, r.schoolName));
        const matched = school
          ? await db
              .select({ email: teachers.email, name: teachers.name })
              .from(teachers)
              .where(and(eq(teachers.schoolId, school.id), inArray(teachers.email, emails)))
          : [];

        // 매칭된 같은-학교 교사들의 status도 upgraded로 (account_request 처리 = 그 학교 그 교사들 업그레이드 완료)
        if (school && matched.length > 0) {
          await db
            .update(teachers)
            .set({ status: "upgraded" })
            .where(and(eq(teachers.schoolId, school.id), inArray(teachers.email, matched.map((m) => m.email))));
        }

        const nameByEmail = new Map(matched.map((m) => [m.email.toLowerCase(), m.name]));

        // Jon 확인 완료 시점: ① 관리자(나) 알림 ② 업그레이드된 이메일(선생님) 본인에게 완료 메일 (병렬)
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

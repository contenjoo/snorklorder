export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountRequests, teachers } from "@/db/schema";
import { and, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";
import { sendAccountConfirmNotification, sendTeacherUpgradedEmail } from "@/lib/email";
import { claimAccountRequestSideEffects } from "@/lib/market-void-db";
import { getReceiverFulfillmentPausedResponse } from "@/lib/receiver-fulfillment-pause";
import { processingConfirmationValues, pendingProcessingConfirmationCondition } from "@/lib/processing-confirmation-db";
import { isMarketLegacyAuditRequest } from "@/lib/market-legacy-audit";

function legacyMarketAuditBlockedResponse() {
  return NextResponse.json({
    code: "MARKET_LEGACY_MANUAL_AUDIT_REQUIRED",
    error: "This legacy Market order is audit-only and cannot be fulfilled automatically.",
  }, { status: 409 });
}

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
  if (r.channel === 'partner' && r.partnerLifecycleState !== 'active') {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }
  if (r.channel === 'partner' && (!r.processingEmailSentAt || r.status === 'draft')) {
    return NextResponse.json({ error: "Request has not been sent to HQ" }, { status: 409 });
  }
  if (isMarketLegacyAuditRequest(r)) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }
  if (["prepared", "voided"].includes(r.marketVoidState)) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }

  // 같은 학교의 발송 이후 미확인 요청만 노출. 인보이스·결제 상태는 완료 확인과 별개다.
  const siblings = await db
    .select({
      id: accountRequests.id,
      type: accountRequests.type,
      applicantType: accountRequests.applicantType,
      emails: accountRequests.emails,
      accountType: accountRequests.accountType,
      quantity: accountRequests.quantity,
      status: accountRequests.status,
      channel: accountRequests.channel,
      externalSource: accountRequests.externalSource,
      marketRequestId: accountRequests.marketRequestId,
      marketOrderId: accountRequests.marketOrderId,
      orderNumber: accountRequests.orderNumber,
      idempotencyKey: accountRequests.idempotencyKey,
      draftOnly: accountRequests.draftOnly,
      notes: accountRequests.notes,
      createdAt: accountRequests.createdAt,
      teacherName: accountRequests.teacherName,
      subject: accountRequests.subject,
    })
    .from(accountRequests)
    .where(and(
      r.channel === 'partner' && r.partnerRequestId
        ? and(
            eq(accountRequests.partnerRequestId, r.partnerRequestId),
            eq(accountRequests.channel, 'partner'),
          )
        : eq(accountRequests.schoolName, r.schoolName),
      ne(accountRequests.id, r.id),
      inArray(accountRequests.status, ["sent", "invoiced", "paid"]),
      isNull(accountRequests.confirmedAt),
      notInArray(accountRequests.marketVoidState, ["prepared", "voided"]),
      eq(accountRequests.partnerLifecycleState, 'active'),
    ));

  return NextResponse.json({
    request: r,
    siblings: siblings.filter((sibling) => !isMarketLegacyAuditRequest(sibling)),
  });
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
  if (r.channel === 'partner' && r.partnerLifecycleState !== 'active') {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }
  if (r.channel === 'partner' && (!r.processingEmailSentAt || r.status === 'draft')) {
    return NextResponse.json({ error: "Request has not been sent to HQ" }, { status: 409 });
  }
  if (isMarketLegacyAuditRequest(r)) {
    return legacyMarketAuditBlockedResponse();
  }

  // 형제 요청도 같은 학교에 한해서만 처리 (보안: 임의 id 처리 방지)
  const validSiblings = alsoConfirmIds.length > 0
    ? await db
        .select({
          id: accountRequests.id,
          emails: accountRequests.emails,
          schoolName: accountRequests.schoolName,
          schoolNameEn: accountRequests.schoolNameEn,
          type: accountRequests.type,
          applicantType: accountRequests.applicantType,
          status: accountRequests.status,
          channel: accountRequests.channel,
          externalSource: accountRequests.externalSource,
          marketRequestId: accountRequests.marketRequestId,
          marketOrderId: accountRequests.marketOrderId,
          orderNumber: accountRequests.orderNumber,
          idempotencyKey: accountRequests.idempotencyKey,
          draftOnly: accountRequests.draftOnly,
          notes: accountRequests.notes,
          marketVoidState: accountRequests.marketVoidState,
          partnerRequestId: accountRequests.partnerRequestId,
          partnerLifecycleState: accountRequests.partnerLifecycleState,
          processingEmailSentAt: accountRequests.processingEmailSentAt,
        })
        .from(accountRequests)
        .where(and(
          inArray(accountRequests.id, alsoConfirmIds),
          r.channel === 'partner' && r.partnerRequestId
            ? and(eq(accountRequests.partnerRequestId, r.partnerRequestId), eq(accountRequests.channel, 'partner'))
            : eq(accountRequests.schoolName, r.schoolName),
          eq(accountRequests.partnerLifecycleState, 'active'),
          inArray(accountRequests.status, ["sent", "invoiced", "paid"]),
          isNull(accountRequests.confirmedAt),
          notInArray(accountRequests.marketVoidState, ["prepared", "voided"]),
        ))
    : [];
  if (validSiblings.some(isMarketLegacyAuditRequest)) {
    return legacyMarketAuditBlockedResponse();
  }
  const sameSchoolSiblings = validSiblings.filter((s) => r.channel !== 'partner'
    || Boolean(r.partnerRequestId && s.channel === 'partner' && s.partnerRequestId === r.partnerRequestId && s.processingEmailSentAt));

  const sideEffectIds = [...new Set([r.id, ...sameSchoolSiblings.map((s) => s.id)])];
  if (!(await claimAccountRequestSideEffects(sideEffectIds))) {
    return NextResponse.json({
      code: "MARKET_VOID_FENCED",
      error: "One or more Market orders are being cancelled or have already been voided.",
    }, { status: 409 });
  }

  // 조회 뒤 Stripe·관리자 writer가 invoiced/paid로 전이할 수 있으므로 id만으로
  // 덮지 않는다. 쓰기 자체에 허용 상태와 void fence를 걸고, 실제 CAS 성공 행만
  // 후속 교사 상태·메일의 대상으로 삼는다.
  const confirmationAt = new Date();
  const transitioned = await db
      .update(accountRequests)
      .set(processingConfirmationValues(confirmationAt))
      .where(and(
        inArray(accountRequests.id, sideEffectIds),
        pendingProcessingConfirmationCondition(),
        notInArray(accountRequests.marketVoidState, ["prepared", "voided"]),
      ))
      .returning({ id: accountRequests.id });
  const transitionedIds = new Set(transitioned.map((item) => item.id));
  const transitionedRequests = [r, ...sameSchoolSiblings]
    .filter((item) => transitionedIds.has(item.id));

  // 교사 환영 메일은 응답 후 백그라운드로 발송 (형제 요청 포함)
  const combinedEmailString = transitionedRequests.map((item) => item.emails).join(",");
  const emails = combinedEmailString
    .split(/[,;\n]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

  // 이미 완료 확인됐거나 다른 완료 writer가 먼저 선점한
  // 행은 transitionedRequests에 없으므로 완료 메일도 재발송하지 않는다.
  if (emails.length > 0 && transitionedRequests.length > 0) {
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
        const adminNotification = sendAccountConfirmNotification({
            schoolName: r.schoolName,
            schoolNameEn: r.schoolNameEn,
            emails,
            type: r.type,
            applicantType: r.applicantType || "school",
            confirmedAt: confirmationAt,
          });
        const teacherResults = r.channel === 'partner'
          ? []
          : await Promise.allSettled(
            emails.map((email) =>
              sendTeacherUpgradedEmail({
                name: nameByEmail.get(email) || "선생님",
                email,
                schoolName: r.schoolName,
                schoolNameEn: r.schoolNameEn,
              })
            )
          );
        await adminNotification;
        const failed = teacherResults.filter((res) => res.status === "rejected" || (res.status === "fulfilled" && !res.value.success && !res.value.skipped)).length;
        if (failed > 0) console.warn(`[account-confirm] ${failed}/${emails.length} teacher emails failed`);
      } catch (err) {
        console.warn("[account-confirm] notification email failed:", err);
      }
    })();
  }

  return NextResponse.json({ success: true, processedIds: [...transitionedIds] });
}

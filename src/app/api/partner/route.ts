import { checkAuth } from "@/lib/auth";
import { cookies } from "next/headers";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse, after } from "next/server";
import { notifyTeacherUpgrades } from "@/lib/teacher-upgrade-notify";
import { db } from "@/db";
import { schools, teachers, accountRequests, billingCycles, billingCycleItems, domainRequests } from "@/db/schema";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { canConfirmUpgrades } from "@/lib/partner-roles";
import { PARTNER_SESSION_COOKIE_NAME, verifyPartnerSessionToken } from "@/lib/signed-session";

// GET: partner dashboard data
export async function GET() {
  const partnerRole = await verifyPartnerSessionToken((await cookies()).get(PARTNER_SESSION_COOKIE_NAME)?.value);
  if (!partnerRole && !(await checkAuth())) return NextResponse.json({error:"Unauthorized"},{status:401});
  // 완료 처리 링크(토큰)는 업그레이드 확정 권한(Jon·Cailie)에게만 내려준다.
  const canConfirm = canConfirmUpgrades(partnerRole);
  const [schoolRows, teacherRows, acctRows, domRows] = await Promise.all([
    db
      .select({
        id: schools.id,
        name: schools.name,
        nameEn: schools.nameEn,
        code: schools.code,
        region: schools.region,
        team: schools.team,
      })
      .from(schools)
      .orderBy(schools.name),
    db
      .select({
        id: teachers.id,
        schoolId: teachers.schoolId,
        name: teachers.name,
        email: teachers.email,
        subject: teachers.subject,
        status: teachers.status,
        notifiedAt: teachers.notifiedAt,
        createdAt: teachers.createdAt,
      })
      .from(teachers)
      .orderBy(desc(teachers.createdAt)),
    db
      .select({
        id: accountRequests.id,
        schoolName: accountRequests.schoolName,
        schoolNameEn: accountRequests.schoolNameEn,
        type: accountRequests.type,
        applicantType: accountRequests.applicantType,
        accountType: accountRequests.accountType,
        quantity: accountRequests.quantity,
        oldEmail: accountRequests.oldEmail,
        fromType: accountRequests.fromType,
        extensionDate: accountRequests.extensionDate,
        termYears: accountRequests.termYears,
        notes: accountRequests.notes,
        confirmToken: accountRequests.confirmToken,
        emails: accountRequests.emails,
        status: accountRequests.status,
        needsInvoice: accountRequests.needsInvoice,
        invoiceNumber: accountRequests.invoiceNumber,
        invoiceAmount: accountRequests.invoiceAmount,
        createdAt: accountRequests.createdAt,
        updatedAt: accountRequests.updatedAt,
        // 통합 청구 묶음 — 마감 전 묶음은 아직 Cailie 에게 청구 요청이 나가지 않았다.
        billingCycleCode: billingCycles.code,
        billingCycleStatus: billingCycles.status,
        billingCyclePeriodEnd: billingCycles.periodEnd,
        billingCycleSentAt: billingCycles.sentAt,
      })
      .from(accountRequests)
      .leftJoin(billingCycleItems, eq(billingCycleItems.accountRequestId, accountRequests.id))
      .leftJoin(billingCycles, eq(billingCycles.id, billingCycleItems.cycleId))
      .where(and(
        inArray(accountRequests.status, ["sent", "processed", "invoiced"]),
        notInArray(accountRequests.marketVoidState, ["prepared", "voided"]),
      ))
      .orderBy(desc(accountRequests.updatedAt)),
    db
      .select({
        id: domainRequests.id,
        schoolName: domainRequests.schoolName,
        schoolNameEn: domainRequests.schoolNameEn,
        domain: domainRequests.domain,
        team: domainRequests.team,
        status: domainRequests.status,
        invoiceNumber: domainRequests.invoiceNumber,
        invoiceAmount: domainRequests.invoiceAmount,
        createdAt: domainRequests.createdAt,
        updatedAt: domainRequests.updatedAt,
      })
      .from(domainRequests)
      .where(inArray(domainRequests.status, ["pending", "done", "invoiced"]))
      .orderBy(desc(domainRequests.updatedAt)),
  ]);

  const teachersBySchool = new Map<number, typeof teacherRows>();
  for (const t of teacherRows) {
    if (!teachersBySchool.has(t.schoolId)) teachersBySchool.set(t.schoolId, []);
    teachersBySchool.get(t.schoolId)!.push(t);
  }

  const result = schoolRows.map((s) => {
    const tcs = teachersBySchool.get(s.id) || [];
    return {
      ...s,
      teachers: tcs,
      counts: {
        total: tcs.length,
        pending: tcs.filter((t) => t.status === "pending").length,
        sent: tcs.filter((t) => t.status === "sent").length,
        upgraded: tcs.filter((t) => t.status === "upgraded").length,
      },
    };
  });

  const accountRows = acctRows.map(({ confirmToken, ...row }) => ({
    ...row,
    // 처리 대기(sent) 건만 화면에서 완료 처리할 수 있다.
    confirmToken: canConfirm && row.status === "sent" ? confirmToken : null,
  }));
  return NextResponse.json({ schools: result, accountRequests: accountRows, domainRequests: domRows });
}

// PATCH: Jon/Cailie marks teachers as upgraded
export async function PATCH(req: NextRequest) {
  // Check role — only Jon or Cailie can upgrade
  const cookie = req.cookies.get(PARTNER_SESSION_COOKIE_NAME);
  const role = await verifyPartnerSessionToken(cookie?.value);
  if (!canConfirmUpgrades(role)) {
    return NextResponse.json({ error: "Only Jon or Cailie can mark upgrades" }, { status: 403 });
  }

  const body = await req.json().catch(()=>null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({error:"Invalid JSON"},{status:400});
  const { ids } = body;

  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 || !ids.every((id) => Number.isSafeInteger(id) && id > 0 && id <= 2147483647)) {
    return NextResponse.json({ error: "Teacher IDs required" }, { status: 400 });
  }

  // 본사 화면에 올린(sent) 승인 교사만 — 미승인·이미 완료된 교사는 건드리지 않는다.
  const upgraded = await db
    .update(teachers)
    .set({ status: "upgraded" })
    .where(and(inArray(teachers.id, ids), eq(teachers.status, "sent"), eq(teachers.verificationStatus, "approved")))
    .returning({ id: teachers.id });
  const upgradedIds = upgraded.map((t) => t.id);
  const confirmedAt = new Date();
  // 이메일 확인 링크와 같은 알림(관리자 알림 + 교사 완료 메일)을 응답 뒤 끝까지 보낸다.
  after(() => notifyTeacherUpgrades(upgradedIds, confirmedAt));

  return NextResponse.json({ success: true, upgraded: upgradedIds.length });
}

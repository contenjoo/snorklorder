export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { desc, eq, ne, inArray, sql, and, gte, isNotNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { schools, teachers, upgradeBatches, emailLogs, teams, accountRequests, domainRequests } from "@/db/schema";
import { checkAuth } from "@/lib/auth";

type SchoolCounts = {
  total: number;
  pending: number;
  sent: number;
  upgraded: number;
  individual: number;
  confirmed: number;
};

const emptyCounts: SchoolCounts = {
  total: 0,
  pending: 0,
  sent: 0,
  upgraded: 0,
  individual: 0,
  confirmed: 0,
};

export async function GET() {
  if (!(await checkAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [schoolRows, countRows, pendingRows, recentRows, recentBatchRows, recentFailedEmails, teamRows, openAccountRequests, openDomainRequests, approvalQueueRows, pipelineRows, monthlyBatchRows, activityEmailRows, activityConfirmRows, billingStatusRows] = await Promise.all([
    db
      .select({
        id: schools.id,
        name: schools.name,
        nameEn: schools.nameEn,
        region: schools.region,
        team: schools.team,
      })
      .from(schools)
      .orderBy(schools.team, schools.name),
    db
      .select({
        schoolId: teachers.schoolId,
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where ${teachers.status} = 'pending')::int`,
        sent: sql<number>`count(*) filter (where ${teachers.status} = 'sent')::int`,
        upgraded: sql<number>`count(*) filter (where ${teachers.status} = 'upgraded')::int`,
        individual: sql<number>`count(*) filter (where ${teachers.status} = 'individual')::int`,
        confirmed: sql<number>`count(*) filter (where ${teachers.status} in ('upgraded', 'individual'))::int`,
      })
      .from(teachers)
      .groupBy(teachers.schoolId),
    db
      .select({
        id: teachers.id,
        schoolId: teachers.schoolId,
        name: teachers.name,
        email: teachers.email,
        status: teachers.status,
        createdAt: teachers.createdAt,
        notifiedAt: teachers.notifiedAt,
        schoolName: schools.name,
        schoolNameEn: schools.nameEn,
        schoolTeam: schools.team,
      })
      .from(teachers)
      .innerJoin(schools, eq(teachers.schoolId, schools.id))
      // Jon 발송 후보: 검증·승인 완료(approved)된 교사만 노출
      .where(and(inArray(teachers.status, ["pending", "sent"]), eq(teachers.verificationStatus, "approved")))
      .orderBy(desc(teachers.createdAt)),
    db
      .select({
        id: teachers.id,
        schoolId: teachers.schoolId,
        name: teachers.name,
        email: teachers.email,
        status: teachers.status,
        createdAt: teachers.createdAt,
        schoolName: schools.name,
        schoolNameEn: schools.nameEn,
        schoolTeam: schools.team,
      })
      .from(teachers)
      .innerJoin(schools, eq(teachers.schoolId, schools.id))
      .orderBy(desc(teachers.createdAt))
      .limit(8),
    db
      .select({
        id: upgradeBatches.id,
        confirmedAt: upgradeBatches.confirmedAt,
        confirmedIds: upgradeBatches.confirmedIds,
      })
      .from(upgradeBatches)
      .where(eq(upgradeBatches.status, "confirmed"))
      .orderBy(desc(upgradeBatches.confirmedAt))
      .limit(5),
    db
      .select({
        id: emailLogs.id,
        toEmail: emailLogs.toEmail,
        subject: emailLogs.subject,
        kind: emailLogs.kind,
        errorMessage: emailLogs.errorMessage,
        createdAt: emailLogs.createdAt,
      })
      .from(emailLogs)
      .where(and(
        eq(emailLogs.status, "failed"),
        // 폐기된 종류(OTP 등록 인증) 제외
        ne(emailLogs.kind, "email_verify"),
        // 이후 같은 수신자·종류로 성공(복구)한 실패는 제외
        sql`not exists (select 1 from ${emailLogs} e2 where e2.to_email = ${emailLogs.toEmail} and e2.kind = ${emailLogs.kind} and e2.status = 'success' and e2.created_at > ${emailLogs.createdAt})`,
      ))
      .orderBy(desc(emailLogs.createdAt))
      .limit(10),
    db.select({ code: teams.code, labelEn: teams.labelEn, colorPalette: teams.colorPalette, kind: teams.kind, isActive: teams.isActive }).from(teams),
    db.select({
      id: accountRequests.id,
      schoolName: accountRequests.schoolName,
      schoolNameEn: accountRequests.schoolNameEn,
      type: accountRequests.type,
      applicantType: accountRequests.applicantType,
      emails: accountRequests.emails,
      status: accountRequests.status,
      invoiceNumber: accountRequests.invoiceNumber,
      invoiceAmount: accountRequests.invoiceAmount,
      invoiceDueDate: accountRequests.invoiceDueDate,
      paymentLink: accountRequests.paymentLink,
      paymentDate: accountRequests.paymentDate,
      createdAt: accountRequests.createdAt,
      updatedAt: accountRequests.updatedAt,
      confirmedAt: accountRequests.confirmedAt,
    }).from(accountRequests).where(and(
      inArray(accountRequests.status, ["draft", "sent", "processed", "invoiced"]),
      notInArray(accountRequests.marketVoidState, ["prepared", "voided"]),
    )).orderBy(desc(accountRequests.updatedAt)),
    db.select({
      id: domainRequests.id,
      schoolName: domainRequests.schoolName,
      schoolNameEn: domainRequests.schoolNameEn,
      domain: domainRequests.domain,
      team: domainRequests.team,
      status: domainRequests.status,
      invoiceNumber: domainRequests.invoiceNumber,
      invoiceAmount: domainRequests.invoiceAmount,
      invoiceDueDate: domainRequests.invoiceDueDate,
      paymentLink: domainRequests.paymentLink,
      paymentDate: domainRequests.paymentDate,
      createdAt: domainRequests.createdAt,
      updatedAt: domainRequests.updatedAt,
      confirmedAt: domainRequests.confirmedAt,
    }).from(domainRequests).where(inArray(domainRequests.status, ["pending", "done", "invoiced"])).orderBy(desc(domainRequests.updatedAt)),
    // 승인 대기 큐: 아직 승인되지 않은 모든 등록 (unverified=레거시 + email_verified). 본사가 백스톱으로 전체를 본다.
    db
      .select({
        id: teachers.id,
        schoolId: teachers.schoolId,
        name: teachers.name,
        email: teachers.email,
        subject: teachers.subject,
        verificationStatus: teachers.verificationStatus,
        emailVerifiedAt: teachers.emailVerifiedAt,
        escalatedAt: teachers.escalatedAt,
        createdAt: teachers.createdAt,
        schoolName: schools.name,
        schoolNameEn: schools.nameEn,
        schoolTeam: schools.team,
      })
      .from(teachers)
      .innerJoin(schools, eq(teachers.schoolId, schools.id))
      .where(and(eq(teachers.status, "pending"), inArray(teachers.verificationStatus, ["unverified", "email_verified"])))
      .orderBy(desc(teachers.createdAt)),
    // 파이프라인 카운트 (검증 인지)
    db
      .select({
        awaitingApproval: sql<number>`count(*) filter (where ${teachers.status} = 'pending' and ${teachers.verificationStatus} in ('unverified','email_verified'))::int`,
        readyForJon: sql<number>`count(*) filter (where ${teachers.status} = 'pending' and ${teachers.verificationStatus} = 'approved')::int`,
        sentToJon: sql<number>`count(*) filter (where ${teachers.status} = 'sent' and ${teachers.verificationStatus} = 'approved')::int`,
      })
      .from(teachers),
    // KPI: 이번 달 확정 배치 (업그레이드 인원·학교 수 집계용)
    db
      .select({ confirmedIds: upgradeBatches.confirmedIds })
      .from(upgradeBatches)
      .where(and(eq(upgradeBatches.status, "confirmed"), gte(upgradeBatches.confirmedAt, monthStart))),
    // 활동 피드: 최근 메일 발송 로그 (성공/실패)
    db
      .select({
        id: emailLogs.id,
        toEmail: emailLogs.toEmail,
        subject: emailLogs.subject,
        kind: emailLogs.kind,
        status: emailLogs.status,
        createdAt: emailLogs.createdAt,
      })
      .from(emailLogs)
      .where(and(ne(emailLogs.kind, "email_verify"), inArray(emailLogs.status, ["success", "failed"])))
      .orderBy(desc(emailLogs.createdAt))
      .limit(15),
    // 활동 피드: Jon confirm 최근 건
    db
      .select({
        id: accountRequests.id,
        schoolName: accountRequests.schoolName,
        schoolNameEn: accountRequests.schoolNameEn,
        confirmedAt: accountRequests.confirmedAt,
      })
      .from(accountRequests)
      .where(isNotNull(accountRequests.confirmedAt))
      .orderBy(desc(accountRequests.confirmedAt))
      .limit(10),
    // 정산 파이프라인: 상태별 건수 (paid 포함 전체)
    db
      .select({ status: accountRequests.status, count: sql<number>`count(*)::int` })
      .from(accountRequests)
      .where(notInArray(accountRequests.marketVoidState, ["prepared", "voided"]))
      .groupBy(accountRequests.status),
  ]);

  // Hydrate recent confirmed batches with school summaries — one query covers all batches
  type SchoolSummaryItem = { name: string; nameEn: string | null; team: string | null; count: number };
  const recentBatches: { id: number; confirmedAt: Date | null; count: number; schools: SchoolSummaryItem[] }[] = [];
  const batchIds: { batchId: number; ids: number[] }[] = recentBatchRows.map((batch) => {
    let ids: number[] = [];
    try { ids = batch.confirmedIds ? (JSON.parse(batch.confirmedIds) as number[]) : []; } catch { /* keep empty */ }
    return { batchId: batch.id, ids };
  });
  const allTeacherIds = [...new Set(batchIds.flatMap((b) => b.ids))];
  const teacherSchoolMap = new Map<number, { name: string; nameEn: string | null; team: string | null }>();
  if (allTeacherIds.length > 0) {
    const rows = await db
      .select({ id: teachers.id, name: schools.name, nameEn: schools.nameEn, team: schools.team })
      .from(teachers)
      .innerJoin(schools, eq(teachers.schoolId, schools.id))
      .where(inArray(teachers.id, allTeacherIds));
    for (const r of rows) teacherSchoolMap.set(r.id, { name: r.name, nameEn: r.nameEn, team: r.team });
  }
  for (const batch of recentBatchRows) {
    const ids = batchIds.find((b) => b.batchId === batch.id)!.ids;
    const map = new Map<string, SchoolSummaryItem>();
    for (const id of ids) {
      const s = teacherSchoolMap.get(id);
      if (!s) continue;
      if (!map.has(s.name)) map.set(s.name, { ...s, count: 0 });
      map.get(s.name)!.count++;
    }
    recentBatches.push({
      id: batch.id,
      confirmedAt: batch.confirmedAt,
      count: ids.length,
      schools: Array.from(map.values()),
    });
  }

  const countsBySchool = new Map<number, SchoolCounts>();
  for (const row of countRows) {
    countsBySchool.set(row.schoolId, {
      total: Number(row.total),
      pending: Number(row.pending),
      sent: Number(row.sent),
      upgraded: Number(row.upgraded),
      individual: Number(row.individual),
      confirmed: Number(row.confirmed),
    });
  }

  const schoolSummaries = schoolRows.map((school) => {
    const counts = countsBySchool.get(school.id) || emptyCounts;
    return {
      ...school,
      teacherCount: counts.total,
      pendingCount: counts.pending,
      sentCount: counts.sent,
      upgradedCount: counts.upgraded,
      individualCount: counts.individual,
      confirmedCount: counts.confirmed,
    };
  });

  const stats = schoolSummaries.reduce(
    (acc, school) => ({
      totalSchools: acc.totalSchools + 1,
      totalTeachers: acc.totalTeachers + school.teacherCount,
      pending: acc.pending + school.pendingCount,
      sent: acc.sent + school.sentCount,
      upgraded: acc.upgraded + school.upgradedCount,
      individual: acc.individual + school.individualCount,
      confirmed: acc.confirmed + school.confirmedCount,
    }),
    {
      totalSchools: 0,
      totalTeachers: 0,
      pending: 0,
      sent: 0,
      upgraded: 0,
      individual: 0,
      confirmed: 0,
    }
  );

  const pendingBySchool = new Map<number, typeof pendingRows>();
  for (const teacher of pendingRows) {
    if (!pendingBySchool.has(teacher.schoolId)) pendingBySchool.set(teacher.schoolId, []);
    pendingBySchool.get(teacher.schoolId)!.push(teacher);
  }

  const upgradeNeeded = schoolSummaries
    .map((school) => ({
      ...school,
      needTeachers: pendingBySchool.get(school.id) || [],
    }))
    .filter((school) => school.needTeachers.length > 0)
    .sort((a, b) => b.needTeachers.length - a.needTeachers.length);

  const teamMap = new Map<string, typeof schoolSummaries>();
  for (const school of schoolSummaries) {
    if (school.team && !school.team.includes("개별") && school.team !== "미배정" && school.team !== "취소") {
      if (!teamMap.has(school.team)) teamMap.set(school.team, []);
      teamMap.get(school.team)!.push(school);
    }
  }

  const teamGroups = Array.from(teamMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([team, teamSchools]) => ({
      team,
      schools: teamSchools,
      schoolCount: teamSchools.length,
      teacherCount: teamSchools.reduce((sum, school) => sum + school.teacherCount, 0),
      confirmedCount: teamSchools.reduce((sum, school) => sum + school.confirmedCount, 0),
    }));

  const regionMap = new Map<string, { schools: number; teachers: number }>();
  for (const school of schoolSummaries) {
    const region = school.region || "기타";
    if (!regionMap.has(region)) regionMap.set(region, { schools: 0, teachers: 0 });
    const current = regionMap.get(region)!;
    current.schools++;
    current.teachers += school.teacherCount;
  }

  const regions = Array.from(regionMap.entries())
    .map(([region, data]) => ({ region, ...data }))
    .sort((a, b) => b.teachers - a.teachers)
    .slice(0, 6);

  // 이번 달 업그레이드: 확정 배치의 teacher id를 모아 인원 수 + 학교 수 산출
  const monthlyTeacherIds = [
    ...new Set(
      monthlyBatchRows.flatMap((batch) => {
        try {
          return batch.confirmedIds ? (JSON.parse(batch.confirmedIds) as number[]) : [];
        } catch {
          return [];
        }
      })
    ),
  ];
  let monthlySchoolCount = 0;
  if (monthlyTeacherIds.length > 0) {
    const rows = await db
      .selectDistinct({ schoolId: teachers.schoolId })
      .from(teachers)
      .where(inArray(teachers.id, monthlyTeacherIds));
    monthlySchoolCount = rows.length;
  }
  const monthlyUpgrades = { teachers: monthlyTeacherIds.length, schools: monthlySchoolCount };

  // 활동 피드: 메일 로그 + Jon confirm 두 쿼리를 merge 후 시간순 정렬
  type ActivityItem = {
    id: string;
    type: "email" | "confirm";
    at: Date;
    status?: string;
    kind?: string;
    toEmail?: string;
    subject?: string;
    schoolName?: string;
    schoolNameEn?: string | null;
  };
  const activity: ActivityItem[] = [
    ...activityEmailRows.map((e) => ({
      id: `e-${e.id}`,
      type: "email" as const,
      at: e.createdAt,
      status: e.status,
      kind: e.kind,
      toEmail: e.toEmail,
      subject: e.subject,
    })),
    ...activityConfirmRows
      .filter((c): c is typeof c & { confirmedAt: Date } => c.confirmedAt !== null)
      .map((c) => ({
        id: `c-${c.id}`,
        type: "confirm" as const,
        at: c.confirmedAt,
        schoolName: c.schoolName,
        schoolNameEn: c.schoolNameEn,
      })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 15);

  const billingStatusCounts: Record<string, number> = {};
  for (const row of billingStatusRows) billingStatusCounts[row.status] = Number(row.count);

  return NextResponse.json({
    stats,
    teamGroups,
    upgradeNeeded,
    recentTeachers: recentRows,
    recentBatches,
    recentFailedEmails,
    teams: teamRows,
    openAccountRequests,
    openDomainRequests,
    regions,
    approvalQueue: approvalQueueRows,
    pipeline: pipelineRows[0] ?? { awaitingApproval: 0, readyForJon: 0, sentToJon: 0 },
    monthlyUpgrades,
    activity,
    billingStatusCounts,
  });
}

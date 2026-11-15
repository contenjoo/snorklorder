import { checkAuth } from "@/lib/auth";
// 관리자 인사이트 집계 — /admin/insights 전용.
// 학교급은 DB 컬럼이 없어 이름/영문명에서 유도하므로(schoolLevel) 집계도 여기서 JS 로 수행한다.
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { schools, teachers, accountRequests } from "@/db/schema";
import { and, isNull, eq, notInArray, sql } from "drizzle-orm";
import { schoolLevel, type SchoolLevel } from "@/lib/school-level";
import { subjectFamily } from "@/lib/subject";

export async function GET() {
  if (!(await checkAuth())) return NextResponse.json({error:"Unauthorized"},{status:401});
  // NULL 팀은 정상 학교로 유지한다. 모든 교사 지표에 동일한 완료 기준을 적용한다.
  const activeSchool = sql`${schools.team} is distinct from '취소'`;
  const completedTeacher = and(eq(teachers.status, "upgraded"), eq(teachers.verificationStatus, "approved"));
  const [rows, monthlyTeachers, monthlyRequests] = await Promise.all([
    db.select({
      schoolId: schools.id, schoolName: schools.name, schoolNameEn: schools.nameEn,
      team: schools.team, subject: teachers.subject, teacherId: teachers.id,
    }).from(schools).leftJoin(teachers, and(eq(teachers.schoolId, schools.id), completedTeacher))
      .where(activeSchool),

    db.select({
      month: sql<string>`to_char(${teachers.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
    }).from(teachers).innerJoin(schools, eq(teachers.schoolId, schools.id))
      .where(and(activeSchool, completedTeacher)).groupBy(sql`1`).orderBy(sql`1`),

    db.select({
      month: sql<string>`to_char(${accountRequests.createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`,
      requests: sql<number>`count(*)::int`,
      seats: sql<number>`sum(coalesce(${accountRequests.quantity}, 0))::int`,
    }).from(accountRequests)
      .where(and(isNull(accountRequests.archivedAt), notInArray(accountRequests.marketVoidState, ["prepared", "voided"]), eq(accountRequests.partnerLifecycleState, "active")))
      .groupBy(sql`1`).orderBy(sql`1`),
  ]);

  // ── 학교급 ──────────────────────────────────────────────
  const LEVELS: SchoolLevel[] = ["초", "중", "고"];
  const byLevel: Record<string, { teachers: number; schools: number }> = {
    초: { teachers: 0, schools: 0 }, 중: { teachers: 0, schools: 0 },
    고: { teachers: 0, schools: 0 }, 미분류: { teachers: 0, schools: 0 },
  };
  // 과목: 급별 + 전체
  const subjectTotals = new Map<string, number>();
  const subjectByLevel = new Map<string, Record<string, number>>();
  let subjectFilled = 0;

  const seenSchools = new Set<number>();
  const perSchool = new Map<number, { name: string; nameEn: string | null; level: string; team: string | null; count: number }>();

  for (const r of rows) {
    const lv = schoolLevel(r.schoolName, r.schoolNameEn) ?? "미분류";
    if (!seenSchools.has(r.schoolId)) {
      seenSchools.add(r.schoolId);
      perSchool.set(r.schoolId, { name: r.schoolName, nameEn: r.schoolNameEn, level: lv, team: r.team, count: 0 });
    }
    if (r.teacherId == null) continue; // 교사 0명 학교의 left join null 행
    byLevel[lv].teachers++;
    const school = perSchool.get(r.schoolId)!;
    if (school.count === 0) byLevel[lv].schools++;
    school.count++;

    const fam = subjectFamily(r.subject);
    if (fam) {
      subjectFilled++;
      subjectTotals.set(fam, (subjectTotals.get(fam) ?? 0) + 1);
      const m = subjectByLevel.get(fam) ?? { 초: 0, 중: 0, 고: 0, 미분류: 0 };
      m[lv]++;
      subjectByLevel.set(fam, m);
    }
  }

  const totalTeachers = LEVELS.reduce((s, l) => s + byLevel[l].teachers, 0) + byLevel.미분류.teachers;

  const subjects = [...subjectTotals.entries()]
    .map(([name, count]) => ({ name, count, byLevel: subjectByLevel.get(name)! }))
    .sort((a, b) => b.count - a.count);

  const topSchools = [...perSchool.values()]
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // 집중도: 상위 N 개교가 전체 교사의 몇 %인지
  const sizes = [...perSchool.values()].map((s) => s.count).filter((c) => c > 0).sort((a, b) => b - a);
  const middle = Math.floor(sizes.length / 2);
  const median = sizes.length === 0 ? 0 : sizes.length % 2
    ? sizes[middle] : (sizes[middle - 1] + sizes[middle]) / 2;
  const cum = (n: number) => sizes.slice(0, n).reduce((a, b) => a + b, 0);

  return NextResponse.json({
    totals: {
      teachers: totalTeachers,
      schools: sizes.length,
      schoolsRegistered: seenSchools.size,
      avgPerSchool: sizes.length ? +(totalTeachers / sizes.length).toFixed(1) : 0,
      medianPerSchool: median,
      top10Share: totalTeachers ? Math.round((cum(10) / totalTeachers) * 100) : 0,
      top20Share: totalTeachers ? Math.round((cum(20) / totalTeachers) * 100) : 0,
      singleTeacherSchools: sizes.filter((c) => c === 1).length,
    },
    levels: LEVELS.map((l) => ({ level: l, ...byLevel[l] })),
    unclassified: byLevel.미분류,
    subjects,
    topSchools,
    subjectCoverage: { filled: subjectFilled, total: totalTeachers },
    monthlyTeachers,
    monthlyRequests,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

// 관리자 인사이트 집계 — /admin/insights 전용.
// 학교급은 DB 컬럼이 없어 이름/영문명에서 유도하므로(schoolLevel) 집계도 여기서 JS 로 수행한다.
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { schools, teachers, accountRequests } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { schoolLevel, type SchoolLevel } from "@/lib/school-level";
import { subjectFamily } from "@/lib/subject";

export async function GET() {
  const [rows, monthlyTeachers, monthlyRequests] = await Promise.all([
    db.select({
      schoolId: schools.id, schoolName: schools.name, schoolNameEn: schools.nameEn,
      team: schools.team, subject: teachers.subject, teacherId: teachers.id,
    }).from(schools).leftJoin(teachers, eq(teachers.schoolId, schools.id)),

    db.select({
      month: sql<string>`to_char(${teachers.createdAt}, 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
    }).from(teachers).groupBy(sql`1`).orderBy(sql`1`),

    db.select({
      month: sql<string>`to_char(${accountRequests.createdAt}, 'YYYY-MM')`,
      requests: sql<number>`count(*)::int`,
      seats: sql<number>`sum(coalesce(${accountRequests.quantity}, 0))::int`,
    }).from(accountRequests).groupBy(sql`1`).orderBy(sql`1`),
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
      byLevel[lv].schools++;
      perSchool.set(r.schoolId, { name: r.schoolName, nameEn: r.schoolNameEn, level: lv, team: r.team, count: 0 });
    }
    if (r.teacherId == null) continue; // 교사 0명 학교의 left join null 행
    byLevel[lv].teachers++;
    perSchool.get(r.schoolId)!.count++;

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
  const cum = (n: number) => sizes.slice(0, n).reduce((a, b) => a + b, 0);

  return NextResponse.json({
    totals: {
      teachers: totalTeachers,
      schools: sizes.length,
      schoolsRegistered: seenSchools.size,
      avgPerSchool: sizes.length ? +(totalTeachers / sizes.length).toFixed(1) : 0,
      medianPerSchool: sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0,
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
  }, { headers: { "Cache-Control": "private, max-age=60" } });
}

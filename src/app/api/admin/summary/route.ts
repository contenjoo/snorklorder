export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { schools, teachers, upgradeBatches } from "@/db/schema";
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

  const [schoolRows, countRows, pendingRows, recentRows, recentBatchRows] = await Promise.all([
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
        schoolName: schools.name,
        schoolNameEn: schools.nameEn,
        schoolTeam: schools.team,
      })
      .from(teachers)
      .innerJoin(schools, eq(teachers.schoolId, schools.id))
      .where(inArray(teachers.status, ["pending", "sent"]))
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
  ]);

  // Hydrate recent confirmed batches with school summaries
  const recentBatches: { id: number; confirmedAt: Date | null; count: number; schools: { name: string; nameEn: string | null; team: string | null; count: number }[] }[] = [];
  for (const batch of recentBatchRows) {
    let ids: number[] = [];
    try { ids = batch.confirmedIds ? (JSON.parse(batch.confirmedIds) as number[]) : []; } catch { ids = []; }
    if (ids.length === 0) {
      recentBatches.push({ id: batch.id, confirmedAt: batch.confirmedAt, count: 0, schools: [] });
      continue;
    }
    const rows = await db
      .select({ name: schools.name, nameEn: schools.nameEn, team: schools.team })
      .from(teachers)
      .innerJoin(schools, eq(teachers.schoolId, schools.id))
      .where(inArray(teachers.id, ids));
    const map = new Map<string, { name: string; nameEn: string | null; team: string | null; count: number }>();
    for (const r of rows) {
      const key = r.name;
      if (!map.has(key)) map.set(key, { name: r.name, nameEn: r.nameEn, team: r.team, count: 0 });
      map.get(key)!.count++;
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
    if (school.team && !school.team.includes("개별") && school.team !== "미배정") {
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

  return NextResponse.json({
    stats,
    teamGroups,
    upgradeNeeded,
    recentTeachers: recentRows,
    recentBatches,
    regions,
  });
}

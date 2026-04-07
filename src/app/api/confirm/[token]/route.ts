export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { upgradeBatches, teachers, schools } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

// GET: 배치 정보 + 교사 목록 조회
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const [batch] = await db
    .select()
    .from(upgradeBatches)
    .where(eq(upgradeBatches.token, token));

  if (!batch) {
    return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  }

  const teacherIds: number[] = JSON.parse(batch.teacherIds);
  const confirmedIds: number[] = batch.confirmedIds
    ? JSON.parse(batch.confirmedIds)
    : [];

  // 배치 교사 + 학교 정보
  const teacherList = await db
    .select({
      id: teachers.id,
      name: teachers.name,
      email: teachers.email,
      subject: teachers.subject,
      status: teachers.status,
      schoolName: schools.name,
    })
    .from(teachers)
    .innerJoin(schools, eq(teachers.schoolId, schools.id))
    .where(inArray(teachers.id, teacherIds));

  // 전체 학교 현황 (Jon이 볼 수 있게)
  const allSchools = await db
    .select({
      id: schools.id,
      name: schools.name,
      nameEn: schools.nameEn,
      code: schools.code,
      region: schools.region,
      team: schools.team,
    })
    .from(schools);

  const allTeachers = await db
    .select({
      id: teachers.id,
      email: teachers.email,
      status: teachers.status,
      schoolId: teachers.schoolId,
    })
    .from(teachers);

  // 학교별 교사 수 집계
  const schoolSummary = allSchools.map((s) => {
    const sTeachers = allTeachers.filter((t) => t.schoolId === s.id);
    return {
      ...s,
      total: sTeachers.length,
      pending: sTeachers.filter((t) => t.status === "pending").length,
      sent: sTeachers.filter((t) => t.status === "sent").length,
      upgraded: sTeachers.filter((t) => t.status === "upgraded").length,
    };
  }).filter((s) => s.total > 0);

  return NextResponse.json({
    batch: {
      id: batch.id,
      status: batch.status,
      createdAt: batch.createdAt,
      confirmedAt: batch.confirmedAt,
    },
    teachers: teacherList,
    confirmedIds,
    schoolSummary,
    stats: {
      totalSchools: schoolSummary.length,
      totalTeachers: allTeachers.length,
      pending: allTeachers.filter((t) => t.status === "pending").length,
      sent: allTeachers.filter((t) => t.status === "sent").length,
      upgraded: allTeachers.filter((t) => t.status === "upgraded").length,
    },
  });
}

// POST: Jon이 확인 완료 처리
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await req.json();
  const { confirmedTeacherIds } = body as { confirmedTeacherIds: number[] };

  const [batch] = await db
    .select()
    .from(upgradeBatches)
    .where(eq(upgradeBatches.token, token));

  if (!batch) {
    return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  }

  // 배치 업데이트
  await db
    .update(upgradeBatches)
    .set({
      confirmedIds: JSON.stringify(confirmedTeacherIds),
      status: "confirmed",
      confirmedAt: new Date(),
    })
    .where(eq(upgradeBatches.id, batch.id));

  // 확인된 교사들 상태를 upgraded로 변경
  if (confirmedTeacherIds.length > 0) {
    await db
      .update(teachers)
      .set({ status: "upgraded" })
      .where(inArray(teachers.id, confirmedTeacherIds));
  }

  return NextResponse.json({ success: true, count: confirmedTeacherIds.length });
}

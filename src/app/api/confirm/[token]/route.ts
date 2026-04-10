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

  const teacherList = await db
    .select({
      id: teachers.id,
      name: teachers.name,
      email: teachers.email,
      subject: teachers.subject,
      status: teachers.status,
      schoolName: schools.name,
      schoolNameEn: schools.nameEn,
      schoolTeam: schools.team,
    })
    .from(teachers)
    .innerJoin(schools, eq(teachers.schoolId, schools.id))
    .where(inArray(teachers.id, teacherIds));
  const uniqueSchools = new Set(teacherList.map((teacher) => teacher.schoolName));

  return NextResponse.json({
    batch: {
      id: batch.id,
      status: batch.status,
      createdAt: batch.createdAt,
      confirmedAt: batch.confirmedAt,
    },
    teachers: teacherList,
    confirmedIds,
    stats: {
      totalSchools: uniqueSchools.size,
      totalTeachers: teacherList.length,
      pending: teacherList.filter((teacher) => teacher.status === "pending").length,
      sent: teacherList.filter((teacher) => teacher.status === "sent").length,
      upgraded: teacherList.filter((teacher) => teacher.status === "upgraded").length,
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

  if (!Array.isArray(confirmedTeacherIds)) {
    return NextResponse.json({ error: "confirmedTeacherIds must be an array" }, { status: 400 });
  }

  const allowedTeacherIds: number[] = JSON.parse(batch.teacherIds);
  const allowedTeacherIdSet = new Set(allowedTeacherIds);
  const normalizedConfirmedIds = [...new Set(
    confirmedTeacherIds.filter((id): id is number => Number.isInteger(id))
  )];
  const invalidIds = normalizedConfirmedIds.filter((id) => !allowedTeacherIdSet.has(id));

  if (invalidIds.length > 0) {
    return NextResponse.json({ error: "Invalid teacher IDs in confirmation request" }, { status: 400 });
  }

  // 배치 업데이트
  await db
    .update(upgradeBatches)
    .set({
      confirmedIds: JSON.stringify(normalizedConfirmedIds),
      status: "confirmed",
      confirmedAt: new Date(),
    })
    .where(eq(upgradeBatches.id, batch.id));

  // 확인된 교사들 상태를 upgraded로 변경
  if (normalizedConfirmedIds.length > 0) {
    await db
      .update(teachers)
      .set({ status: "upgraded" })
      .where(inArray(teachers.id, normalizedConfirmedIds));
  }

  return NextResponse.json({ success: true, count: normalizedConfirmedIds.length });
}

export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { upgradeBatches, teachers, schools } from "@/db/schema";
import { eq, inArray, and, notInArray } from "drizzle-orm";

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
      schoolId: teachers.schoolId,
      schoolName: schools.name,
      schoolNameEn: schools.nameEn,
      schoolTeam: schools.team,
    })
    .from(teachers)
    .innerJoin(schools, eq(teachers.schoolId, schools.id))
    .where(inArray(teachers.id, teacherIds));
  // 같은 학교의 신규 pending/sent 교사 조회 (배치에 없는)
  const schoolIds = [...new Set(teacherList.map((t) => t.schoolId))];
  let newTeachers: typeof teacherList = [];
  if (schoolIds.length > 0 && teacherIds.length > 0) {
    newTeachers = await db
      .select({
        id: teachers.id,
        name: teachers.name,
        email: teachers.email,
        subject: teachers.subject,
        status: teachers.status,
        schoolName: schools.name,
        schoolNameEn: schools.nameEn,
        schoolTeam: schools.team,
        schoolId: teachers.schoolId,
      })
      .from(teachers)
      .innerJoin(schools, eq(teachers.schoolId, schools.id))
      .where(
        and(
          inArray(teachers.schoolId, schoolIds),
          notInArray(teachers.id, teacherIds),
          inArray(teachers.status, ["pending", "sent"])
        )
      );
  }

  const uniqueSchools = new Set(teacherList.map((teacher) => teacher.schoolName));
  const allTeachers = [...teacherList, ...newTeachers];

  return NextResponse.json({
    batch: {
      id: batch.id,
      status: batch.status,
      createdAt: batch.createdAt,
      confirmedAt: batch.confirmedAt,
    },
    teachers: teacherList,
    newTeachers,
    confirmedIds,
    stats: {
      totalSchools: uniqueSchools.size,
      totalTeachers: allTeachers.length,
      pending: allTeachers.filter((teacher) => teacher.status === "pending").length,
      sent: allTeachers.filter((teacher) => teacher.status === "sent").length,
      upgraded: allTeachers.filter((teacher) => teacher.status === "upgraded").length,
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

  const batchTeacherIds: number[] = JSON.parse(batch.teacherIds);
  const normalizedConfirmedIds = [...new Set(
    confirmedTeacherIds.filter((id): id is number => Number.isInteger(id))
  )];

  // 신규 교사도 배치에 추가 (같은 학교의 pending/sent 교사)
  const newIds = normalizedConfirmedIds.filter((id) => !batchTeacherIds.includes(id));
  const updatedBatchIds = [...new Set([...batchTeacherIds, ...newIds])];

  // 배치 업데이트 (신규 교사 포함)
  await db
    .update(upgradeBatches)
    .set({
      teacherIds: JSON.stringify(updatedBatchIds),
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

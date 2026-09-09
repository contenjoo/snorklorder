export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { upgradeBatches, teachers, schools } from "@/db/schema";
import { eq, inArray, and, notInArray, sql } from "drizzle-orm";
import { sendConfirmNotification, sendTeacherUpgradedEmail } from "@/lib/email";

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

  if (!batch || !batch.tokenExpiresAt || batch.tokenExpiresAt.getTime() <= Date.now()) {
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
  const body = await req.json().catch(() => null);
  const confirmedTeacherIds: unknown = body?.confirmedTeacherIds;

  const [batch] = await db
    .select()
    .from(upgradeBatches)
    .where(eq(upgradeBatches.token, token));

  if (!batch || !batch.tokenExpiresAt || batch.tokenExpiresAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  }

  if (!Array.isArray(confirmedTeacherIds) || confirmedTeacherIds.length > 1000 ||
      confirmedTeacherIds.some((id) => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647)) {
    return NextResponse.json({ error: "Invalid teacher IDs" }, { status: 400 });
  }
  let normalizedConfirmedIds: number[];
  try {
    const ids = [...new Set(confirmedTeacherIds as number[])];
    const result = await db.execute(sql`SELECT teacher_id FROM confirm_teacher_batch(${token}, ${JSON.stringify(ids).replace('[','{').replace(']','}')}::integer[])`);
    normalizedConfirmedIds = result.rows.map((row) => Number(row.teacher_id));
  } catch (error) {
    console.error("[confirm] rejected", error);
    return NextResponse.json({ error: "Invalid, expired, or out-of-scope confirmation" }, { status: 409 });
  }
  const confirmedAt = new Date();
  if (normalizedConfirmedIds.length > 0) {
    // Notifications run after the response — Jon shouldn't wait on Gmail I/O
    void (async () => {
      try {
        const confirmedRows = await db
          .select({
            name: teachers.name,
            email: teachers.email,
            schoolName: schools.name,
            schoolNameEn: schools.nameEn,
            schoolTeam: schools.team,
          })
          .from(teachers)
          .innerJoin(schools, eq(teachers.schoolId, schools.id))
          .where(inArray(teachers.id, normalizedConfirmedIds));

        const bySchool = new Map<string, { name: string; nameEn: string | null; team: string | null; emails: string[] }>();
        for (const row of confirmedRows) {
          if (!bySchool.has(row.schoolName)) bySchool.set(row.schoolName, { name: row.schoolName, nameEn: row.schoolNameEn, team: row.schoolTeam, emails: [] });
          bySchool.get(row.schoolName)!.emails.push(row.email);
        }

        // Jon 확인 완료 시점: ① 관리자(나) 알림 ② 업그레이드된 교사 본인에게 완료 메일
        // 교사 메일은 한꺼번에 보내면 Gmail 421(레이트리밋)이 나므로 간격을 두고 순차 발송
        const [, failed] = await Promise.all([
          sendConfirmNotification({
            confirmedCount: normalizedConfirmedIds.length,
            schools: Array.from(bySchool.values()),
            confirmedAt,
          }),
          (async () => {
            let failedCount = 0;
            for (let i = 0; i < confirmedRows.length; i++) {
              const row = confirmedRows[i];
              try {
                const res = await sendTeacherUpgradedEmail({
                  name: row.name,
                  email: row.email,
                  schoolName: row.schoolName,
                  schoolNameEn: row.schoolNameEn,
                });
                if (!res.success && !res.skipped) failedCount++;
              } catch {
                failedCount++;
              }
              if (i < confirmedRows.length - 1) {
                await new Promise((r) => setTimeout(r, 400)); // 폭주 방지 간격
              }
            }
            return failedCount;
          })(),
        ]);
        if (failed > 0) console.warn(`[confirm] ${failed}/${confirmedRows.length} teacher emails failed`);
      } catch (err) {
        console.warn("[confirm] notification email failed:", err);
      }
    })();
  }

  return NextResponse.json({ success: true, count: normalizedConfirmedIds.length });
}

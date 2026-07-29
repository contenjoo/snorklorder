export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { teachers, schools } from "@/db/schema";
import { sql, desc, eq } from "drizzle-orm";
import { sendStaleSentReminder } from "@/lib/email";
import { authorizeCron } from "@/lib/cron-auth";

export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get teachers registered in the last 24 hours
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const newTeachers = await db
    .select({
      teacherName: teachers.name,
      teacherEmail: teachers.email,
      subject: teachers.subject,
      schoolName: schools.name,
      schoolCode: schools.code,
      createdAt: teachers.createdAt,
    })
    .from(teachers)
    .innerJoin(schools, sql`${teachers.schoolId} = ${schools.id}`)
    .where(sql`${teachers.createdAt} > ${yesterday}`)
    .orderBy(desc(teachers.createdAt));

  // 3일 넘게 sent 상태로 묶인 교사 — 관리자에게 stale reminder
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const staleSent = await db
    .select({
      email: teachers.email,
      name: teachers.name,
      notifiedAt: teachers.notifiedAt,
      schoolName: schools.name,
      schoolTeam: schools.team,
    })
    .from(teachers)
    .innerJoin(schools, eq(teachers.schoolId, schools.id))
    .where(sql`${teachers.status} = 'sent' AND ${teachers.notifiedAt} < ${threeDaysAgo}`)
    .orderBy(teachers.notifiedAt);

  if (staleSent.length > 0) {
    await sendStaleSentReminder(staleSent.map((s) => ({
      email: s.email,
      name: s.name,
      notifiedAt: s.notifiedAt!,
      schoolName: s.schoolName,
      schoolTeam: s.schoolTeam,
    })));
  }

  // Daily digest 메일은 비활성화됨 (Jon/Jeff에게 혼란만 줘서 끔). 신규 등록 현황은 /admin 대시보드에서 확인.
  // 내부 stale-sent 리마인더(관리자 대상)만 유지.
  return NextResponse.json({
    message: "Daily digest disabled — admin reminder only",
    sent: false,
    newTeacherCount: newTeachers.length,
    staleSentCount: staleSent.length,
  });
}

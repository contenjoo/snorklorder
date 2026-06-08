export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { teachers, schools, emailLogs } from "@/db/schema";
import { checkAuth } from "@/lib/auth";
import { sendTeacherUpgradedEmail } from "@/lib/email";

// teacher_upgraded 메일 중 '실패' 후 이후 '성공' 기록이 없는 수신자에게 재발송 (Gmail 421 등 일시오류 복구)
export async function POST() {
  if (!(await checkAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 수신자별 마지막 실패/성공 시각
  const lastByStatus = await db
    .select({
      email: emailLogs.toEmail,
      status: emailLogs.status,
      last: sql<string>`max(${emailLogs.createdAt})`,
    })
    .from(emailLogs)
    .where(eq(emailLogs.kind, "teacher_upgraded"))
    .groupBy(emailLogs.toEmail, emailLogs.status);

  const lastFail = new Map<string, string>();
  const lastOk = new Map<string, string>();
  for (const r of lastByStatus) {
    if (r.status === "failed") lastFail.set(r.email, r.last);
    else if (r.status === "success") lastOk.set(r.email, r.last);
  }
  // 실패가 있고, (성공 없음 또는 성공이 실패보다 이전) → 재발송 대상
  const targets = [...lastFail.entries()]
    .filter(([email, failAt]) => {
      const okAt = lastOk.get(email);
      return !okAt || okAt < failAt;
    })
    .map(([email]) => email);

  const results: { email: string; ok: boolean; reason?: string }[] = [];
  for (let i = 0; i < targets.length; i++) {
    const email = targets[i];
    // 해당 이메일의 업그레이드된 교사 + 학교 정보
    const [row] = await db
      .select({
        name: teachers.name,
        email: teachers.email,
        schoolName: schools.name,
        schoolNameEn: schools.nameEn,
      })
      .from(teachers)
      .innerJoin(schools, eq(teachers.schoolId, schools.id))
      .where(and(eq(teachers.email, email), eq(teachers.status, "upgraded")))
      .orderBy(desc(teachers.createdAt))
      .limit(1);

    if (!row) {
      results.push({ email, ok: false, reason: "no upgraded teacher found" });
      continue;
    }
    const res = await sendTeacherUpgradedEmail({
      name: row.name,
      email: row.email,
      schoolName: row.schoolName,
      schoolNameEn: row.schoolNameEn,
    });
    results.push({ email, ok: !!res.success, reason: res.error });
    if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 500)); // 폭주 방지 간격
  }

  const sent = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: true, candidates: targets.length, sent, failed: results.length - sent, results });
}

export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { and, desc, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { accountRequests, emailLogs, teachers } from "@/db/schema";
import { sendHqDailyNudge } from "@/lib/email";
import { authorizeCron } from "@/lib/cron-auth";

// Jon 하루 1통 알림. 관리자가 '보내기'하면 메일 없이 본사 화면(/partner)에 올라가고,
// 마지막 알림 이후 새로 올라온 건이 있는 날만 이 한 통이 나간다.
export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [lastNudge] = await db
    .select({ at: emailLogs.createdAt })
    .from(emailLogs)
    .where(and(eq(emailLogs.kind, "hq_daily_nudge"), eq(emailLogs.status, "success")))
    .orderBy(desc(emailLogs.createdAt))
    .limit(1);
  const since = lastNudge?.at ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Jon 화면 기준과 같다: 올린 교사(sent+notifiedAt), 처리 대기 계정 요청(sent, 취소 진행/완료 제외).
  const openTeacher = and(eq(teachers.status, "sent"), isNotNull(teachers.notifiedAt));
  const openAccount = and(
    eq(accountRequests.status, "sent"),
    notInArray(accountRequests.marketVoidState, ["prepared", "voided"]),
  );
  const [[teacherCounts], [accountCounts]] = await Promise.all([
    db
      .select({
        open: sql<number>`count(*)::int`,
        fresh: sql<number>`count(*) filter (where ${teachers.notifiedAt} > ${since})::int`,
      })
      .from(teachers)
      .where(openTeacher),
    db
      .select({
        open: sql<number>`count(*)::int`,
        fresh: sql<number>`count(*) filter (where ${accountRequests.processingEmailSentAt} > ${since})::int`,
      })
      .from(accountRequests)
      .where(and(openAccount, isNotNull(accountRequests.processingEmailSentAt))),
  ]);

  const counts = {
    newTeachers: teacherCounts?.fresh ?? 0,
    newAccounts: accountCounts?.fresh ?? 0,
    openTeachers: teacherCounts?.open ?? 0,
    openAccounts: accountCounts?.open ?? 0,
  };
  if (counts.newTeachers + counts.newAccounts === 0) {
    return NextResponse.json({ sent: false, reason: "nothing new", since, ...counts });
  }

  const result = await sendHqDailyNudge(counts);
  return NextResponse.json({ sent: result.success, since, ...counts, error: result.error });
}

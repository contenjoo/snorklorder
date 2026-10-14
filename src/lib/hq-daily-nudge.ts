import { and, desc, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { accountRequests, emailLogs, teachers } from "@/db/schema";
import { sendHqDailyNudge } from "@/lib/email";

/**
 * Jon 하루 1통 알림. 관리자가 '보내기'하면 메일 없이 본사 화면(/partner)에 올라가고,
 * 마지막 알림 이후 새로 올라온 건이 있을 때만 한 통을 보낸다.
 * 매일 도는 cron/verification-maintenance 가 부른다(새 크론 경로는 Vercel 에 등록되지 않았다).
 */
const DASHBOARD_POSTING_STARTED_AT = new Date("2026-10-13T09:30:00Z");

export async function runHqDailyNudge() {
  const [lastNudge] = await db
    .select({ at: emailLogs.createdAt })
    .from(emailLogs)
    .where(and(eq(emailLogs.kind, "hq_daily_nudge"), eq(emailLogs.status, "success")))
    .orderBy(desc(emailLogs.createdAt))
    .limit(1);
  // 첫 알림은 메일 대신 화면 게시로 바뀐 시각(PR #23 배포) 이후 올라온 건부터 센다.
  const since = lastNudge?.at ?? DASHBOARD_POSTING_STARTED_AT;

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
    return { sent: false, reason: "nothing new", since, ...counts };
  }

  const result = await sendHqDailyNudge(counts);
  return { sent: result.success, since, ...counts, error: result.error };
}

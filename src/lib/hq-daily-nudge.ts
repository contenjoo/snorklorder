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
// 이 기간보다 오래 처리 안 된 건이 남아 있으면 새 건이 없어도 알림을 보낸다.
const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;
// 밀린 건만 있을 때는 마지막 알림 후 이만큼 지나야 다시 보낸다(하루 1통 유지).
const MIN_GAP_MS = 20 * 60 * 60 * 1000;

export async function runHqDailyNudge() {
  const [lastNudge] = await db
    .select({ at: emailLogs.createdAt })
    .from(emailLogs)
    .where(and(eq(emailLogs.kind, "hq_daily_nudge"), eq(emailLogs.status, "success")))
    .orderBy(desc(emailLogs.createdAt))
    .limit(1);
  // 첫 알림은 메일 대신 화면 게시로 바뀐 시각(PR #23 배포) 이후 올라온 건부터 센다.
  const since = lastNudge?.at ?? DASHBOARD_POSTING_STARTED_AT;
  const now = Date.now();
  const staleBefore = new Date(now - STALE_AFTER_MS);

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
        stale: sql<number>`count(*) filter (where ${teachers.notifiedAt} < ${staleBefore})::int`,
      })
      .from(teachers)
      .where(openTeacher),
    db
      .select({
        open: sql<number>`count(*)::int`,
        fresh: sql<number>`count(*) filter (where ${accountRequests.processingEmailSentAt} > ${since})::int`,
        stale: sql<number>`count(*) filter (where ${accountRequests.processingEmailSentAt} < ${staleBefore})::int`,
      })
      .from(accountRequests)
      .where(and(openAccount, isNotNull(accountRequests.processingEmailSentAt))),
  ]);

  const counts = {
    newTeachers: teacherCounts?.fresh ?? 0,
    newAccounts: accountCounts?.fresh ?? 0,
    openTeachers: teacherCounts?.open ?? 0,
    openAccounts: accountCounts?.open ?? 0,
    staleItems: (teacherCounts?.stale ?? 0) + (accountCounts?.stale ?? 0),
  };
  const hasNew = counts.newTeachers + counts.newAccounts > 0;
  // 새 건이 없어도 2일 넘게 밀린 건이 있으면 다시 알린다 — 단, 마지막 알림 후 20시간이 지났을 때만.
  const staleDue = counts.staleItems > 0 && (!lastNudge?.at || now - lastNudge.at.getTime() >= MIN_GAP_MS);
  if (!hasNew && !staleDue) {
    return { sent: false, reason: counts.staleItems > 0 ? "stale reminder sent recently" : "nothing new", since, ...counts };
  }

  const result = await sendHqDailyNudge(counts);
  return { sent: result.success, since, ...counts, error: result.error };
}

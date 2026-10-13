import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("sending to Jon posts to the HQ dashboard instead of emailing each request", () => {
  for (const path of ["../src/app/api/account-email/route.ts", "../src/app/api/account-email/batch/route.ts"]) {
    const route = read(path);
    assert.doesNotMatch(route, /sendTrackedProcessingMail|buildProcessingEmail|loadProcessingReminders/);
    assert.match(route, /processingEmailSentAt: (sentAt|processingSentAt)/);
  }
  const teachersRoute = read("../src/app/api/send-email/route.ts");
  assert.doesNotMatch(teachersRoute, /sendBatchNotification/);
  assert.match(teachersRoute, /status: "sent", notifiedAt: new Date\(\)/);
});

test("Jon dashboard shows posted work and completes it with the same side effects as email links", () => {
  const page = read("../src/app/partner/page.tsx");
  const api = read("../src/app/api/partner/route.ts");
  // 미승인·미게시 교사는 Action Needed 에 나오지 않는다.
  assert.match(page, /const isActionable = \(t: Teacher\) => t\.status === "sent" && !!t\.notifiedAt;/);
  assert.doesNotMatch(page, /t\.status === "pending" \|\| t\.status === "sent"/);
  assert.match(api, /eq\(teachers\.status, "sent"\), eq\(teachers\.verificationStatus, "approved"\)/);
  assert.match(api, /after\(\(\) => notifyTeacherUpgrades\(upgradedIds, confirmedAt\)\)/);
  // 계정 요청: 상세 + Mark as done(확인 링크 API 재사용). 토큰은 확정 권한에만.
  assert.match(page, /generateAccountEmail\(r\)/);
  assert.match(page, /\/api\/account-confirm\/\$\{r\.confirmToken\}/);
  assert.match(page, /Mark as done/);
  assert.match(api, /canConfirm && row\.status === "sent" \? confirmToken : null/);
  const confirmRoute = read("../src/app/api/confirm/[token]/route.ts");
  assert.match(confirmRoute, /after\(\(\) => notifyTeacherUpgrades\(normalizedConfirmedIds, confirmedAt\)\)/);
});

test("Jon gets at most one short nudge a day, only when something new was posted", () => {
  const cron = read("../src/app/api/cron/hq-daily-nudge/route.ts");
  const vercel = JSON.parse(read("../vercel.json"));
  assert.ok(vercel.crons.some((c) => c.path === "/api/cron/hq-daily-nudge"));
  assert.match(cron, /authorizeCron/);
  assert.match(cron, /eq\(emailLogs\.kind, "hq_daily_nudge"\)/);
  assert.match(cron, /newTeachers \+ counts\.newAccounts === 0/);
  assert.match(cron, /sendHqDailyNudge/);
  const email = read("../src/lib/email.ts");
  assert.match(email, /\{ kind: "hq_daily_nudge" \}/);
  assert.match(email, /\/partner/);
});

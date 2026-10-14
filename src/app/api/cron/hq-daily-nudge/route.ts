export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { runHqDailyNudge } from "@/lib/hq-daily-nudge";
import { authorizeCron } from "@/lib/cron-auth";

// 수동 실행용. 정기 실행은 cron/verification-maintenance 가 같은 함수를 부른다.
export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runHqDailyNudge());
}

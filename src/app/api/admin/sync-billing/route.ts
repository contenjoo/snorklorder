export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth";
import { runBillingSync } from "@/lib/billing-sync";

// 관리자 화면 "메일 동기화" 버튼 — 크론과 같은 동기화를 즉시 실행한다.
export async function POST(req: NextRequest) {
  if (!(await checkAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = body?.dryRun === true;
  } catch {
    // 본문 없음 — 실제 반영
  }
  try {
    const result = await runBillingSync({ dryRun });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[admin/sync-billing] failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "메일 동기화 실패 — 서버 로그 확인" }, { status: 500 });
  }
}

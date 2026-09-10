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
    // The existing admin button sends a bodyless POST. Only an absent/empty
    // body uses defaults; malformed JSON must never trigger a real sync.
    const text = await req.text();
    const body = text === "" ? {} : JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
      return NextResponse.json({ error: "dryRun must be a boolean" }, { status: 400 });
    }
    dryRun = body.dryRun === true;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const result = await runBillingSync({ dryRun });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[admin/sync-billing] failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "메일 동기화 실패 — 서버 로그 확인" }, { status: 500 });
  }
}

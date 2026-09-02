export const dynamic = "force-dynamic";
// IMAP 접속 + PDF 파싱이라 기본 10초로는 빠듯하다.
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { runBillingSync } from "@/lib/billing-sync";

// 본사 청구 메일 자동 수집 크론 (QuickBooks 시대의 sync-stripe 후속)
// - Cailie 인보이스 PDF 답장 → invoice_number/amount/due_date 채우고 status='invoiced'
// - QuickBooks 결제 확인 메일 → payment_date/method 채우고 status='paid'
// - 매칭 실패는 DB 변경 없이 unmatched 로 보고. ?dryRun=1 이면 조회·판단만.
async function run(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  try {
    const result = await runBillingSync({
      newerThanDays: Number(params.get("days")) || undefined,
      maxPerKind: Number(params.get("max")) || undefined,
      dryRun: params.get("dryRun") === "1",
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[sync-billing] failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "Billing mail sync failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run(req);
}

export async function POST(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run(req);
}

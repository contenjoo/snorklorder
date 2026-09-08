import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { checkAuth } from "@/lib/auth";
import { BASE_URL } from "@/lib/email";
import { hydrateAccountRequestSchoolNames, needsEnglishSchoolNameForHq } from "@/lib/account-request-school-name";
import { isMarketLegacyAuditRequest } from "@/lib/market-legacy-audit";
import { buildProcessingEmail } from "@/lib/account-processing";
import { loadProcessingReminders, processingListUnavailableResponse } from "@/lib/processing-ledger";

export const dynamic = "force-dynamic";

// Admin-only, read-only preview. New links remain placeholders until actual sending.
export async function POST(req: NextRequest) {
  if (!(await checkAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const input = await req.json().catch(() => null);
  const ids = input?.requestIds;
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
    || new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: "requestIds must be unique positive integers" }, { status: 400 });
  }
  try {
    const rows = await hydrateAccountRequestSchoolNames(await db.select().from(accountRequests).where(inArray(accountRequests.id, ids)));
    if (rows.length !== ids.length) return NextResponse.json({ error: "Account request not found" }, { status: 404 });
    if (rows.some((r) => isMarketLegacyAuditRequest(r) || r.partnerLifecycleState !== "active" || ["prepared", "voided"].includes(r.marketVoidState))) {
      return NextResponse.json({ error: "취소 또는 감사 대상 요청은 미리볼 수 없습니다." }, { status: 409 });
    }
    if (rows.some(needsEnglishSchoolNameForHq)) {
      return NextResponse.json({ error: "발송할 요청의 영문 학교명을 먼저 입력해 주세요." }, { status: 400 });
    }
    const fresh = ids.map((id) => rows.find((r) => r.id === id)!);
    const pending = await loadProcessingReminders(fresh);
    return NextResponse.json({
      ...buildProcessingEmail(fresh, pending.reminders, { baseUrl: BASE_URL, batch: input.batch === true }),
      manualReview: pending.manualReview,
      // Manual copies cannot carry Market reminders outside the server cancellation fence.
      copyAllowed: [...fresh, ...pending.reminders].every((r) => r.externalSource !== "market" && r.channel !== "partner"),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return processingListUnavailableResponse();
  }
}

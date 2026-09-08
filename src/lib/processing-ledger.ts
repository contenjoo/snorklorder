import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { hydrateAccountRequestSchoolNames } from "@/lib/account-request-school-name";
import { nonLegacyMarketAuditCondition } from "@/lib/market-legacy-audit-db";
import { isIndividualUpgrade, selectProcessingReminders, type ProcessingRequest } from "@/lib/account-processing";

// Fail closed: callers load before any SMTP claim; never silently send an incomplete list.
export async function loadProcessingReminders(fresh: ProcessingRequest[]) {
  if (!fresh.some(isIndividualUpgrade)) return { reminders: [], manualReview: [] };
  const rows = await db.select().from(accountRequests).where(and(
    eq(accountRequests.type, "upgrade"),
    eq(accountRequests.partnerLifecycleState, "active"),
    inArray(accountRequests.accountType, ["teacher", "student"]),
    inArray(accountRequests.status, ["sent", "invoiced", "paid"]),
    isNull(accountRequests.confirmedAt),
    notInArray(accountRequests.marketVoidState, ["prepared", "voided"]),
    nonLegacyMarketAuditCondition(),
  ));
  return selectProcessingReminders(fresh, await hydrateAccountRequestSchoolNames(rows));
}

export function processingListUnavailableResponse() {
  return Response.json({
    success: false, code: "PROCESSING_LIST_UNAVAILABLE",
    error: "완료 확인 대기 목록을 불러오지 못해 발송하지 않았습니다. 다시 시도해 주세요.",
  }, { status: 503 });
}

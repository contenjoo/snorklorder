import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { accountRequests } from "@/db/schema";
import { nonLegacyMarketAuditCondition } from "@/lib/market-legacy-audit-db";

/** Apply in the UPDATE itself: billing can change after the initial read. */
export function processingConfirmationValues(now = new Date()) {
  return {
    status: sql<string>`CASE WHEN ${accountRequests.status} IN ('invoiced', 'paid') THEN ${accountRequests.status} ELSE 'processed' END`,
    confirmedAt: now,
    updatedAt: now,
  };
}

export function pendingProcessingConfirmationCondition() {
  return and(
    isNull(accountRequests.confirmedAt),
    eq(accountRequests.partnerLifecycleState, "active"),
    inArray(accountRequests.status, ["draft", "sent", "invoiced", "paid"]),
    notInArray(accountRequests.marketVoidState, ["prepared", "voided"]),
    nonLegacyMarketAuditCondition(),
  );
}

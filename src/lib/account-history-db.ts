import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { accountRequests as requests, teachers } from "@/db/schema";
import { nonLegacyMarketAuditCondition } from "@/lib/market-legacy-audit-db";
import { historyEmails, matchAccountHistory, type HistoryTarget } from "./account-history";

/** Batch lookup. Only the matched address and its summarized history leave this module. */
export async function withAccountHistory<T extends HistoryTarget>(targets: T[]) {
  const emails = [...new Set(targets.flatMap(historyEmails))];
  if (!emails.length) return targets.map(row => ({ ...row, history: [] }));
  const wanted = sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(emails)}::jsonb))`;
  const [past, registrations] = await Promise.all([
    db.select({
      id: requests.id, emails: requests.emails, oldEmail: requests.oldEmail, type: requests.type,
      accountType: requests.accountType, status: requests.status, confirmedAt: requests.confirmedAt,
      extensionDate: requests.extensionDate, createdAt: requests.createdAt,
    }).from(requests).where(and(
      sql`regexp_split_to_array(lower(trim(concat_ws(',', ${requests.emails}, ${requests.oldEmail}))), '[,;[:space:]]+') && ${wanted}`,
      isNull(requests.archivedAt), eq(requests.partnerLifecycleState, "active"),
      notInArray(requests.marketVoidState, ["prepared", "voided"]), nonLegacyMarketAuditCondition(),
    )),
    db.select({ email: teachers.email, createdAt: teachers.createdAt }).from(teachers)
      .where(and(sql`lower(trim(${teachers.email})) = ANY(${wanted})`, sql`${teachers.verificationStatus} <> 'rejected'`)),
  ]);
  const matches = matchAccountHistory(targets, past, registrations);
  return targets.map((row, i) => ({ ...row, history: matches[i] }));
}

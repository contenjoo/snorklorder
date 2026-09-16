import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notExists,
  notInArray,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { accountRequests, billingCycleItems, billingCycles } from "@/db/schema";
import { nonLegacyMarketAuditCondition } from "@/lib/market-legacy-audit-db";
import { billingWindowAt, type BillingCycleEmailItem, type BillingWindow } from "@/lib/billing-cycle";

const BILLABLE_STATUSES = ["sent", "processed"] as const;
const VISIBLE_CYCLE_LIMIT = 24;

function billableCondition() {
  return and(
    eq(accountRequests.needsInvoice, true),
    isNotNull(accountRequests.processingEmailSentAt),
    isNull(accountRequests.invoiceNumber),
    isNull(accountRequests.invoiceEmailSentAt),
    isNull(accountRequests.invoiceEmailSendStartedAt),
    inArray(accountRequests.status, [...BILLABLE_STATUSES]),
    notInArray(accountRequests.marketVoidState, ["prepared", "voided"]),
    eq(accountRequests.partnerLifecycleState, "active"),
    sql<boolean>`NULLIF(BTRIM(${accountRequests.schoolNameEn}), '') IS NOT NULL`,
    nonLegacyMarketAuditCondition(),
    notExists(
      db.select({ id: billingCycleItems.id })
        .from(billingCycleItems)
        .where(eq(billingCycleItems.accountRequestId, accountRequests.id)),
    ),
  );
}

async function ensureCycle(window: BillingWindow) {
  await db.insert(billingCycles).values({
    code: window.code,
    kind: "regular",
    status: "collecting",
    periodStart: window.start,
    periodEnd: window.end,
  }).onConflictDoNothing({ target: billingCycles.code });
  const [cycle] = await db.select().from(billingCycles).where(eq(billingCycles.code, window.code));
  if (!cycle) throw new Error("Billing cycle could not be loaded");
  return cycle;
}

export async function ensureCollectingBillingCycle(instant = new Date()) {
  return ensureCycle(billingWindowAt(instant));
}

async function assignEligibleRequestsToCycle(
  cycle: typeof billingCycles.$inferSelect,
  options: { requestIds?: number[]; enforceWindow?: boolean } = {},
) {
  if (cycle.status !== "collecting") return [];
  const conditions = [billableCondition()];
  if (options.requestIds?.length) conditions.push(inArray(accountRequests.id, options.requestIds));
  if (options.enforceWindow) {
    conditions.push(gte(accountRequests.processingEmailSentAt, cycle.periodStart));
    conditions.push(lt(accountRequests.processingEmailSentAt, cycle.periodEnd));
  }
  const rows = await db.select({
    requestId: accountRequests.id,
    schoolNameEn: accountRequests.schoolNameEn,
    requestType: accountRequests.type,
    accountType: accountRequests.accountType,
    quantity: accountRequests.quantity,
    extensionDate: accountRequests.extensionDate,
  }).from(accountRequests).where(and(...conditions)).orderBy(accountRequests.id);

  if (!rows.length) return [];
  return db.insert(billingCycleItems).values(rows.map((row) => ({
    cycleId: cycle.id,
    accountRequestId: row.requestId,
    schoolNameEn: row.schoolNameEn!,
    requestType: row.requestType,
    accountType: row.accountType,
    quantity: row.quantity && row.quantity > 0 ? row.quantity : 1,
    extensionDate: row.extensionDate,
  }))).onConflictDoNothing({ target: billingCycleItems.accountRequestId })
    .returning({ requestId: billingCycleItems.accountRequestId });
}

export async function assignRequestsToCurrentBillingCycle(requestIds: number[], instant = new Date()) {
  const cycle = await ensureCollectingBillingCycle(instant);
  const assigned = await assignEligibleRequestsToCycle(cycle, { requestIds });
  const existing = requestIds.length
    ? await db.select({ requestId: billingCycleItems.accountRequestId })
      .from(billingCycleItems)
      .where(inArray(billingCycleItems.accountRequestId, requestIds))
    : [];
  return {
    cycleCode: cycle.code,
    assignedIds: assigned.map((item) => item.requestId),
    queuedIds: existing.map((item) => item.requestId),
  };
}

/** Close every overdue cycle, then guarantee that the current cycle exists. */
export async function prepareDueBillingCycles(instant = new Date()) {
  const current = await ensureCollectingBillingCycle(instant);
  const due = await db.select().from(billingCycles)
    .where(and(eq(billingCycles.status, "collecting"), lte(billingCycles.periodEnd, instant)))
    .orderBy(asc(billingCycles.periodEnd));
  const prepared: { id: number; code: string; status: string; itemCount: number }[] = [];
  for (const cycle of due) {
    await assignEligibleRequestsToCycle(cycle, { enforceWindow: true });
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` })
      .from(billingCycleItems).where(eq(billingCycleItems.cycleId, cycle.id));
    const itemCount = Number(countRow?.count ?? 0);
    const nextStatus = itemCount > 0 ? "ready" : "empty";
    const [closed] = await db.update(billingCycles).set({
      status: nextStatus,
      lockedAt: instant,
      updatedAt: instant,
    }).where(and(eq(billingCycles.id, cycle.id), eq(billingCycles.status, "collecting")))
      .returning({ id: billingCycles.id, code: billingCycles.code, status: billingCycles.status });
    if (closed) prepared.push({ ...closed, itemCount });
  }
  return { currentCode: current.code, prepared };
}

export interface BillingCycleViewItem extends BillingCycleEmailItem {
  includedAt: string;
}

export interface BillingCycleView {
  id: number;
  code: string;
  kind: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  lockedAt: string | null;
  sentAt: string | null;
  invoiceNumber: string | null;
  invoiceReceivedAt: string | null;
  paidAt: string | null;
  lastError: string | null;
  items: BillingCycleViewItem[];
}

function asIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

export async function listBillingCycleViews(limit = VISIBLE_CYCLE_LIMIT): Promise<BillingCycleView[]> {
  const cycles = await db.select().from(billingCycles)
    .orderBy(desc(billingCycles.periodEnd), desc(billingCycles.id)).limit(limit);
  if (!cycles.length) return [];
  const items = await db.select().from(billingCycleItems)
    .where(inArray(billingCycleItems.cycleId, cycles.map((cycle) => cycle.id)))
    .orderBy(asc(billingCycleItems.accountRequestId));
  return cycles.map((cycle) => ({
    id: cycle.id,
    code: cycle.code,
    kind: cycle.kind,
    status: cycle.status,
    periodStart: cycle.periodStart.toISOString(),
    periodEnd: cycle.periodEnd.toISOString(),
    lockedAt: asIso(cycle.lockedAt),
    sentAt: asIso(cycle.sentAt),
    invoiceNumber: cycle.invoiceNumber,
    invoiceReceivedAt: asIso(cycle.invoiceReceivedAt),
    paidAt: asIso(cycle.paidAt),
    lastError: cycle.lastError,
    items: items.filter((item) => item.cycleId === cycle.id).map((item) => ({
      requestId: item.accountRequestId,
      schoolNameEn: item.schoolNameEn,
      requestType: item.requestType,
      accountType: item.accountType,
      quantity: item.quantity,
      extensionDate: item.extensionDate,
      includedAt: item.includedAt.toISOString(),
    })),
  }));
}

export async function loadBillingCycleForSend(id: number) {
  const [cycle] = await db.update(billingCycles).set({
    status: "sending",
    sendStartedAt: new Date(),
    lastError: null,
    updatedAt: new Date(),
  }).where(and(eq(billingCycles.id, id), eq(billingCycles.status, "ready")))
    .returning();
  if (!cycle) return null;
  const items = await db.select().from(billingCycleItems)
    .where(eq(billingCycleItems.cycleId, cycle.id))
    .orderBy(asc(billingCycleItems.accountRequestId));
  return {
    cycle,
    items: items.map((item) => ({
      requestId: item.accountRequestId,
      schoolNameEn: item.schoolNameEn,
      requestType: item.requestType,
      accountType: item.accountType,
      quantity: item.quantity,
      extensionDate: item.extensionDate,
    })),
  };
}

export async function markBillingCycleSent(id: number, sendStartedAt: Date, gmailMessageId: string | null) {
  const sentAt = new Date();
  const [cycle] = await db.update(billingCycles).set({
    status: "sent",
    sendStartedAt: null,
    sentAt,
    requestGmailMessageId: gmailMessageId,
    lastError: null,
    updatedAt: sentAt,
  }).where(and(
    eq(billingCycles.id, id),
    eq(billingCycles.status, "sending"),
    eq(billingCycles.sendStartedAt, sendStartedAt),
  )).returning();
  return cycle ?? null;
}

export async function markBillingCycleSendUnknown(id: number, error: string) {
  await db.update(billingCycles).set({
    status: "send_unknown",
    lastError: error,
    updatedAt: new Date(),
  }).where(and(eq(billingCycles.id, id), eq(billingCycles.status, "sending")));
}

export async function countUnassignedBillingRequests() {
  const [row] = await db.select({ count: sql<number>`count(*)::int` })
    .from(accountRequests).where(billableCondition());
  return Number(row?.count ?? 0);
}

export async function findCycleByCode(code: string) {
  const [cycle] = await db.select().from(billingCycles).where(eq(billingCycles.code, code));
  return cycle ?? null;
}

export async function findSentCycleByExactRequestIds(requestIds: number[]) {
  if (!requestIds.length) return null;
  const candidates = await db.select().from(billingCycles)
    .where(inArray(billingCycles.status, ["sent", "invoice_mismatch"]));
  const matches: (typeof billingCycles.$inferSelect)[] = [];
  const target = [...new Set(requestIds)].sort((a, b) => a - b).join(",");
  for (const candidate of candidates) {
    const items = await db.select({ requestId: billingCycleItems.accountRequestId })
      .from(billingCycleItems).where(eq(billingCycleItems.cycleId, candidate.id));
    if (items.map((item) => item.requestId).sort((a, b) => a - b).join(",") === target) matches.push(candidate);
  }
  return matches.length === 1 ? matches[0] : null;
}

export async function findCyclesContainingRequestIds(requestIds: number[]) {
  if (!requestIds.length) return [];
  return db.selectDistinct({ id: billingCycles.id, code: billingCycles.code })
    .from(billingCycleItems)
    .innerJoin(billingCycles, eq(billingCycleItems.cycleId, billingCycles.id))
    .where(and(
      inArray(billingCycleItems.accountRequestId, requestIds),
      inArray(billingCycles.status, ["sent", "invoice_mismatch"]),
    ));
}

export async function loadFrozenCycleItems(cycleId: number) {
  return db.select({
    requestId: billingCycleItems.accountRequestId,
    quantity: billingCycleItems.quantity,
  }).from(billingCycleItems).where(eq(billingCycleItems.cycleId, cycleId))
    .orderBy(asc(billingCycleItems.accountRequestId));
}

export async function markCycleMismatch(cycleId: number, status: "invoice_mismatch" | "payment_mismatch", reason: string) {
  await db.update(billingCycles).set({ status, lastError: reason.slice(0, 1000), updatedAt: new Date() })
    .where(eq(billingCycles.id, cycleId));
}

export async function findCycleByInvoiceNumber(invoiceNumber: string) {
  const normalized = invoiceNumber.replace(/^#/, "").trim();
  const [cycle] = await db.select().from(billingCycles)
    .where(sql`TRIM(LEADING '#' FROM ${billingCycles.invoiceNumber}) = ${normalized}`);
  return cycle ?? null;
}

export async function markCycleInvoiced(
  cycleId: number,
  invoiceNumber: string,
  gmailMessageId: string | null,
  receivedAt: Date,
) {
  const [cycle] = await db.update(billingCycles).set({
    status: "invoiced",
    invoiceNumber,
    invoiceGmailMessageId: gmailMessageId,
    invoiceReceivedAt: receivedAt,
    lastError: null,
    updatedAt: new Date(),
  }).where(and(
    eq(billingCycles.id, cycleId),
    inArray(billingCycles.status, ["sent", "invoice_mismatch"]),
  )).returning();
  return cycle ?? null;
}

export async function markCyclePaid(cycleId: number, paidAt: Date) {
  const [cycle] = await db.update(billingCycles).set({
    status: "paid",
    paidAt,
    lastError: null,
    updatedAt: new Date(),
  }).where(and(
    eq(billingCycles.id, cycleId),
    inArray(billingCycles.status, ["invoiced", "payment_mismatch"]),
  )).returning();
  return cycle ?? null;
}

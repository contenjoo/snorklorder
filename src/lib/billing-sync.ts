import { runProcessingMailSync, type ProcessingSyncResult } from "./processing-mail-sync";
import { and, eq, inArray, isNull, notInArray, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { accountRequests, billingCycles } from "@/db/schema";
import { VOID_EXCLUDED_STATES } from "@/lib/account-email-template";
import { compareFrozenBillingItems } from "@/lib/billing-cycle";
import {
  findCycleByCode,
  findCycleByInvoiceNumber,
  findCyclesContainingRequestIds,
  findSentCycleByExactRequestIds,
  loadFrozenCycleItems,
  markCycleMismatch,
} from "@/lib/billing-cycle-db";
import { fetchBillingMails, missingBillingMailEnv } from "@/lib/billing-imap";
import { normalizeInvoiceNumber, planInvoiceSync, planPaymentSync, type BillingRow, type SkippedItem } from "@/lib/billing-mail";

export interface BillingSyncOptions { newerThanDays?: number; maxPerKind?: number; dryRun?: boolean; }
export interface AppliedInvoice { invoiceNumber: string; ids: number[]; skipped: SkippedItem[]; }
export interface AppliedPayment { invoiceNumber: string; ids: number[]; paidOn: string | null; }
export interface UnmatchedItem { invoiceNumber: string; reason: string; }
export type BillingSyncResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; skipped: false; dryRun: boolean; scanned: number; invoices: { applied: AppliedInvoice[]; alreadySynced: number; unmatched: UnmatchedItem[] }; payments: { applied: AppliedPayment[]; alreadySynced: number; unmatched: UnmatchedItem[] }; processing: ProcessingSyncResult; claimSkipped: number; warnings: string[]; timestamp: string; };

const INVOICE_APPLY_STATUSES = ["sent", "processed"];
const PAYMENT_APPLY_STATUSES = ["sent", "processed", "invoiced"];

export async function runBillingSync(options: BillingSyncOptions = {}): Promise<BillingSyncResult> {
  const missing = missingBillingMailEnv();
  if (missing.length) return { ok: true, skipped: true, reason: `Gmail env 미설정: ${missing.join(", ")}` };
  const dryRun = options.dryRun === true || process.env.BILLING_AUTH_VERIFIED !== "true";
  const { mails, warnings } = await fetchBillingMails(options);
  const ids = new Set<number>();
  const numbers = new Set<string>();
  for (const mail of mails) {
    if (mail.kind === "invoice") {
      mail.invoice.requestIds.forEach((id) => ids.add(id));
      numbers.add(mail.invoice.invoiceNumber);
    } else numbers.add(mail.payment.invoiceNumber);
  }
  const conditions: SQL[] = [];
  if (ids.size) conditions.push(inArray(accountRequests.id, [...ids]));
  if (numbers.size) conditions.push(inArray(accountRequests.invoiceNumber, [...numbers].flatMap((number) => [number, `#${number}`])));
  const rows: BillingRow[] = conditions.length ? await db.select({
    id: accountRequests.id, status: accountRequests.status, invoiceNumber: accountRequests.invoiceNumber,
    invoiceAmount: accountRequests.invoiceAmount, quantity: accountRequests.quantity, marketVoidState: accountRequests.marketVoidState,
  }).from(accountRequests).where(conditions.length === 1 ? conditions[0] : or(...conditions)) : [];

  const invoices = { applied: [] as AppliedInvoice[], alreadySynced: 0, unmatched: [] as UnmatchedItem[] };
  const payments = { applied: [] as AppliedPayment[], alreadySynced: 0, unmatched: [] as UnmatchedItem[] };
  let claimSkipped = 0;

  for (const mail of mails) {
    if (mail.kind === "invoice") {
      const codedCycle = mail.invoice.cycleCode ? await findCycleByCode(mail.invoice.cycleCode) : null;
      const cycle = codedCycle ?? (!mail.invoice.cycleCode ? await findSentCycleByExactRequestIds(mail.invoice.requestIds) : null);
      if (mail.invoice.cycleCode && !cycle) {
        invoices.unmatched.push({ invoiceNumber: mail.invoice.invoiceNumber, reason: `청구 주기 ${mail.invoice.cycleCode} 없음` });
        continue;
      }
      if (cycle) {
        if (cycle.status === "invoiced" || cycle.status === "paid") {
          if (normalizeInvoiceNumber(cycle.invoiceNumber) === mail.invoice.invoiceNumber) invoices.alreadySynced++;
          else invoices.unmatched.push({ invoiceNumber: mail.invoice.invoiceNumber, reason: `${cycle.code}에 다른 인보이스 ${cycle.invoiceNumber} 기록됨` });
          continue;
        }
        const frozen = await loadFrozenCycleItems(cycle.id);
        const actual = mail.invoice.requestItems.flatMap((item) => item.quantity === null ? [] : [{ requestId: item.requestId, quantity: item.quantity }]);
        const comparison = mail.invoice.requestItems.some((item) => item.quantity === null)
          ? { ok: false as const, reason: `수량 파싱 실패 #${mail.invoice.requestItems.filter((item) => item.quantity === null).map((item) => item.requestId).join(", #")}` }
          : compareFrozenBillingItems(frozen, actual);
        if (!comparison.ok || mail.invoice.totalCents === null) {
          const reason = !comparison.ok ? comparison.reason : "PDF 총액 파싱 실패";
          if (!dryRun) await markCycleMismatch(cycle.id, "invoice_mismatch", reason);
          invoices.unmatched.push({ invoiceNumber: mail.invoice.invoiceNumber, reason: `${cycle.code}: ${reason}` });
          continue;
        }
        const plan = planInvoiceSync(mail.invoice, rows);
        if (plan.kind !== "apply" || plan.apply.length !== frozen.length) {
          const reason = plan.reason || "동결 목록 전체를 원자적으로 반영할 수 없음";
          if (!dryRun) await markCycleMismatch(cycle.id, "invoice_mismatch", reason);
          invoices.unmatched.push({ invoiceNumber: mail.invoice.invoiceNumber, reason: `${cycle.code}: ${reason}` });
          continue;
        }
        if (!dryRun) {
          try {
            await db.transaction(async (tx) => {
              for (const item of plan.apply) {
                const updated = await tx.update(accountRequests).set({ invoiceNumber: mail.invoice.invoiceNumber, invoiceAmount: item.invoiceAmount, invoiceDueDate: mail.invoice.dueDate, status: "invoiced", updatedAt: new Date() }).where(and(eq(accountRequests.id, item.id), inArray(accountRequests.status, INVOICE_APPLY_STATUSES), isNull(accountRequests.invoiceNumber), notInArray(accountRequests.marketVoidState, [...VOID_EXCLUDED_STATES]))).returning({ id: accountRequests.id });
                if (!updated.length) throw new Error(`request #${item.id} claim failed`);
              }
              const updatedCycle = await tx.update(billingCycles).set({ status: "invoiced", invoiceNumber: mail.invoice.invoiceNumber, invoiceGmailMessageId: mail.messageId, invoiceReceivedAt: new Date(mail.receivedAt), lastError: null, updatedAt: new Date() }).where(and(eq(billingCycles.id, cycle.id), inArray(billingCycles.status, ["sent", "invoice_mismatch"]))).returning({ id: billingCycles.id });
              if (!updatedCycle.length) throw new Error(`cycle ${cycle.code} claim failed`);
            });
          } catch {
            claimSkipped++;
            continue;
          }
        }
        for (const item of plan.apply) {
          const row = rows.find((candidate) => candidate.id === item.id);
          if (row) { row.status = "invoiced"; row.invoiceNumber = mail.invoice.invoiceNumber; row.invoiceAmount = item.invoiceAmount; }
        }
        invoices.applied.push({ invoiceNumber: plan.invoiceNumber, ids: plan.apply.map((item) => item.id), skipped: [] });
        continue;
      }

      if (!mail.invoice.cycleCode) {
        const partialCycles = await findCyclesContainingRequestIds(mail.invoice.requestIds);
        if (partialCycles.length) {
          const reason = `요청번호 집합이 동결 주기와 정확히 일치하지 않음: ${partialCycles.map((item) => item.code).join(", ")}`;
          if (!dryRun) {
            for (const partialCycle of partialCycles) await markCycleMismatch(partialCycle.id, "invoice_mismatch", reason);
          }
          invoices.unmatched.push({ invoiceNumber: mail.invoice.invoiceNumber, reason });
          continue;
        }
      }

      const plan = planInvoiceSync(mail.invoice, rows);
      if (plan.kind === "already_synced") { invoices.alreadySynced++; continue; }
      if (plan.kind === "unmatched") { invoices.unmatched.push({ invoiceNumber: plan.invoiceNumber, reason: plan.reason || "unmatched" }); continue; }
      const appliedIds: number[] = [];
      for (const item of plan.apply) {
        if (!dryRun) {
          const claimed = await db.update(accountRequests).set({ invoiceNumber: mail.invoice.invoiceNumber, invoiceAmount: item.invoiceAmount, invoiceDueDate: mail.invoice.dueDate, status: "invoiced", updatedAt: new Date() }).where(and(eq(accountRequests.id, item.id), inArray(accountRequests.status, INVOICE_APPLY_STATUSES), isNull(accountRequests.invoiceNumber), notInArray(accountRequests.marketVoidState, [...VOID_EXCLUDED_STATES]))).returning({ id: accountRequests.id });
          if (!claimed.length) { claimSkipped++; continue; }
        }
        appliedIds.push(item.id);
      }
      if (appliedIds.length) invoices.applied.push({ invoiceNumber: plan.invoiceNumber, ids: appliedIds, skipped: plan.skipped });
      continue;
    }

    const cycle = await findCycleByInvoiceNumber(mail.payment.invoiceNumber);
    const plan = planPaymentSync(mail.payment, rows);
    if (plan.kind === "already_synced") { payments.alreadySynced++; continue; }
    if (plan.kind === "unmatched") {
      if (cycle && !dryRun) await markCycleMismatch(cycle.id, "payment_mismatch", plan.reason || "payment mismatch");
      payments.unmatched.push({ invoiceNumber: plan.invoiceNumber, reason: plan.reason || "unmatched" });
      continue;
    }
    if (cycle) {
      const frozenIds = (await loadFrozenCycleItems(cycle.id)).map((item) => item.requestId).sort((a, b) => a - b);
      const paymentIds = [...plan.ids].sort((a, b) => a - b);
      if (frozenIds.join(",") !== paymentIds.join(",")) {
        const reason = `결제 대상 요청이 동결 목록과 다름: expected #${frozenIds.join(", #")}, actual #${paymentIds.join(", #")}`;
        if (!dryRun) await markCycleMismatch(cycle.id, "payment_mismatch", reason);
        payments.unmatched.push({ invoiceNumber: plan.invoiceNumber, reason });
        continue;
      }
    }
    if (!dryRun) {
      try {
        await db.transaction(async (tx) => {
          for (const id of plan.ids) {
            const claimed = await tx.update(accountRequests).set({ status: "paid", paymentDate: mail.payment.paidOn ?? mail.receivedAt.slice(0, 10), paymentMethod: mail.payment.paymentMethod ?? "card", updatedAt: new Date() }).where(and(eq(accountRequests.id, id), inArray(accountRequests.status, PAYMENT_APPLY_STATUSES))).returning({ invoiceNumber: accountRequests.invoiceNumber });
            if (!claimed.length || normalizeInvoiceNumber(claimed[0].invoiceNumber) !== mail.payment.invoiceNumber) throw new Error(`request #${id} payment claim failed`);
          }
          if (cycle) {
            const updatedCycle = await tx.update(billingCycles).set({ status: "paid", paidAt: new Date(mail.receivedAt), receiptGmailMessageId: mail.messageId, lastError: null, updatedAt: new Date() }).where(and(eq(billingCycles.id, cycle.id), inArray(billingCycles.status, ["invoiced", "payment_mismatch"]))).returning({ id: billingCycles.id });
            if (!updatedCycle.length) throw new Error(`cycle ${cycle.code} payment claim failed`);
          }
        });
      } catch { claimSkipped++; continue; }
    }
    for (const id of plan.ids) { const row = rows.find((candidate) => candidate.id === id); if (row) row.status = "paid"; }
    payments.applied.push({ invoiceNumber: plan.invoiceNumber, ids: plan.ids, paidOn: mail.payment.paidOn });
  }

  const dedupe = (items: UnmatchedItem[]) => { const seen = new Set<string>(); return items.filter((item) => { const key = `${item.invoiceNumber}|${item.reason}`; if (seen.has(key)) return false; seen.add(key); return true; }); };
  invoices.unmatched = dedupe(invoices.unmatched);
  payments.unmatched = dedupe(payments.unmatched);
  let processing: ProcessingSyncResult;
  try { processing = await runProcessingMailSync({ ...options, dryRun }); }
  catch (error) { console.error("[processing-mail-sync] failed", error); processing = { scanned: 0, applied: [], alreadyConfirmed: [], review: [], incomplete: true, dryRun, error: "처리 완료 메일 동기화 실패 — 재시도 필요" }; }
  return { ok: true, skipped: false, processing, dryRun, scanned: mails.length, invoices, payments, claimSkipped, warnings, timestamp: new Date().toISOString() };
}

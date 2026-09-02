// 본사 청구 메일 → account_requests 반영.
//
// 인보이스 PDF 는 관리자 화면의 "인보이스 번호 일괄 입력" 과 같은 결과를 만들고(번호·금액·invoiced),
// QuickBooks 결제 확인은 "결제 완료" 체크와 같은 결과를 만든다(paid·결제일·수단).
// 멱등성은 상태로 보장한다: 번호가 이미 있으면 인보이스는 건너뛰고, paid 면 결제는 건너뛴다.
// 모든 UPDATE 는 WHERE 에 기대 상태를 넣어 경합 시 0건이면 claimSkipped 로 센다.
import { and, eq, inArray, isNull, notInArray, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { VOID_EXCLUDED_STATES } from "@/lib/account-email-template";
import { fetchBillingMails, missingBillingMailEnv } from "@/lib/billing-imap";
import {
  normalizeInvoiceNumber,
  planInvoiceSync,
  planPaymentSync,
  type BillingRow,
  type SkippedItem,
} from "@/lib/billing-mail";

export interface BillingSyncOptions {
  newerThanDays?: number;
  maxPerKind?: number;
  dryRun?: boolean;
}

export interface AppliedInvoice {
  invoiceNumber: string;
  ids: number[];
  skipped: SkippedItem[];
}

export interface AppliedPayment {
  invoiceNumber: string;
  ids: number[];
  paidOn: string | null;
}

export interface UnmatchedItem {
  invoiceNumber: string;
  reason: string;
}

export type BillingSyncResult =
  | { ok: true; skipped: true; reason: string }
  | {
      ok: true;
      skipped: false;
      dryRun: boolean;
      scanned: number;
      invoices: { applied: AppliedInvoice[]; alreadySynced: number; unmatched: UnmatchedItem[] };
      payments: { applied: AppliedPayment[]; alreadySynced: number; unmatched: UnmatchedItem[] };
      claimSkipped: number;
      warnings: string[];
      timestamp: string;
    };

const INVOICE_APPLY_STATUSES = ["sent", "processed"];
const PAYMENT_APPLY_STATUSES = ["sent", "processed", "invoiced"];

export async function runBillingSync(options: BillingSyncOptions = {}): Promise<BillingSyncResult> {
  const missing = missingBillingMailEnv();
  if (missing.length > 0) {
    return { ok: true, skipped: true, reason: `Gmail env 미설정: ${missing.join(", ")}` };
  }
  const dryRun = options.dryRun === true;
  const { mails, warnings } = await fetchBillingMails({
    newerThanDays: options.newerThanDays,
    maxPerKind: options.maxPerKind,
  });

  // 메일이 언급한 요청·인보이스 번호만 읽는다. 둘 다 비면 DB 를 건드릴 이유가 없다.
  const ids = new Set<number>();
  const numbers = new Set<string>();
  for (const mail of mails) {
    if (mail.kind === "invoice") {
      mail.invoice.requestIds.forEach((id) => ids.add(id));
      numbers.add(mail.invoice.invoiceNumber);
    } else {
      numbers.add(mail.payment.invoiceNumber);
    }
  }
  const conditions: SQL[] = [];
  if (ids.size > 0) conditions.push(inArray(accountRequests.id, [...ids]));
  if (numbers.size > 0) {
    // 사람이 "#1116" 처럼 적었을 수도 있어 양쪽 표기를 다 찾는다.
    const variants = [...numbers].flatMap((n) => [n, `#${n}`]);
    conditions.push(inArray(accountRequests.invoiceNumber, variants));
  }
  const rows: BillingRow[] = conditions.length === 0
    ? []
    : await db
        .select({
          id: accountRequests.id,
          status: accountRequests.status,
          invoiceNumber: accountRequests.invoiceNumber,
          invoiceAmount: accountRequests.invoiceAmount,
          quantity: accountRequests.quantity,
          marketVoidState: accountRequests.marketVoidState,
        })
        .from(accountRequests)
        .where(conditions.length === 1 ? conditions[0] : or(...conditions));

  const invoices = { applied: [] as AppliedInvoice[], alreadySynced: 0, unmatched: [] as UnmatchedItem[] };
  const payments = { applied: [] as AppliedPayment[], alreadySynced: 0, unmatched: [] as UnmatchedItem[] };
  let claimSkipped = 0;

  for (const mail of mails) {
    if (mail.kind === "invoice") {
      const plan = planInvoiceSync(mail.invoice, rows);
      if (plan.kind === "already_synced") {
        invoices.alreadySynced++;
        continue;
      }
      if (plan.kind === "unmatched") {
        invoices.unmatched.push({ invoiceNumber: plan.invoiceNumber, reason: plan.reason || "unmatched" });
        continue;
      }
      const appliedIds: number[] = [];
      for (const item of plan.apply) {
        if (!dryRun) {
          const claimed = await db
            .update(accountRequests)
            .set({
              invoiceNumber: mail.invoice.invoiceNumber,
              invoiceAmount: item.invoiceAmount,
              invoiceDueDate: mail.invoice.dueDate,
              status: "invoiced",
              updatedAt: new Date(),
            })
            .where(and(
              eq(accountRequests.id, item.id),
              inArray(accountRequests.status, INVOICE_APPLY_STATUSES),
              isNull(accountRequests.invoiceNumber),
              notInArray(accountRequests.marketVoidState, [...VOID_EXCLUDED_STATES]),
            ))
            .returning({ id: accountRequests.id });
          if (claimed.length === 0) {
            claimSkipped++;
            continue;
          }
        }
        // 같은 실행의 결제 매칭이 최신 상태를 보도록 메모리 반영
        const row = rows.find((r) => r.id === item.id);
        if (row) {
          row.status = "invoiced";
          row.invoiceNumber = mail.invoice.invoiceNumber;
          row.invoiceAmount = item.invoiceAmount;
        }
        appliedIds.push(item.id);
      }
      if (appliedIds.length > 0) {
        invoices.applied.push({ invoiceNumber: plan.invoiceNumber, ids: appliedIds, skipped: plan.skipped });
      }
    } else {
      const plan = planPaymentSync(mail.payment, rows);
      if (plan.kind === "already_synced") {
        payments.alreadySynced++;
        continue;
      }
      if (plan.kind === "unmatched") {
        payments.unmatched.push({ invoiceNumber: plan.invoiceNumber, reason: plan.reason || "unmatched" });
        continue;
      }
      const appliedIds: number[] = [];
      for (const id of plan.ids) {
        if (!dryRun) {
          const claimed = await db
            .update(accountRequests)
            .set({
              status: "paid",
              paymentDate: mail.payment.paidOn ?? mail.receivedAt.slice(0, 10),
              paymentMethod: mail.payment.paymentMethod ?? "card",
              updatedAt: new Date(),
            })
            .where(and(
              eq(accountRequests.id, id),
              inArray(accountRequests.status, PAYMENT_APPLY_STATUSES),
            ))
            .returning({ id: accountRequests.id, invoiceNumber: accountRequests.invoiceNumber });
          if (claimed.length === 0 || normalizeInvoiceNumber(claimed[0].invoiceNumber) !== mail.payment.invoiceNumber) {
            claimSkipped++;
            continue;
          }
        }
        const row = rows.find((r) => r.id === id);
        if (row) row.status = "paid";
        appliedIds.push(id);
      }
      if (appliedIds.length > 0) {
        payments.applied.push({ invoiceNumber: plan.invoiceNumber, ids: appliedIds, paidOn: mail.payment.paidOn });
      }
    }
  }

  // 중복 보고 제거: 같은 인보이스의 결제 확인이 여러 통(부분 결제)이면 사유가 반복된다.
  const dedupe = (items: UnmatchedItem[]) => {
    const seen = new Set<string>();
    return items.filter((u) => {
      const key = `${u.invoiceNumber}|${u.reason}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  invoices.unmatched = dedupe(invoices.unmatched);
  payments.unmatched = dedupe(payments.unmatched);

  if (invoices.unmatched.length + payments.unmatched.length > 0) {
    console.warn(`[sync-billing] unmatched — invoices: ${invoices.unmatched.length}, payments: ${payments.unmatched.length}`);
  }

  return {
    ok: true,
    skipped: false,
    dryRun,
    scanned: mails.length,
    invoices,
    payments,
    claimSkipped,
    warnings,
    timestamp: new Date().toISOString(),
  };
}

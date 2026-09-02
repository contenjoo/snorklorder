// 본사(Snorkl) 청구 메일 파서 + 동기화 판단 — 순수 함수만.
//
// 2026-08 부터 Snorkl 청구는 Stripe 가 아니라 QuickBooks 다. 연결고리는 두 가지뿐:
//   ① Cailie 가 인보이스 요청 스레드에 답장으로 붙이는 "Invoice NNNN.pdf"
//      → "Invoice no.: NNNN" + Note to customer 의 "[#id]" 줄(우리 메일의 invoiceLine() 을 그대로 복사)
//   ② quickbooks@notification.intuit.com 의 "Payment confirmation: Invoice #NNNN-(Snorkl, Inc.)"
//      → "You paid $X to Snorkl, Inc. on MM/DD/YYYY ... Invoice no. NNNN ... Total amount $X"
//
// IMAP 조회는 billing-imap.ts, DB 반영은 billing-sync.ts. 이 파일은 텍스트 → 구조화, 구조화 → 계획만.

import {
  VOID_EXCLUDED_STATES,
  allocateInvoiceAmounts,
  formatCentsAsAmount,
  parseInvoiceAmountToCents,
} from "./account-email-template.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedInvoicePdf {
  invoiceNumber: string; // "1116"
  invoiceDate: string | null; // 'YYYY-MM-DD'
  dueDate: string | null; // 'YYYY-MM-DD'
  totalCents: number | null; // 할인 후 Total
  requestIds: number[]; // Note to customer 의 [#id] — 등장 순, 중복 제거
}

export interface ParsedQuickBooksPayment {
  invoiceNumber: string; // "1116"
  paidCents: number; // "Total amount" — 이번에 실제 결제된 금액 (부분 결제면 인보이스 총액보다 작다)
  invoiceCents: number | null; // "Invoice amount"
  paidOn: string | null; // 'YYYY-MM-DD' — QuickBooks 가 적은 미국 날짜 그대로
  paymentMethod: string | null; // "MASTERCARD ••6135"
}

export interface BillingRow {
  id: number;
  status: string;
  invoiceNumber: string | null;
  invoiceAmount: string | null;
  quantity: number | null;
  marketVoidState: string | null;
}

export interface SkippedItem {
  id: number;
  reason: string;
}

export interface InvoicePlan {
  kind: "apply" | "already_synced" | "unmatched";
  invoiceNumber: string;
  apply: { id: number; invoiceAmount: string }[];
  skipped: SkippedItem[];
  reason?: string;
}

export interface PaymentPlan {
  kind: "apply" | "already_synced" | "unmatched";
  invoiceNumber: string;
  ids: number[];
  reason?: string;
}

// ─── 공통 ────────────────────────────────────────────────────────────────────

/** "09/01/2026" → "2026-09-01". 변환 불가 시 null. */
export function usDateToIso(raw: string | null | undefined): string | null {
  const m = (raw || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "$1,234.56" → 123456. 없거나 깨지면 null. */
export function amountToCents(raw: string | null | undefined): number | null {
  if (!raw) return null;
  return parseInvoiceAmountToCents(raw);
}

export function normalizeInvoiceNumber(raw: string | null | undefined): string {
  return (raw || "").replace(/^#/, "").trim();
}

// ─── ① 인보이스 PDF ──────────────────────────────────────────────────────────

/**
 * QuickBooks 인보이스 PDF 텍스트(unpdf extractText 결과)를 구조화한다.
 * 번호를 못 찾으면 null — 그 PDF 는 인보이스가 아니다.
 */
export function parseInvoicePdfText(text: string): ParsedInvoicePdf | null {
  const num = text.match(/Invoice\s+no\.?\s*:?\s*#?\s*(\d{3,})/i);
  if (!num) return null;

  const invoiceDate = usDateToIso(text.match(/Invoice\s+date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]);
  const dueDate = usDateToIso(text.match(/Due\s+date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]);

  // "Subtotal $400.00" 은 제외하고 줄 머리의 "Total $320.00" 만 잡는다.
  const total = text.match(/(?:^|\n)\s*Total\s+\$([\d,]+\.\d{2})/);
  const totalCents = amountToCents(total?.[1]);

  // Note to customer 구간 안의 [#id] 만 센다. 구간을 못 찾으면 전체에서 찾되, 이 경우도 형식은 같다.
  const noteStart = text.search(/Note\s+to\s+customer/i);
  let note = text;
  if (noteStart >= 0) {
    const rest = text.slice(noteStart);
    const noteEnd = rest.search(/View\s+and\s+pay|Subtotal/i);
    note = noteEnd > 0 ? rest.slice(0, noteEnd) : rest;
  }
  const requestIds: number[] = [];
  for (const m of note.matchAll(/\[#(\d+)\]/g)) {
    const id = Number(m[1]);
    if (Number.isFinite(id) && !requestIds.includes(id)) requestIds.push(id);
  }

  return { invoiceNumber: num[1], invoiceDate, dueDate, totalCents, requestIds };
}

// ─── ② QuickBooks 결제 확인 메일 ─────────────────────────────────────────────

/**
 * QuickBooks 결제 확인 메일 본문(text 또는 HTML 을 벗긴 텍스트)을 구조화한다.
 * Snorkl 청구가 아니거나(다른 거래처의 QuickBooks 메일) 번호·금액을 못 찾으면 null.
 */
export function parseQuickBooksPaymentText(raw: string, subject = ""): ParsedQuickBooksPayment | null {
  const text = raw
    .replace(/\[https?:[^\]]*\]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

  if (!/snorkl/i.test(text) && !/snorkl/i.test(subject)) return null;

  const num =
    text.match(/Invoice\s+no\.?\s*:?\s*#?\s*(\d{3,})/i) ||
    subject.match(/Invoice\s*#\s*(\d{3,})/i);
  if (!num) return null;

  const paid = text.match(/Total\s+amount\s*\$([\d,]+\.\d{2})/i) || text.match(/You\s+paid\s*\$([\d,]+\.\d{2})/i);
  const paidCents = amountToCents(paid?.[1]);
  if (paidCents === null) return null;

  const invoiceCents = amountToCents(text.match(/Invoice\s+amount\s*\$([\d,]+\.\d{2})/i)?.[1]);
  const paidOn = usDateToIso(text.match(/You\s+paid\s+\$[\d,.]+\s+to\s+.*?\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]);

  let paymentMethod: string | null = null;
  const pm = text.match(/Payment\s+method\s+([A-Za-z*x]*?)(\d{4})\b/i);
  if (pm) {
    const brand = pm[1].replace(/[*x]/gi, "").trim();
    paymentMethod = `${brand || "card"} ••${pm[2]}`;
  }

  return { invoiceNumber: num[1], paidCents, invoiceCents, paidOn, paymentMethod };
}

// ─── 동기화 계획 (DB 반영 전 판단) ───────────────────────────────────────────

const INVOICE_APPLY_STATUSES = ["sent", "processed"];
const PAYMENT_APPLY_STATUSES = ["sent", "processed", "invoiced"];

const ALREADY_RECORDED = "이미 기록됨";

/**
 * 인보이스 PDF → 어떤 요청에 번호·금액을 기록할지.
 *
 * 금액 배분은 관리자 화면의 일괄 입력과 같은 규칙(allocateInvoiceAmounts) — PDF 의 [#id] 전부를
 * 계정 수 비례로 나눈다. 이미 같은 번호가 적힌 건은 재실행 중복이라 건너뛰고, 다른 번호가 적혀
 * 있거나 상태가 맞지 않는 건은 손대지 않고 사유만 남긴다(수정 인보이스는 사람이 판단).
 */
export function planInvoiceSync(inv: ParsedInvoicePdf, rows: BillingRow[]): InvoicePlan {
  const base = { invoiceNumber: inv.invoiceNumber, apply: [], skipped: [] };
  if (inv.requestIds.length === 0) {
    return { ...base, kind: "unmatched", reason: "PDF Note 에 [#id] 없음" };
  }
  if (inv.totalCents === null) {
    return { ...base, kind: "unmatched", reason: "PDF 총액 파싱 실패" };
  }
  const found = inv.requestIds.map((id) => rows.find((r) => r.id === id) ?? null);
  const missing = inv.requestIds.filter((_, i) => !found[i]);
  if (missing.length > 0) {
    return { ...base, kind: "unmatched", reason: `요청 #${missing.join(", #")} 없음` };
  }
  const present = found as BillingRow[];
  const alloc = allocateInvoiceAmounts(inv.totalCents, present.map((r) => r.quantity || 1));

  const apply: InvoicePlan["apply"] = [];
  const skipped: SkippedItem[] = [];
  present.forEach((r, i) => {
    if (normalizeInvoiceNumber(r.invoiceNumber) === inv.invoiceNumber) {
      skipped.push({ id: r.id, reason: ALREADY_RECORDED });
      return;
    }
    if (r.invoiceNumber?.trim()) {
      skipped.push({ id: r.id, reason: `다른 인보이스 ${r.invoiceNumber} 기록됨` });
      return;
    }
    if (r.marketVoidState && (VOID_EXCLUDED_STATES as readonly string[]).includes(r.marketVoidState)) {
      skipped.push({ id: r.id, reason: `Market 취소 상태 ${r.marketVoidState}` });
      return;
    }
    if (!INVOICE_APPLY_STATUSES.includes(r.status)) {
      skipped.push({ id: r.id, reason: `상태 ${r.status}` });
      return;
    }
    apply.push({ id: r.id, invoiceAmount: formatCentsAsAmount(alloc[i]) });
  });

  if (apply.length > 0) return { ...base, kind: "apply", apply, skipped };
  if (skipped.every((s) => s.reason === ALREADY_RECORDED)) {
    return { ...base, kind: "already_synced", skipped };
  }
  return {
    ...base,
    kind: "unmatched",
    skipped,
    reason: skipped.map((s) => `#${s.id} ${s.reason}`).join(", "),
  };
}

/**
 * QuickBooks 결제 확인 → 어떤 요청을 paid 로 넘길지.
 *
 * 번호가 기록된 미결 건들의 청구액 합이 결제액과 정확히 같을 때만 전부 paid. 금액이 다르면
 * (부분 결제, 수정 인보이스, 번호 오기입) DB 를 건드리지 않고 사유를 보고한다 —
 * 계정당 $80 이라 금액만으로는 다른 인보이스와 구분이 안 되므로 번호 정확 매칭이 유일한 근거다.
 */
export function planPaymentSync(payment: ParsedQuickBooksPayment, rows: BillingRow[]): PaymentPlan {
  const base = { invoiceNumber: payment.invoiceNumber, ids: [] };
  const same = rows.filter((r) => normalizeInvoiceNumber(r.invoiceNumber) === payment.invoiceNumber);
  if (same.length === 0) {
    return { ...base, kind: "unmatched", reason: "이 번호가 기록된 요청 없음 — 인보이스 PDF 동기화 또는 수동 입력 필요" };
  }
  const open = same.filter((r) => PAYMENT_APPLY_STATUSES.includes(r.status));
  if (open.length === 0) {
    if (same.every((r) => r.status === "paid")) return { ...base, kind: "already_synced" };
    return {
      ...base,
      kind: "unmatched",
      reason: `번호 일치하지만 상태가 ${[...new Set(same.map((r) => r.status))].join("/")} — 수동 확인 필요`,
    };
  }
  let openCents = 0;
  for (const r of open) {
    const cents = amountToCents(r.invoiceAmount);
    if (cents === null) {
      return { ...base, kind: "unmatched", reason: `#${r.id} 청구 금액 미기입 — 수동 확인 필요` };
    }
    openCents += cents;
  }
  if (openCents !== payment.paidCents) {
    return {
      ...base,
      kind: "unmatched",
      reason: `결제 ${formatCentsAsAmount(payment.paidCents)} ≠ 미결 청구 ${formatCentsAsAmount(openCents)} (#${open.map((r) => r.id).join(", #")}) — 부분 결제/수정 인보이스 여부 확인`,
    };
  }
  return { ...base, kind: "apply", ids: open.map((r) => r.id) };
}

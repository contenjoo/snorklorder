// 인보이스 대기 목록의 SSOT.
//
// Cailie 가 "내가 이거 보냈나?" 를 다시 묻지 않게 하려면 답이 한 곳에서만 나와야 한다.
// 인보이스 메일 본문, 확인 페이지(/invoice), 파트너 포털의 Billing 탭이 전부 이 파일의
// 조건을 쓴다. 조건이 갈라지면 화면마다 다른 말을 하게 되고, 그게 바로 지금 고치는 문제다.
//
// 규칙 한 줄: "이 목록에 없으면 끝난 것."

import { and, desc, eq, gte, inArray, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { BASE_URL } from "@/lib/email";
import {
  DONE_INVOICE_STATUSES,
  OPEN_INVOICE_STATUSES,
  VOID_EXCLUDED_STATES,
  mergeOpenInvoiceItems,
  type InvoiceEmailItem,
} from "@/lib/account-email-template";

import { checkInvoiceViewToken, type InvoiceTokenCheck } from "@/lib/invoice-token";

export { DONE_INVOICE_STATUSES, OPEN_INVOICE_STATUSES, mergeOpenInvoiceItems };
export { checkInvoiceViewToken, type InvoiceTokenCheck };

/**
 * 확인 페이지는 고정 토큰 하나로 연다. 링크가 늘 같아야 Cailie 가 한 번 북마크하고
 * 그 뒤로 메일 없이도 확인할 수 있다 — 그게 이 화면의 존재 이유다.
 * 유출되면 환경변수만 교체하면 된다. 담기는 정보는 학교명·청구 요약뿐이고 교사 이메일은 없다.
 */
export function invoiceViewUrl(): string | null {
  const token = process.env.INVOICE_VIEW_TOKEN?.trim();
  if (!token) return null;
  return `${BASE_URL}/invoice?k=${encodeURIComponent(token)}`;
}

const LEDGER_FIELDS = {
  id: accountRequests.id,
  schoolName: accountRequests.schoolName,
  schoolNameEn: accountRequests.schoolNameEn,
  type: accountRequests.type,
  accountType: accountRequests.accountType,
  quantity: accountRequests.quantity,
  extensionDate: accountRequests.extensionDate,
  status: accountRequests.status,
  invoiceNumber: accountRequests.invoiceNumber,
  invoiceEmailSentAt: accountRequests.invoiceEmailSentAt,
  updatedAt: accountRequests.updatedAt,
};

export interface LedgerRow {
  id: number;
  schoolName: string;
  schoolNameEn: string | null;
  type: string;
  accountType: string | null;
  quantity: number | null;
  extensionDate: string | null;
  status: string;
  invoiceNumber: string | null;
  invoiceEmailSentAt: Date | null;
  updatedAt: Date;
}

/**
 * 인보이스 대기 건 조건.
 *
 * invoiceNumber 검사는 status 검사와 중복처럼 보이지만 아니다. Stripe 자동 감지가 꺼져 있는
 * 동안 번호만 수동으로 먼저 채워두는 경우가 있고, 그때도 목록에서 빠져야 한다.
 */
export function openInvoiceCondition() {
  return and(
    eq(accountRequests.needsInvoice, true),
    isNull(accountRequests.invoiceNumber),
    inArray(accountRequests.status, [...OPEN_INVOICE_STATUSES]),
    notInArray(accountRequests.marketVoidState, [...VOID_EXCLUDED_STATES]),
  );
}

/** 청구 대기 전체. 메일이든 페이지든 "지금 남은 것"은 항상 이 함수가 답한다. */
export async function listOpenInvoiceRows(): Promise<LedgerRow[]> {
  return db
    .select(LEDGER_FIELDS)
    .from(accountRequests)
    .where(openInvoiceCondition())
    .orderBy(accountRequests.id);
}

/**
 * 최근 청구 완료분. "#137 내가 했었나?" 에 직접 답하는 자리라 번호까지 같이 보여준다.
 *
 * 상한을 두는 이유: 과거에 일괄 처리한 건이 한 날짜에 몰려 있어서 기간만으로 자르면
 * 수백 줄이 쏟아진다. 그러면 정작 위쪽 "남은 것" 목록이 안 보인다.
 * 잘렸다는 사실은 화면에 표시하므로(RECENT_INVOICED_LIMIT) 조용한 절단이 아니다.
 */
export const RECENT_INVOICED_LIMIT = 15;

export async function listRecentlyInvoicedRows(
  days = 30,
  limit = RECENT_INVOICED_LIMIT,
): Promise<LedgerRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .select(LEDGER_FIELDS)
    .from(accountRequests)
    .where(and(
      eq(accountRequests.needsInvoice, true),
      inArray(accountRequests.status, [...DONE_INVOICE_STATUSES]),
      gte(accountRequests.updatedAt, since),
      notInArray(accountRequests.marketVoidState, [...VOID_EXCLUDED_STATES]),
    ))
    .orderBy(desc(accountRequests.updatedAt))
    .limit(limit);
}

/** 메일 본문 한 줄을 만드는 데 필요한 필드만 추린다. 교사 이메일은 청구에 불필요하므로 없다. */
export function toInvoiceEmailItem(row: LedgerRow): InvoiceEmailItem {
  return {
    requestId: row.id,
    schoolName: row.schoolName,
    schoolNameEn: row.schoolNameEn,
    type: row.type,
    accountType: row.accountType,
    quantity: row.quantity,
    extensionDate: row.extensionDate,
  };
}

/** 조회 실패로 메일 발송 자체를 막지는 않는다. 목록이 짧아질 뿐 청구 요청은 나가야 한다. */
export async function loadOpenInvoiceItemsForEmail(
  newItems: InvoiceEmailItem[],
): Promise<{ items: InvoiceEmailItem[]; newIds: Set<number> }> {
  try {
    const rows = await listOpenInvoiceRows();
    return mergeOpenInvoiceItems(newItems, rows.map(toInvoiceEmailItem));
  } catch {
    console.error("[invoice-ledger] failed to load open items; falling back to new items only");
    return { items: newItems, newIds: new Set(newItems.map((it) => it.requestId)) };
  }
}

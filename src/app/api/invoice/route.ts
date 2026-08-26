export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { invoiceSchool, invoiceWhat } from "@/lib/account-email-template";
import {
  OPEN_INVOICE_STATUSES,
  RECENT_INVOICED_LIMIT,
  checkInvoiceViewToken,
  listOpenInvoiceRows,
  listRecentlyInvoicedRows,
  toInvoiceEmailItem,
  type LedgerRow,
} from "@/lib/invoice-ledger";

// Cailie 의 인보이스 확인 페이지 백엔드.
//
// 세션이 아니라 고정 토큰(?k=)으로 연다. 링크가 늘 같아야 한 번 북마크해두고 메일 없이도
// 확인할 수 있고, 그게 이 화면의 전부다. 담기는 정보는 학교명·청구 요약·인보이스 번호뿐이며
// 교사 이메일은 인보이스 메일과 마찬가지로 넣지 않는다.

const NO_STORE = { "Cache-Control": "no-store" };

function tokenGate(req: NextRequest, bodyToken?: unknown): NextResponse | null {
  const provided = typeof bodyToken === "string" && bodyToken
    ? bodyToken
    : req.nextUrl.searchParams.get("k");

  switch (checkInvoiceViewToken(provided)) {
    case "ok":
      return null;
    case "not_configured":
      // 설정 누락을 통과로 바꾸지 않는다. 열려버리는 것보다 안 열리는 게 낫다.
      return NextResponse.json(
        { error: "Invoice view is not configured." },
        { status: 503, headers: NO_STORE },
      );
    default:
      return NextResponse.json(
        { error: "Invalid or expired link." },
        { status: 401, headers: NO_STORE },
      );
  }
}

function openView(row: LedgerRow) {
  const it = toInvoiceEmailItem(row);
  return {
    id: row.id,
    school: invoiceSchool(it),
    what: invoiceWhat(it),
    emailedAt: row.invoiceEmailSentAt ? row.invoiceEmailSentAt.toISOString() : null,
  };
}

function doneView(row: LedgerRow) {
  const it = toInvoiceEmailItem(row);
  return {
    id: row.id,
    school: invoiceSchool(it),
    what: invoiceWhat(it),
    invoiceNumber: row.invoiceNumber,
    markedAt: row.updatedAt.toISOString(),
    paid: row.status === "paid",
  };
}

export async function GET(req: NextRequest) {
  const denied = tokenGate(req);
  if (denied) return denied;

  try {
    const [open, recent] = await Promise.all([
      listOpenInvoiceRows(),
      listRecentlyInvoicedRows(30),
    ]);
    return NextResponse.json(
      {
        open: open.map(openView),
        recent: recent.map(doneView),
        recentLimit: RECENT_INVOICED_LIMIT,
        recentTruncated: recent.length >= RECENT_INVOICED_LIMIT,
      },
      { headers: NO_STORE },
    );
  } catch {
    console.error("[invoice] failed to load ledger");
    return NextResponse.json(
      { error: "Could not load the list. Please refresh." },
      { status: 500, headers: NO_STORE },
    );
  }
}

/**
 * "Invoiced" 표시. Stripe 자동 감지가 켜지기 전까지는 이게 목록을 줄이는 유일한 수단이다.
 *
 * 조건부 UPDATE 라 두 번 눌러도, 그 사이 Stripe 가 먼저 닫아도 결과가 같다.
 * 청구서 번호는 여기서 받지 않는다 — 사람이 옮겨 적게 하면 틀리고, Stripe 가 켜지면 자동으로 채워진다.
 */
export async function POST(req: NextRequest) {
  let payload: { k?: unknown; id?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400, headers: NO_STORE });
  }

  const denied = tokenGate(req, payload.k);
  if (denied) return denied;

  const id = payload.id;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Request id is required." }, { status: 400, headers: NO_STORE });
  }

  try {
    const marked = await db
      .update(accountRequests)
      .set({ status: "invoiced", updatedAt: new Date() })
      .where(and(
        eq(accountRequests.id, id),
        eq(accountRequests.needsInvoice, true),
        isNull(accountRequests.invoiceNumber),
        inArray(accountRequests.status, [...OPEN_INVOICE_STATUSES]),
        notInArray(accountRequests.marketVoidState, ["prepared", "voided"]),
      ))
      .returning({ id: accountRequests.id });

    if (marked.length === 0) {
      // 이미 닫혔거나(중복 클릭·Stripe 선행) 취소된 건. 화면은 새로고침만 하면 맞아진다.
      return NextResponse.json(
        { ok: false, code: "NOT_OPEN", error: "That request is no longer waiting for an invoice." },
        { status: 409, headers: NO_STORE },
      );
    }

    return NextResponse.json({ ok: true, id }, { headers: NO_STORE });
  } catch (err) {
    // 구 Market 주문 레거시 행은 DB 트리거가 쓰기를 막는다 (감사 전용). 500 대신 뜻이 통하는 응답으로.
    const message = err instanceof Error ? err.message : "";
    if (message.includes("MARKET_LEGACY") || message.includes("MARKET_REQUEST") || message.includes("MARKET_ORDER")) {
      return NextResponse.json(
        { ok: false, code: "LEGACY_LOCKED", error: "This request is audit-only and cannot be changed here." },
        { status: 409, headers: NO_STORE },
      );
    }
    console.error("[invoice] failed to mark invoiced");
    return NextResponse.json(
      { error: "Could not save. Please try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}

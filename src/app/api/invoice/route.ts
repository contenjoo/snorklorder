export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { invoiceSchool, invoiceWhat } from "@/lib/account-email-template";
import {
  RECENT_INVOICED_LIMIT,
  checkInvoiceViewToken,
  listOpenInvoiceRows,
  listRecentlyInvoicedRows,
  toInvoiceEmailItem,
  type LedgerRow,
} from "@/lib/invoice-ledger";

// Cailie 의 인보이스 확인 페이지 백엔드. **읽기 전용이다.**
//
// 목록을 닫는 건 인보이스 번호를 받는 쪽(관리자 정산 화면)의 일이다. 인보이스를 보내는 순간
// Cailie 의 일은 끝나고, 거기서 버튼을 또 누르게 하면 일이 하나 늘 뿐 아니라 안 눌렀을 때
// 목록이 거짓말을 한다. 번호는 PDF 를 받아 결제하는 사람이 확실히 알고 있다.
//
// 세션이 아니라 고정 토큰(?k=)으로 연다. 링크가 늘 같아야 한 번 북마크해두고 메일 없이도
// 확인할 수 있고, 그게 이 화면의 전부다. 담기는 정보는 학교명·청구 요약·인보이스 번호뿐이며
// 교사 이메일은 인보이스 메일과 마찬가지로 넣지 않는다.

const NO_STORE = { "Cache-Control": "no-store" };

function tokenGate(req: NextRequest): NextResponse | null {
  switch (checkInvoiceViewToken(req.nextUrl.searchParams.get("k"))) {
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

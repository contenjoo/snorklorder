export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  fetchStripeEmails,
  matchInvoice,
  matchReceipt,
  missingGmailEnv,
  toIsoDate,
  type MatchableRequest,
  type ParsedStripeEmail,
} from "@/lib/stripe-email";
import { authorizeCron } from "@/lib/cron-auth";

// Stripe 인보이스/영수증 Gmail 자동 감지 크론 (구 snorkl-manager sync-gmail 이식)
// - 인보이스 메일: processed 요청 매칭 → invoice_* 채우고 status='invoiced'
// - 결제 영수증: invoiced 요청 매칭 → payment_* 채우고 status='paid'
// - 매칭 실패(후보 0개/복수/금액 불일치)는 DB 변경 없이 unmatched 로 보고
// TODO: unmatched 항목을 payment-followup 다이제스트 메일에 통합 (현재는 응답 JSON + console.warn 만)

interface UnmatchedItem {
  type: "invoice" | "receipt";
  invoiceNumber: string;
  amount: string;
  reason: string;
}

interface MatchedItem {
  type: "invoice" | "receipt";
  requestId: number;
  via: "invoice_number" | "amount";
  invoiceNumber: string;
  amount: string;
}

// internalDate(epoch ms 문자열) → 'YYYY-MM-DD' (결제일 파싱 실패 시 수신일로 대체)
function internalDateToIso(internalDate: string | null): string | null {
  if (!internalDate) return null;
  const ms = Number(internalDate);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

async function run(req: NextRequest) {
  // Gmail OAuth env 미설정 시 코드 경로는 유지하되 조용히 스킵
  const missing = missingGmailEnv();
  if (missing.length > 0) {
    return NextResponse.json({
      skipped: true,
      reason: `Gmail OAuth env 미설정: ${missing.join(", ")}`,
    });
  }

  const params = req.nextUrl.searchParams;
  const newerThanDays = Math.max(1, Number(params.get("days")) || 7);
  const maxResults = Math.min(100, Math.max(1, Number(params.get("max")) || 20));
  // dryRun=1 이면 조회·매칭 결과만 보고하고 DB 는 변경하지 않음
  const dryRun = params.get("dryRun") === "1";

  const emails = await fetchStripeEmails({ newerThanDays, maxResults });

  // 매칭 대상: processed(인보이스 대기) / invoiced(결제 대기) / paid(재실행 중복 감지용)
  const rows: MatchableRequest[] = await db
    .select({
      id: accountRequests.id,
      status: accountRequests.status,
      invoiceNumber: accountRequests.invoiceNumber,
      invoiceAmount: accountRequests.invoiceAmount,
      paymentDate: accountRequests.paymentDate,
    })
    .from(accountRequests)
    // sent 포함 — 본사 처리 확인(processed) 전에 인보이스가 먼저 오는 경우가 있다 (구 snorkl-manager 와 동일 범위)
    .where(inArray(accountRequests.status, ["sent", "processed", "invoiced", "paid"]));

  let invoicesFound = 0;
  let receiptsFound = 0;
  let synced = 0;
  let alreadySynced = 0;
  const matched: MatchedItem[] = [];
  const unmatched: UnmatchedItem[] = [];

  // 인보이스 먼저 처리 — 같은 실행에서 도착한 인보이스+영수증이 순서대로 이어지도록
  const ordered: ParsedStripeEmail[] = [
    ...emails.filter((e) => e.type === "invoice"),
    ...emails.filter((e) => e.type === "receipt"),
  ];

  for (const email of ordered) {
    if (email.type === "invoice") {
      invoicesFound++;
      const result = matchInvoice(email.invoice, rows);

      if (result.kind === "already_synced") {
        alreadySynced++;
        continue;
      }
      if (result.kind === "unmatched") {
        const item: UnmatchedItem = {
          type: "invoice",
          invoiceNumber: email.invoice.invoiceNumber,
          amount: email.invoice.amount,
          reason: result.reason,
        };
        unmatched.push(item);
        console.warn(`[sync-stripe] unmatched invoice ${item.invoiceNumber || "(번호 없음)"} ${item.amount}: ${item.reason}`);
        continue;
      }

      const row = rows.find((r) => r.id === result.requestId)!;
      if (!dryRun) {
        await db
          .update(accountRequests)
          .set({
            status: "invoiced",
            invoiceNumber: email.invoice.invoiceNumber || null,
            invoiceAmount: email.invoice.amount || null,
            invoiceDueDate: toIsoDate(email.invoice.dueDate), // date 컬럼 — 'YYYY-MM-DD' 문자열
            paymentLink: email.invoice.paymentLink,
            updatedAt: new Date(),
          })
          .where(eq(accountRequests.id, row.id));
      }
      // 같은 실행 내 후속 매칭(영수증)이 최신 상태를 보도록 메모리 반영
      row.status = "invoiced";
      row.invoiceNumber = email.invoice.invoiceNumber || row.invoiceNumber;
      row.invoiceAmount = email.invoice.amount || row.invoiceAmount;
      matched.push({
        type: "invoice",
        requestId: row.id,
        via: result.via,
        invoiceNumber: email.invoice.invoiceNumber,
        amount: email.invoice.amount,
      });
      synced++;
    } else {
      receiptsFound++;
      const result = matchReceipt(email.receipt, rows);

      if (result.kind === "already_synced") {
        alreadySynced++;
        continue;
      }
      if (result.kind === "unmatched") {
        const item: UnmatchedItem = {
          type: "receipt",
          invoiceNumber: email.receipt.invoiceNumber,
          amount: email.receipt.amount,
          reason: result.reason,
        };
        unmatched.push(item);
        console.warn(`[sync-stripe] unmatched receipt ${item.invoiceNumber || "(번호 없음)"} ${item.amount}: ${item.reason}`);
        continue;
      }

      const row = rows.find((r) => r.id === result.requestId)!;
      const paymentDate = toIsoDate(email.receipt.paymentDate) ?? internalDateToIso(email.internalDate);
      if (!dryRun) {
        await db
          .update(accountRequests)
          .set({
            status: "paid",
            paymentDate, // date 컬럼 — 'YYYY-MM-DD' 문자열
            paymentMethod: email.receipt.paymentMethod || null,
            updatedAt: new Date(),
          })
          .where(eq(accountRequests.id, row.id));
      }
      row.status = "paid";
      row.paymentDate = paymentDate;
      matched.push({
        type: "receipt",
        requestId: row.id,
        via: result.via,
        invoiceNumber: email.receipt.invoiceNumber,
        amount: email.receipt.amount,
      });
      synced++;
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    scanned: emails.length,
    invoicesFound,
    receiptsFound,
    synced,
    alreadySynced,
    matched,
    unmatched,
    timestamp: new Date().toISOString(),
  });
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run(req);
}

export async function POST(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run(req);
}

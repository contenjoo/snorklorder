export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountRequests, domainRequests } from "@/db/schema";
import { and, eq, isNull, lt, lte } from "drizzle-orm";
import { sendPaymentFollowupDigest } from "@/lib/email";

function countEmails(emails: string): number {
  return emails.split(/[,;\n]+/).map((e) => e.trim()).filter(Boolean).length;
}

// 'YYYY-MM-DD' 문자열 — account_requests.invoice_due_date(date 타입)와 비교하기 위함
function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function run() {
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);

  // (a) status='sent' AND updated_at 3일 이상 경과 — Jon 미확인
  const staleSentRows = await db
    .select({
      schoolName: accountRequests.schoolName,
      schoolNameEn: accountRequests.schoolNameEn,
      emails: accountRequests.emails,
      updatedAt: accountRequests.updatedAt,
    })
    .from(accountRequests)
    .where(and(eq(accountRequests.status, "sent"), lt(accountRequests.updatedAt, daysAgo(3))))
    .orderBy(accountRequests.updatedAt);

  // (b) status='processed' AND confirmed_at 7일 이상 경과 AND invoice_number IS NULL — 인보이스 미수령
  const unInvoicedRows = await db
    .select({
      schoolName: accountRequests.schoolName,
      schoolNameEn: accountRequests.schoolNameEn,
      emails: accountRequests.emails,
      confirmedAt: accountRequests.confirmedAt,
    })
    .from(accountRequests)
    .where(
      and(
        eq(accountRequests.status, "processed"),
        lt(accountRequests.confirmedAt, daysAgo(7)),
        isNull(accountRequests.invoiceNumber)
      )
    )
    .orderBy(accountRequests.confirmedAt);

  // (c) status='invoiced' AND (invoice_due_date < 오늘 OR 오늘부터 3일 이내) AND payment_date IS NULL — 미결제/임박
  // 연체(< 오늘)는 항상 '오늘+3일 이내'에 포함되므로 단일 조건으로 표현.
  const unpaidRows = await db
    .select({
      schoolName: accountRequests.schoolName,
      schoolNameEn: accountRequests.schoolNameEn,
      emails: accountRequests.emails,
      invoiceDueDate: accountRequests.invoiceDueDate,
    })
    .from(accountRequests)
    .where(
      and(
        eq(accountRequests.status, "invoiced"),
        isNull(accountRequests.paymentDate),
        lte(accountRequests.invoiceDueDate, isoDate(3))
      )
    )
    .orderBy(accountRequests.invoiceDueDate);

  // (d) domain_requests 중 pending 상태 3일 이상 경과
  const pendingDomainRows = await db
    .select({
      schoolName: domainRequests.schoolName,
      schoolNameEn: domainRequests.schoolNameEn,
      domain: domainRequests.domain,
      createdAt: domainRequests.createdAt,
    })
    .from(domainRequests)
    .where(and(eq(domainRequests.status, "pending"), lt(domainRequests.createdAt, daysAgo(3))))
    .orderBy(domainRequests.createdAt);

  const counts = {
    staleSent: staleSentRows.length,
    unInvoiced: unInvoicedRows.length,
    unpaid: unpaidRows.length,
    pendingDomains: pendingDomainRows.length,
  };
  const total = counts.staleSent + counts.unInvoiced + counts.unpaid + counts.pendingDomains;

  if (total === 0) {
    return NextResponse.json({ ok: true, sent: false, counts, total });
  }

  const res = await sendPaymentFollowupDigest({
    staleSent: staleSentRows.map((r) => ({
      schoolName: r.schoolName,
      schoolNameEn: r.schoolNameEn,
      emailCount: countEmails(r.emails),
      updatedAt: r.updatedAt,
    })),
    unInvoiced: unInvoicedRows.map((r) => ({
      schoolName: r.schoolName,
      schoolNameEn: r.schoolNameEn,
      emailCount: countEmails(r.emails),
      confirmedAt: r.confirmedAt!,
    })),
    unpaid: unpaidRows.map((r) => ({
      schoolName: r.schoolName,
      schoolNameEn: r.schoolNameEn,
      emailCount: countEmails(r.emails),
      invoiceDueDate: r.invoiceDueDate!,
    })),
    pendingDomains: pendingDomainRows.map((r) => ({
      schoolName: r.schoolName,
      schoolNameEn: r.schoolNameEn,
      domain: r.domain,
      createdAt: r.createdAt,
    })),
  });

  return NextResponse.json({ ok: true, sent: res.success, counts, total });
}

function authorize(req: NextRequest): boolean {
  // 1) Vercel 크론: Authorization: Bearer ${CRON_SECRET} (자동 전송) — 기존 크론과 동일
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`) {
    return true;
  }
  // 2) 수동 트리거: x-api-key 헤더 또는 ?key= (INTEGRATION_API_KEY)
  const apiKey = process.env.INTEGRATION_API_KEY;
  if (apiKey) {
    const provided = req.headers.get("x-api-key") ?? req.nextUrl.searchParams.get("key");
    if (provided === apiKey) return true;
  }
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}

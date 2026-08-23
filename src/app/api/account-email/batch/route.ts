export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { inArray, eq } from "drizzle-orm";
import { getTransporter, logEmail, formatLogRecipients, BASE_URL, HQ_EMAIL, HQ_INVOICE_TO } from "@/lib/email";
import { buildBatchEmail, buildInvoiceEmail, defaultNeedsInvoice, type BatchEmailItem, type InvoiceEmailItem } from "@/lib/account-email-template";
import { parseEmailList } from "@/lib/security";

interface Section {
  subject: string;
  body: string;
}

// 여러 account_requests를 메일로 묶어 발송한다. 수신자별로 두 통이 나간다:
//   1) 처리 메일 → Jon (전체 건, 교사 이메일 목록·confirm 링크 포함)
//   2) 인보이스 메일 → Cailie (CC: Jon). 인보이스 필요 건만, 청구 요약만.
// 두 메일은 요청번호(#id)로 대조한다.
export async function POST(req: NextRequest) {
  try {
    const { requestIds, sections } = (await req.json()) as { requestIds?: number[]; sections?: Section[] };
    if (!Array.isArray(requestIds) || requestIds.length === 0) {
      return NextResponse.json({ error: "requestIds is required" }, { status: 400 });
    }
    if (!Array.isArray(sections) || sections.length !== requestIds.length) {
      return NextResponse.json({ error: "sections must match requestIds length" }, { status: 400 });
    }

    const transporter = getTransporter();
    if (!transporter) {
      return NextResponse.json({ error: "Gmail not configured (GMAIL_USER / GMAIL_APP_PASSWORD missing)" }, { status: 500 });
    }

    const rows = await db
      .select({
        id: accountRequests.id,
        confirmToken: accountRequests.confirmToken,
        emails: accountRequests.emails,
        status: accountRequests.status,
        type: accountRequests.type,
        needsInvoice: accountRequests.needsInvoice,
        schoolName: accountRequests.schoolName,
        schoolNameEn: accountRequests.schoolNameEn,
        accountType: accountRequests.accountType,
        quantity: accountRequests.quantity,
        extensionDate: accountRequests.extensionDate,
      })
      .from(accountRequests)
      .where(inArray(accountRequests.id, requestIds));

    const tokenMap = new Map<number, string>();
    for (const id of requestIds) {
      const row = rows.find((r) => r.id === id);
      if (!row) continue;
      let token = row.confirmToken;
      if (!token) {
        token = randomBytes(16).toString("hex");
        await db
          .update(accountRequests)
          .set({ confirmToken: token, updatedAt: new Date() })
          .where(eq(accountRequests.id, id));
      }
      tokenMap.set(id, token);
    }

    const totalEmails = rows.reduce((s, r) => s + parseEmailList(r.emails).length, 0);

    // 요청별 인보이스 필요 여부. DB 에 행이 없는(삭제된) id 는 보수적으로 "필요"로 본다.
    const items: BatchEmailItem[] = requestIds.map((id, i) => {
      const row = rows.find((r) => r.id === id);
      const token = tokenMap.get(id);
      return {
        subject: sections[i].subject,
        body: sections[i].body,
        requestId: id,
        needsInvoice: row
          ? typeof row.needsInvoice === "boolean"
            ? row.needsInvoice
            : defaultNeedsInvoice(row.type)
          : true,
        confirmLine: token ? `Once done, confirm: ${BASE_URL}/account-confirm/${token}` : null,
      };
    });

    const from = process.env.GMAIL_USER || "";
    const { subject, body } = buildBatchEmail(items, totalEmails);
    const logTo = formatLogRecipients(HQ_EMAIL);

    try {
      await transporter.sendMail({ from, to: HQ_EMAIL, subject, text: body });
      await logEmail({ to: logTo, subject, kind: "account_email", status: "success", relatedType: "account_request" });
    } catch (sendErr) {
      await logEmail({ to: logTo, subject, kind: "account_email", status: "failed", error: String(sendErr), relatedType: "account_request" });
      throw sendErr;
    }

    // 인보이스 메일 → Cailie (CC: Jon). 인보이스 필요 건만 추린다.
    // 실패해도 Jon 처리 메일은 이미 나갔으므로 전체를 실패시키지 않고 로그만 남긴다.
    const invoiceItems: InvoiceEmailItem[] = requestIds
      .filter((id, i) => items[i].needsInvoice)
      .map((id) => rows.find((r) => r.id === id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => ({
        requestId: r.id, schoolName: r.schoolName, schoolNameEn: r.schoolNameEn,
        type: r.type, accountType: r.accountType, quantity: r.quantity, extensionDate: r.extensionDate,
      }));

    let invoiceSent = false;
    if (invoiceItems.length > 0) {
      const inv = buildInvoiceEmail(invoiceItems);
      const invLogTo = formatLogRecipients(HQ_INVOICE_TO, HQ_EMAIL);
      try {
        await transporter.sendMail({ from, to: HQ_INVOICE_TO, cc: HQ_EMAIL, subject: inv.subject, text: inv.body });
        await logEmail({ to: invLogTo, subject: inv.subject, kind: "account_email", status: "success", relatedType: "account_request" });
        invoiceSent = true;
      } catch (invErr) {
        await logEmail({ to: invLogTo, subject: inv.subject, kind: "account_email", status: "failed", error: String(invErr), relatedType: "account_request" });
      }
    }

    // sent 처리 — 단, 이미 processed/invoiced/paid 로 넘어간 건은 재발송해도 정산 단계가 sent로 되돌아가지 않도록 제외
    const updatableIds = rows.filter((r) => ["draft", "sent"].includes(r.status)).map((r) => r.id);
    if (updatableIds.length > 0) {
      await db
        .update(accountRequests)
        .set({ status: "sent", updatedAt: new Date() })
        .where(inArray(accountRequests.id, updatableIds));
    }

    return NextResponse.json({ success: true, count: requestIds.length, totalEmails, invoiceSent, invoiceCount: invoiceItems.length });
  } catch (err) {
    console.error("Batch account email error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send batch email" },
      { status: 500 },
    );
  }
}

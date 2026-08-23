export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTransporter, logEmail, escapeHtml, formatLogRecipients, BASE_URL, HQ_EMAIL, HQ_INVOICE_TO } from "@/lib/email";
import { withHqGreeting, defaultNeedsInvoice, buildInvoiceEmail } from "@/lib/account-email-template";

export async function POST(req: NextRequest) {
  try {
    const { requestId, subject, body } = await req.json();

    if (!subject || !body) {
      return NextResponse.json({ error: "subject and body are required" }, { status: 400 });
    }

    const transporter = getTransporter();
    if (!transporter) {
      return NextResponse.json({ error: "Gmail not configured (GMAIL_USER / GMAIL_APP_PASSWORD missing)" }, { status: 500 });
    }

    const from = process.env.GMAIL_USER || "";

    // 확인 링크용 토큰 발급 (update된 request에 저장). 이미 있으면 재사용.
    // 동시에 인보이스 필요 여부를 읽어 Cailie 에게 별도 인보이스 메일을 보낼지 결정한다.
    let confirmLink = "";
    let needsInvoice = false; // requestId 없는 임시 발송은 인보이스 메일을 보내지 않는다 (청구 정보를 알 수 없음)
    let invoiceRow: {
      schoolName: string; schoolNameEn: string | null; type: string;
      accountType: string | null; quantity: number | null; extensionDate: string | null;
    } | null = null;
    if (requestId) {
      const [existing] = await db
        .select({
          confirmToken: accountRequests.confirmToken,
          needsInvoice: accountRequests.needsInvoice,
          type: accountRequests.type,
          schoolName: accountRequests.schoolName,
          schoolNameEn: accountRequests.schoolNameEn,
          accountType: accountRequests.accountType,
          quantity: accountRequests.quantity,
          extensionDate: accountRequests.extensionDate,
        })
        .from(accountRequests)
        .where(eq(accountRequests.id, requestId));
      needsInvoice =
        typeof existing?.needsInvoice === "boolean"
          ? existing.needsInvoice
          : defaultNeedsInvoice(existing?.type || "upgrade");
      if (existing) {
        invoiceRow = {
          schoolName: existing.schoolName, schoolNameEn: existing.schoolNameEn,
          type: existing.type, accountType: existing.accountType,
          quantity: existing.quantity, extensionDate: existing.extensionDate,
        };
      }
      let token = existing?.confirmToken || null;
      if (!token) {
        token = randomBytes(16).toString("hex");
        await db
          .update(accountRequests)
          .set({ confirmToken: token, updatedAt: new Date() })
          .where(eq(accountRequests.id, requestId));
      }
      confirmLink = `${BASE_URL}/account-confirm/${token}`;
    }

    // 클라이언트가 보낸 본문의 인사말을 실제 수신자(Jon 단독)에 맞춰 치환한다 (SSOT: account-email-template).
    const finalBody = withHqGreeting(String(body));
    const bodyHtml = escapeHtml(finalBody).replace(/\n/g, "<br>");

    const buttonBlock = confirmLink
      ? `<div style="text-align:center;margin:24px 0;padding:20px;background:#f0f7ff;border-radius:12px;border:1px solid #dbeafe">
           <p style="margin:0 0 12px;color:#1e3a5f;font-size:14px;font-weight:600">Once the upgrade is done:</p>
           <a href="${confirmLink}"
              style="display:inline-block;background:#2563eb;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">
             ✓ Mark Upgrade as Done
           </a>
           <p style="margin:12px 0 0;color:#888;font-size:11px">Or paste this in your browser:<br>${escapeHtml(confirmLink)}</p>
         </div>`
      : "";

    // 처리 메일은 Jon 단독 수신. 인보이스는 아래에서 Cailie 에게 별도 발송한다.
    const logTo = formatLogRecipients(HQ_EMAIL);

    try {
      await transporter.sendMail({
        from,
        to: HQ_EMAIL,
        subject,
        text: confirmLink ? `${finalBody}\n\n---\nOnce the upgrade is done, please click to confirm:\n${confirmLink}\n` : finalBody,
        html: `<div style="max-width:560px;margin:0 auto;font-family:-apple-system,sans-serif;color:#1f2937;font-size:14px;line-height:1.6">
                 ${buttonBlock}
                 <div>${bodyHtml}</div>
               </div>`,
      });
      await logEmail({ to: logTo, subject, kind: "account_email", status: "success", relatedType: "account_request", relatedId: requestId || null });
    } catch (sendErr) {
      await logEmail({ to: logTo, subject, kind: "account_email", status: "failed", error: String(sendErr), relatedType: "account_request", relatedId: requestId || null });
      throw sendErr;
    }

    // 인보이스 요청은 Cailie 에게 별도 메일 (Jon CC). 교사 이메일 목록 없이 청구 요약만 담는다.
    // 실패해도 Jon 처리 메일은 이미 나갔으므로 요청 전체를 실패시키지 않고 로그만 남긴다.
    let invoiceSent = false;
    if (needsInvoice && invoiceRow && requestId) {
      const inv = buildInvoiceEmail([{ requestId, ...invoiceRow }]);
      const invLogTo = formatLogRecipients(HQ_INVOICE_TO, HQ_EMAIL);
      try {
        await transporter.sendMail({ from, to: HQ_INVOICE_TO, cc: HQ_EMAIL, subject: inv.subject, text: inv.body });
        await logEmail({ to: invLogTo, subject: inv.subject, kind: "account_email", status: "success", relatedType: "account_request", relatedId: requestId });
        invoiceSent = true;
      } catch (invErr) {
        await logEmail({ to: invLogTo, subject: inv.subject, kind: "account_email", status: "failed", error: String(invErr), relatedType: "account_request", relatedId: requestId });
      }
    }

    // Update status to "sent" if requestId provided — 단, 이미 processed/invoiced/paid 로 넘어간 건은
    // 재발송(예: Jon에게 다시 보내기)해도 정산 단계가 sent로 되돌아가지 않도록 유지
    if (requestId) {
      const [current] = await db
        .select({ status: accountRequests.status })
        .from(accountRequests)
        .where(eq(accountRequests.id, requestId));
      if (current && ["draft", "sent"].includes(current.status)) {
        await db
          .update(accountRequests)
          .set({ status: "sent", updatedAt: new Date() })
          .where(eq(accountRequests.id, requestId));
      }
    }

    return NextResponse.json({ success: true, confirmLink, invoiceSent });
  } catch (error) {
    console.error("Account email send error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send email" },
      { status: 500 }
    );
  }
}

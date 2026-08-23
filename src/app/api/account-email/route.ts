export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getTransporter, logEmail, escapeHtml, formatLogRecipients, BASE_URL, HQ_EMAIL, HQ_INVOICE_TO } from "@/lib/email";
import { withHqGreeting, defaultNeedsInvoice, buildInvoiceEmail } from "@/lib/account-email-template";
import {
  getAccountEmailDeliveryState,
  invoiceDeliveryFailureMessage,
  isValidAccountEmailRequestId,
  parseAccountEmailSendMode,
} from "@/lib/account-email-delivery";

function deliveryUnknownResponse(stage: "processing" | "invoice", status = 409) {
  return NextResponse.json({
    success: false,
    partialSuccess: false,
    code: "EMAIL_DELIVERY_UNKNOWN",
    error: "Email delivery is in an unknown state. Check Gmail Sent before any retry.",
    deliveryUnknown: true,
    unknownStage: stage,
    invoiceRetryAvailable: false,
  }, { status });
}

function legacyDeliveryBlockedResponse() {
  return NextResponse.json({
    success: false,
    partialSuccess: false,
    code: "LEGACY_EMAIL_DELIVERY_COMPLETE",
    error: "This legacy request is already complete. Duplicate email delivery is blocked.",
    legacyDeliveryBlocked: true,
    invoiceRetryAvailable: false,
  }, { status: 409 });
}

export async function POST(req: NextRequest) {
  try {
    const { requestId, subject, body, mode: rawMode } = await req.json();
    const mode = parseAccountEmailSendMode(rawMode);

    if (!mode) {
      return NextResponse.json({ error: "mode must be send_all or invoice_only" }, { status: 400 });
    }
    if (!isValidAccountEmailRequestId(requestId)) {
      return NextResponse.json({ error: "requestId must be a positive integer" }, { status: 400 });
    }
    if (mode === "send_all" && (!subject || !body)) {
      return NextResponse.json({ error: "subject and body are required" }, { status: 400 });
    }

    const transporter = getTransporter();
    if (!transporter) {
      return NextResponse.json({ error: "Gmail not configured (GMAIL_USER / GMAIL_APP_PASSWORD missing)" }, { status: 500 });
    }

    const from = process.env.GMAIL_USER || "";

    let confirmLink = "";
    let existing: {
      id: number;
      confirmToken: string | null;
      status: string;
      needsInvoice: boolean;
      schoolName: string;
      schoolNameEn: string | null;
      type: string;
      accountType: string | null;
      quantity: number | null;
      extensionDate: string | null;
      processingEmailSendStartedAt: Date | null;
      processingEmailSentAt: Date | null;
      invoiceEmailSendStartedAt: Date | null;
      invoiceEmailSentAt: Date | null;
    } | null = null;
    if (requestId) {
      [existing] = await db
        .select({
          id: accountRequests.id,
          confirmToken: accountRequests.confirmToken,
          status: accountRequests.status,
          needsInvoice: accountRequests.needsInvoice,
          type: accountRequests.type,
          schoolName: accountRequests.schoolName,
          schoolNameEn: accountRequests.schoolNameEn,
          accountType: accountRequests.accountType,
          quantity: accountRequests.quantity,
          extensionDate: accountRequests.extensionDate,
          processingEmailSendStartedAt: accountRequests.processingEmailSendStartedAt,
          processingEmailSentAt: accountRequests.processingEmailSentAt,
          invoiceEmailSendStartedAt: accountRequests.invoiceEmailSendStartedAt,
          invoiceEmailSentAt: accountRequests.invoiceEmailSentAt,
        })
        .from(accountRequests)
        .where(eq(accountRequests.id, requestId));

      if (!existing) {
        return NextResponse.json({ error: "Account request not found" }, { status: 404 });
      }

      const deliveryState = getAccountEmailDeliveryState(existing);
      if (deliveryState === "processing_unknown" || deliveryState === "invoice_unknown") {
        return deliveryUnknownResponse(
          deliveryState === "processing_unknown" ? "processing" : "invoice",
        );
      }
      if (deliveryState === "legacy_complete") {
        return legacyDeliveryBlockedResponse();
      }
      if (mode === "send_all" && deliveryState !== "ready") {
        const partialSuccess = deliveryState === "invoice_retry";
        return NextResponse.json({
          success: false,
          partialSuccess,
          code: partialSuccess ? "INVOICE_RETRY_REQUIRED" : "PROCESSING_EMAIL_ALREADY_SENT",
          error: partialSuccess
            ? "Jon processing email was already sent. Retry the Cailie invoice only."
            : "Jon processing email was already sent.",
          processingEmailSent: true,
          invoiceSent: Boolean(existing.invoiceEmailSentAt),
          invoiceRetryAvailable: partialSuccess,
        }, { status: 409 });
      }

      if (mode === "invoice_only" && deliveryState !== "invoice_retry") {
        return NextResponse.json({
          success: false,
          code: deliveryState === "ready" ? "PROCESSING_EMAIL_NOT_SENT" : "INVOICE_ALREADY_SENT",
          error: deliveryState === "ready"
            ? "Jon processing email must be sent before the invoice."
            : "Cailie invoice email was already sent.",
        }, { status: 409 });
      }

      let token = existing.confirmToken;
      if (mode === "send_all" && !token) {
        token = randomBytes(16).toString("hex");
        await db
          .update(accountRequests)
          .set({ confirmToken: token, updatedAt: new Date() })
          .where(eq(accountRequests.id, requestId));
      }
      if (token) confirmLink = `${BASE_URL}/account-confirm/${token}`;
    }

    const needsInvoice = existing
      ? typeof existing.needsInvoice === "boolean"
        ? existing.needsInvoice
        : defaultNeedsInvoice(existing.type)
      : false;
    let processingClaimedAt: Date | null = null;

    if (mode === "send_all") {
      if (existing) {
        processingClaimedAt = new Date();
        const claimed = await db
          .update(accountRequests)
          .set({ processingEmailSendStartedAt: processingClaimedAt, updatedAt: processingClaimedAt })
          .where(and(
            eq(accountRequests.id, existing.id),
            eq(accountRequests.status, "draft"),
            isNull(accountRequests.processingEmailSentAt),
            isNull(accountRequests.processingEmailSendStartedAt),
          ))
          .returning({ id: accountRequests.id });
        if (claimed.length === 0) return deliveryUnknownResponse("processing");
        existing.processingEmailSendStartedAt = processingClaimedAt;
      }

      // 클라이언트 본문의 인사말을 실제 수신자(Jon 단독)에 맞춰 치환한다.
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
      } catch {
        try {
          await logEmail({ to: logTo, subject, kind: "account_email", status: "failed", error: "Jon processing email delivery failed", relatedType: "account_request", relatedId: requestId || null });
        } catch {
          console.error("[account-email] failed to persist processing email failure log");
        }
        if (existing && processingClaimedAt) {
          try {
            const released = await db
              .update(accountRequests)
              .set({ processingEmailSendStartedAt: null, updatedAt: new Date() })
              .where(and(
                eq(accountRequests.id, existing.id),
                eq(accountRequests.processingEmailSendStartedAt, processingClaimedAt),
                isNull(accountRequests.processingEmailSentAt),
              ))
              .returning({ id: accountRequests.id });
            if (released.length === 0) return deliveryUnknownResponse("processing", 500);
            existing.processingEmailSendStartedAt = null;
          } catch {
            console.error("[account-email] failed to release processing email claim");
            return deliveryUnknownResponse("processing", 500);
          }
        }
        return NextResponse.json({ success: false, error: "Failed to send Jon processing email" }, { status: 502 });
      }
      try {
        await logEmail({ to: logTo, subject, kind: "account_email", status: "success", relatedType: "account_request", relatedId: requestId || null });
      } catch {
        console.error("[account-email] failed to persist processing email success log");
      }

      // SMTP 성공 뒤 sentAt+claim 해제를 한 CAS로 확정한다. 실패하면 claim을 남겨 unknown으로 차단한다.
      if (existing) {
        const sentAt = new Date();
        if (!processingClaimedAt) return deliveryUnknownResponse("processing", 500);
        try {
          const finalized = await db
            .update(accountRequests)
            .set({
              processingEmailSendStartedAt: null,
              processingEmailSentAt: sentAt,
              invoiceEmailLastError: null,
              ...(["draft", "sent"].includes(existing.status) ? { status: "sent" } : {}),
              updatedAt: sentAt,
            })
            .where(and(
              eq(accountRequests.id, existing.id),
              eq(accountRequests.processingEmailSendStartedAt, processingClaimedAt),
              isNull(accountRequests.processingEmailSentAt),
            ))
            .returning({ id: accountRequests.id });
          if (finalized.length === 0) return deliveryUnknownResponse("processing", 500);
        } catch {
          console.error("[account-email] Jon email sent but state persistence failed");
          return deliveryUnknownResponse("processing", 500);
        }
        existing.processingEmailSendStartedAt = null;
        existing.processingEmailSentAt = sentAt;
      }

      if (!needsInvoice || !existing) {
        return NextResponse.json({
          success: true,
          partialSuccess: false,
          confirmLink,
          processingEmailSent: true,
          invoiceRequired: false,
          invoiceSent: false,
        });
      }
    }

    if (!existing || !needsInvoice) {
      return NextResponse.json({ error: "Invoice retry is not available for this request" }, { status: 409 });
    }

    const invoiceClaimedAt = new Date();
    const invoiceClaimed = await db
      .update(accountRequests)
      .set({ invoiceEmailSendStartedAt: invoiceClaimedAt, updatedAt: invoiceClaimedAt })
      .where(and(
        eq(accountRequests.id, existing.id),
        isNotNull(accountRequests.processingEmailSentAt),
        isNull(accountRequests.invoiceEmailSentAt),
        isNull(accountRequests.invoiceEmailSendStartedAt),
      ))
      .returning({ id: accountRequests.id });
    if (invoiceClaimed.length === 0) return deliveryUnknownResponse("invoice");
    existing.invoiceEmailSendStartedAt = invoiceClaimedAt;

    // 최초 발송과 invoice_only 재시도는 이 한 경로만 사용하며 Jon 메일은 여기서 절대 보내지 않는다.
    const inv = buildInvoiceEmail([{ requestId: existing.id, ...existing }]);
    const invLogTo = formatLogRecipients(HQ_INVOICE_TO, HQ_EMAIL);
    try {
      await transporter.sendMail({ from, to: HQ_INVOICE_TO, cc: HQ_EMAIL, subject: inv.subject, text: inv.body });
    } catch {
      const safeError = invoiceDeliveryFailureMessage();
      try {
        await logEmail({ to: invLogTo, subject: inv.subject, kind: "account_email", status: "failed", error: safeError, relatedType: "account_request", relatedId: existing.id });
      } catch {
        console.error("[account-email] failed to persist invoice email failure log");
      }
      try {
        const released = await db
          .update(accountRequests)
          .set({
            invoiceEmailSendStartedAt: null,
            invoiceEmailLastError: safeError,
            updatedAt: new Date(),
          })
          .where(and(
            eq(accountRequests.id, existing.id),
            eq(accountRequests.invoiceEmailSendStartedAt, invoiceClaimedAt),
            isNull(accountRequests.invoiceEmailSentAt),
          ))
          .returning({ id: accountRequests.id });
        if (released.length === 0) return deliveryUnknownResponse("invoice", 500);
        existing.invoiceEmailSendStartedAt = null;
      } catch {
        console.error("[account-email] failed to release invoice email claim");
        return deliveryUnknownResponse("invoice", 500);
      }

      return NextResponse.json({
        success: false,
        partialSuccess: true,
        code: "INVOICE_DELIVERY_FAILED",
        error: "Jon processing email was sent, but the Cailie invoice email failed.",
        confirmLink,
        processingEmailSent: true,
        processingEmailSentAt: existing.processingEmailSentAt,
        invoiceRequired: true,
        invoiceSent: false,
        invoiceRetryAvailable: true,
      }, { status: 502 });
    }

    try {
      await logEmail({ to: invLogTo, subject: inv.subject, kind: "account_email", status: "success", relatedType: "account_request", relatedId: existing.id });
    } catch {
      console.error("[account-email] failed to persist invoice email success log");
    }
    const invoiceSentAt = new Date();
    try {
      const finalized = await db
        .update(accountRequests)
        .set({
          invoiceEmailSendStartedAt: null,
          invoiceEmailSentAt: invoiceSentAt,
          invoiceEmailLastError: null,
          updatedAt: invoiceSentAt,
        })
        .where(and(
          eq(accountRequests.id, existing.id),
          eq(accountRequests.invoiceEmailSendStartedAt, invoiceClaimedAt),
          isNull(accountRequests.invoiceEmailSentAt),
        ))
        .returning({ id: accountRequests.id });
      if (finalized.length === 0) return deliveryUnknownResponse("invoice", 500);
    } catch {
      console.error("[account-email] Cailie email sent but state persistence failed");
      return deliveryUnknownResponse("invoice", 500);
    }

    return NextResponse.json({
      success: true,
      partialSuccess: false,
      confirmLink,
      processingEmailSent: true,
      processingEmailSentAt: existing.processingEmailSentAt,
      invoiceRequired: true,
      invoiceSent: true,
      invoiceEmailSentAt: invoiceSentAt,
    });
  } catch {
    console.error("[account-email] request failed");
    return NextResponse.json({ error: "Failed to process account email request" }, { status: 500 });
  }
}

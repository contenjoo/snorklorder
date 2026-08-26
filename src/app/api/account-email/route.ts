export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getTransporter, logEmail, escapeHtml, formatLogRecipients, BASE_URL, HQ_EMAIL, HQ_INVOICE_TO } from "@/lib/email";
import { withHqGreeting, defaultNeedsInvoice, buildInvoiceEmail, generateAccountEmail } from "@/lib/account-email-template";
import {
  hydrateAccountRequestSchoolNames,
  needsEnglishSchoolNameForHq,
} from "@/lib/account-request-school-name";
import {
  getAccountEmailDeliveryState,
  invoiceDeliveryFailureMessage,
  isValidAccountEmailRequestId,
  parseAccountEmailSendMode,
} from "@/lib/account-email-delivery";
import { invoiceViewUrl, loadOpenInvoiceItemsForEmail } from "@/lib/invoice-ledger";
import { claimAccountRequestSideEffects } from "@/lib/market-void-db";
import { getReceiverFulfillmentPausedResponse } from "@/lib/receiver-fulfillment-pause";
import { hasMarketLegacyOrderNote } from "@/lib/market-legacy-audit";

function deliveryUnknownResponse(stage: "processing" | "invoice", status = 409) {
  return NextResponse.json({
    success: false,
    partialSuccess: stage === "invoice",
    code: "EMAIL_DELIVERY_UNKNOWN",
    error: "Email delivery is in an unknown state. Check Gmail Sent before any retry.",
    deliveryUnknown: true,
    unknownStage: stage,
    manualAuditRequired: true,
    manualAuditTarget: "Gmail Sent",
    automaticRetryBlocked: true,
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

function legacyMarketAuditBlockedResponse() {
  return NextResponse.json({
    success: false,
    partialSuccess: false,
    code: "MARKET_LEGACY_MANUAL_AUDIT_REQUIRED",
    error: "This legacy Market order is audit-only and cannot send email automatically.",
    manualAuditRequired: true,
    automaticRetryBlocked: true,
    invoiceRetryAvailable: false,
  }, { status: 409 });
}

export async function POST(req: NextRequest) {
  const pausedResponse = getReceiverFulfillmentPausedResponse();
  if (pausedResponse) return pausedResponse;

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
      channel: string | null;
      externalSource: string | null;
      confirmToken: string | null;
      status: string;
      needsInvoice: boolean;
      applicantType: string | null;
      schoolName: string;
      schoolNameEn: string | null;
      type: string;
      emails: string;
      accountType: string | null;
      quantity: number | null;
      oldEmail: string | null;
      fromType: string | null;
      extensionDate: string | null;
      notes: string | null;
      processingEmailSendStartedAt: Date | null;
      processingEmailSentAt: Date | null;
      invoiceEmailSendStartedAt: Date | null;
      invoiceEmailSentAt: Date | null;
    } | null = null;
    if (requestId) {
      [existing] = await db
        .select({
          id: accountRequests.id,
          channel: accountRequests.channel,
          externalSource: accountRequests.externalSource,
          confirmToken: accountRequests.confirmToken,
          status: accountRequests.status,
          needsInvoice: accountRequests.needsInvoice,
          applicantType: accountRequests.applicantType,
          type: accountRequests.type,
          schoolName: accountRequests.schoolName,
          schoolNameEn: accountRequests.schoolNameEn,
          emails: accountRequests.emails,
          accountType: accountRequests.accountType,
          quantity: accountRequests.quantity,
          oldEmail: accountRequests.oldEmail,
          fromType: accountRequests.fromType,
          extensionDate: accountRequests.extensionDate,
          notes: accountRequests.notes,
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
      if (
        (existing.channel || "company") === "company"
        && existing.externalSource !== "market"
        && hasMarketLegacyOrderNote(existing.notes)
      ) {
        return legacyMarketAuditBlockedResponse();
      }
      [existing] = await hydrateAccountRequestSchoolNames([existing]);
      if (needsEnglishSchoolNameForHq(existing)) {
        return NextResponse.json({
          success: false,
          code: "ENGLISH_SCHOOL_NAME_REQUIRED",
          error: "English school name is required before sending this request to HQ.",
        }, { status: 400 });
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

      // 토큰 생성이나 SMTP보다 먼저 order fence를 선점한다. prepare가 먼저 이겼다면
      // false이며, 이 요청에서는 어떤 외부 side effect도 시작하지 않는다.
      if (!(await claimAccountRequestSideEffects([existing.id]))) {
        return NextResponse.json({
          success: false,
          code: "MARKET_VOID_FENCED",
          error: "This Market order is being cancelled or has already been voided.",
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

      // 실제 발송 본문은 DB 기준으로 재생성한다. 낡은 미리보기/클라이언트 값이 한국어 학교명을 보내지 못하게 한다.
      const generated = existing ? generateAccountEmail(existing) : { subject: String(subject), body: String(body) };
      const finalSubject = generated.subject;
      const finalBody = withHqGreeting(generated.body);
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
          subject: finalSubject,
          text: confirmLink ? `${finalBody}\n\n---\nOnce the upgrade is done, please click to confirm:\n${confirmLink}\n` : finalBody,
          html: `<div style="max-width:560px;margin:0 auto;font-family:-apple-system,sans-serif;color:#1f2937;font-size:14px;line-height:1.6">
                   ${buttonBlock}
                   <div>${bodyHtml}</div>
                 </div>`,
        });
      } catch {
        try {
          await logEmail({ to: logTo, subject: finalSubject, kind: "account_email", status: "failed", error: "Jon processing email delivery outcome unknown; check Gmail Sent", relatedType: "account_request", relatedId: requestId || null });
        } catch {
          console.error("[account-email] failed to persist processing email failure log");
        }
        // sendMail throw는 SMTP 미시도 증거가 아니다. claim을 UNKNOWN으로 보존해
        // 운영자가 Gmail Sent를 확인하기 전 자동 중복 발송을 막는다.
        return deliveryUnknownResponse("processing", 502);
      }
      try {
        await logEmail({ to: logTo, subject: finalSubject, kind: "account_email", status: "success", relatedType: "account_request", relatedId: requestId || null });
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
    // 이번 건만이 아니라 아직 청구가 안 끝난 전체를 싣는다 — 마지막 메일 한 통이 곧 현황.
    const openInvoice = await loadOpenInvoiceItemsForEmail([{ requestId: existing.id, ...existing }]);
    const inv = buildInvoiceEmail(openInvoice.items, {
      newIds: openInvoice.newIds,
      viewUrl: invoiceViewUrl(),
    });
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
          const preserved = await db
            .update(accountRequests)
            .set({
              invoiceEmailLastError: safeError,
              updatedAt: new Date(),
          })
          .where(and(
            eq(accountRequests.id, existing.id),
            eq(accountRequests.invoiceEmailSendStartedAt, invoiceClaimedAt),
            isNull(accountRequests.invoiceEmailSentAt),
            ))
            .returning({ id: accountRequests.id });
          if (preserved.length === 0) {
            console.error("[account-email] failed to annotate unknown invoice claim");
          }
        } catch {
          console.error("[account-email] failed to annotate unknown invoice claim");
        }
        // Cailie 발송도 결과가 불확실하다. startedAt을 남겨 invoice_only 자동 재시도를 막는다.
        return deliveryUnknownResponse("invoice", 502);
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

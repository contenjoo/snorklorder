export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { getTransporter, logEmail, formatLogRecipients, BASE_URL, HQ_EMAIL, HQ_INVOICE_TO } from "@/lib/email";
import { buildBatchEmail, buildInvoiceEmail, defaultNeedsInvoice, type BatchEmailItem, type InvoiceEmailItem } from "@/lib/account-email-template";
import { parseEmailList } from "@/lib/security";
import {
  getAccountEmailDeliveryState,
  invoiceDeliveryFailureMessage,
  parseAccountEmailSendMode,
} from "@/lib/account-email-delivery";

interface Section {
  subject: string;
  body: string;
}

function deliveryUnknownResponse(
  stage: "processing" | "invoice",
  requestIds: number[],
  status = 409,
) {
  return NextResponse.json({
    success: false,
    partialSuccess: false,
    code: "EMAIL_DELIVERY_UNKNOWN",
    error: "Email delivery is in an unknown state. Check Gmail Sent before any retry.",
    deliveryUnknown: true,
    unknownStage: stage,
    blockedRequestIds: requestIds,
    invoiceRetryAvailable: false,
  }, { status });
}

function legacyDeliveryBlockedResponse(requestIds: number[]) {
  return NextResponse.json({
    success: false,
    partialSuccess: false,
    code: "LEGACY_EMAIL_DELIVERY_COMPLETE",
    error: "Legacy requests are already complete. Duplicate email delivery is blocked.",
    legacyDeliveryBlocked: true,
    blockedRequestIds: requestIds,
    invoiceRetryAvailable: false,
  }, { status: 409 });
}

// 여러 account_requests를 메일로 묶어 발송한다. 수신자별로 두 통이 나간다:
//   1) 처리 메일 → Jon (전체 건, 교사 이메일 목록·confirm 링크 포함)
//   2) 인보이스 메일 → Cailie (CC: Jon). 인보이스 필요 건만, 청구 요약만.
// 두 메일은 요청번호(#id)로 대조한다.
export async function POST(req: NextRequest) {
  try {
    const { requestIds, sections, mode: rawMode } = (await req.json()) as {
      requestIds?: number[];
      sections?: Section[];
      mode?: unknown;
    };
    const mode = parseAccountEmailSendMode(rawMode);
    if (!mode) {
      return NextResponse.json({ error: "mode must be send_all or invoice_only" }, { status: 400 });
    }
    if (!Array.isArray(requestIds) || requestIds.length === 0) {
      return NextResponse.json({ error: "requestIds is required" }, { status: 400 });
    }
    if (mode === "send_all" && (!Array.isArray(sections) || sections.length !== requestIds.length)) {
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
        processingEmailSendStartedAt: accountRequests.processingEmailSendStartedAt,
        processingEmailSentAt: accountRequests.processingEmailSentAt,
        invoiceEmailSendStartedAt: accountRequests.invoiceEmailSendStartedAt,
        invoiceEmailSentAt: accountRequests.invoiceEmailSentAt,
      })
      .from(accountRequests)
      .where(inArray(accountRequests.id, requestIds));

    const uniqueRequestIds = [...new Set(requestIds)];
    if (uniqueRequestIds.length !== requestIds.length || rows.length !== uniqueRequestIds.length) {
      return NextResponse.json({ error: "requestIds must be unique existing account requests" }, { status: 400 });
    }

    const deliveryStates = rows.map((row) => ({
      id: row.id,
      state: getAccountEmailDeliveryState(row),
    }));
    const unknown = deliveryStates.filter(
      (item) => item.state === "processing_unknown" || item.state === "invoice_unknown",
    );
    if (unknown.length > 0) {
      return deliveryUnknownResponse(
        unknown.some((item) => item.state === "processing_unknown") ? "processing" : "invoice",
        unknown.map((item) => item.id),
      );
    }
    const legacyComplete = deliveryStates.filter((item) => item.state === "legacy_complete");
    if (legacyComplete.length > 0) {
      return legacyDeliveryBlockedResponse(legacyComplete.map((item) => item.id));
    }
    if (mode === "send_all") {
      const blocked = deliveryStates.filter((item) => item.state !== "ready");
      if (blocked.length > 0) {
        const retryable = blocked.filter((item) => item.state === "invoice_retry");
        return NextResponse.json({
          success: false,
          partialSuccess: retryable.length > 0,
          code: retryable.length > 0 ? "INVOICE_RETRY_REQUIRED" : "PROCESSING_EMAIL_ALREADY_SENT",
          error: retryable.length > 0
            ? "Some Jon processing emails were already sent. Retry those Cailie invoices only."
            : "Some Jon processing emails were already sent.",
          blockedRequestIds: blocked.map((item) => item.id),
          invoiceRetryRequestIds: retryable.map((item) => item.id),
        }, { status: 409 });
      }
    } else {
      const notRetryable = deliveryStates.filter((item) => item.state !== "invoice_retry");
      if (notRetryable.length > 0) {
        return NextResponse.json({
          success: false,
          code: "INVOICE_RETRY_NOT_AVAILABLE",
          error: "Every selected request must have a pending Cailie invoice.",
          blockedRequestIds: notRetryable.map((item) => item.id),
        }, { status: 409 });
      }
    }

    const tokenMap = new Map<number, string>();
    for (const id of mode === "send_all" ? requestIds : []) {
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

    const totalEmails = mode === "send_all"
      ? rows.reduce((sum, row) => sum + parseEmailList(row.emails).length, 0)
      : 0;
    const sendSections = Array.isArray(sections) ? sections : [];

    // 요청별 인보이스 필요 여부와 Claude의 요청번호 [#id] 블록을 그대로 유지한다.
    const items: BatchEmailItem[] = mode === "send_all" ? requestIds.map((id, i) => {
      const row = rows.find((r) => r.id === id);
      const token = tokenMap.get(id);
      return {
        subject: sendSections[i].subject,
        body: sendSections[i].body,
        requestId: id,
        needsInvoice: row
          ? typeof row.needsInvoice === "boolean"
            ? row.needsInvoice
            : defaultNeedsInvoice(row.type)
          : true,
        confirmLine: token ? `Once done, confirm: ${BASE_URL}/account-confirm/${token}` : null,
      };
    }) : [];

    const from = process.env.GMAIL_USER || "";
    if (mode === "send_all") {
      const processingClaimedAt = new Date();
      const claimed = await db
        .update(accountRequests)
        .set({ processingEmailSendStartedAt: processingClaimedAt, updatedAt: processingClaimedAt })
        .where(and(
          inArray(accountRequests.id, requestIds),
          eq(accountRequests.status, "draft"),
          isNull(accountRequests.processingEmailSentAt),
          isNull(accountRequests.processingEmailSendStartedAt),
        ))
        .returning({ id: accountRequests.id });
      const claimedIds = claimed.map((item) => item.id);
      if (claimedIds.length !== requestIds.length) {
        if (claimedIds.length > 0) {
          try {
            await db
              .update(accountRequests)
              .set({ processingEmailSendStartedAt: null, updatedAt: new Date() })
              .where(and(
                inArray(accountRequests.id, claimedIds),
                eq(accountRequests.processingEmailSendStartedAt, processingClaimedAt),
                isNull(accountRequests.processingEmailSentAt),
              ));
          } catch {
            console.error("[batch-account-email] failed to release partial processing claims");
          }
        }
        return deliveryUnknownResponse("processing", requestIds);
      }
      for (const row of rows) row.processingEmailSendStartedAt = processingClaimedAt;

      const { subject, body } = buildBatchEmail(items, totalEmails);
      const logTo = formatLogRecipients(HQ_EMAIL);

      try {
        await transporter.sendMail({ from, to: HQ_EMAIL, subject, text: body });
      } catch {
        try {
          await logEmail({ to: logTo, subject, kind: "account_email", status: "failed", error: "Jon processing email delivery failed", relatedType: "account_request" });
        } catch {
          console.error("[batch-account-email] failed to persist processing email failure log");
        }
        try {
          const released = await db
            .update(accountRequests)
            .set({ processingEmailSendStartedAt: null, updatedAt: new Date() })
            .where(and(
              inArray(accountRequests.id, claimedIds),
              eq(accountRequests.processingEmailSendStartedAt, processingClaimedAt),
              isNull(accountRequests.processingEmailSentAt),
            ))
            .returning({ id: accountRequests.id });
          if (released.length !== claimedIds.length) {
            return deliveryUnknownResponse("processing", requestIds, 500);
          }
        } catch {
          console.error("[batch-account-email] failed to release processing email claims");
          return deliveryUnknownResponse("processing", requestIds, 500);
        }
        return NextResponse.json({ success: false, error: "Failed to send Jon processing email batch" }, { status: 502 });
      }
      try {
        await logEmail({ to: logTo, subject, kind: "account_email", status: "success", relatedType: "account_request" });
      } catch {
        console.error("[batch-account-email] failed to persist processing email success log");
      }

      // SMTP 성공 뒤 sentAt+claim 해제를 CAS로 확정한다. 실패하면 claim을 남겨 unknown으로 차단한다.
      const processingSentAt = new Date();
      try {
        const finalized = await db
          .update(accountRequests)
          .set({
            processingEmailSendStartedAt: null,
            processingEmailSentAt: processingSentAt,
            invoiceEmailLastError: null,
            updatedAt: processingSentAt,
          })
          .where(and(
            inArray(accountRequests.id, claimedIds),
            eq(accountRequests.processingEmailSendStartedAt, processingClaimedAt),
            isNull(accountRequests.processingEmailSentAt),
          ))
          .returning({ id: accountRequests.id });
        if (finalized.length !== claimedIds.length) {
          return deliveryUnknownResponse("processing", requestIds, 500);
        }
      } catch {
        console.error("[batch-account-email] Jon email sent but state persistence failed");
        return deliveryUnknownResponse("processing", requestIds, 500);
      }

      const updatableIds = rows.filter((row) => ["draft", "sent"].includes(row.status)).map((row) => row.id);
      if (updatableIds.length > 0) {
        await db
          .update(accountRequests)
          .set({ status: "sent", updatedAt: processingSentAt })
          .where(inArray(accountRequests.id, updatableIds));
      }
      for (const row of rows) {
        row.processingEmailSendStartedAt = null;
        row.processingEmailSentAt = processingSentAt;
      }
    }

    // 인보이스 메일 → Cailie (CC: Jon). invoice_only 재시도도 이 경로만 사용한다.
    const invoiceItems: InvoiceEmailItem[] = requestIds
      .filter((id, index) => mode === "invoice_only" || items[index].needsInvoice)
      .map((id) => rows.find((r) => r.id === id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => ({
        requestId: r.id, schoolName: r.schoolName, schoolNameEn: r.schoolNameEn,
        type: r.type, accountType: r.accountType, quantity: r.quantity, extensionDate: r.extensionDate,
      }));

    if (invoiceItems.length > 0) {
      const invoiceIds = invoiceItems.map((item) => item.requestId);
      const invoiceClaimedAt = new Date();
      const claimed = await db
        .update(accountRequests)
        .set({ invoiceEmailSendStartedAt: invoiceClaimedAt, updatedAt: invoiceClaimedAt })
        .where(and(
          inArray(accountRequests.id, invoiceIds),
          isNotNull(accountRequests.processingEmailSentAt),
          isNull(accountRequests.invoiceEmailSentAt),
          isNull(accountRequests.invoiceEmailSendStartedAt),
        ))
        .returning({ id: accountRequests.id });
      const claimedIds = claimed.map((item) => item.id);
      if (claimedIds.length !== invoiceIds.length) {
        if (claimedIds.length > 0) {
          try {
            await db
              .update(accountRequests)
              .set({ invoiceEmailSendStartedAt: null, updatedAt: new Date() })
              .where(and(
                inArray(accountRequests.id, claimedIds),
                eq(accountRequests.invoiceEmailSendStartedAt, invoiceClaimedAt),
                isNull(accountRequests.invoiceEmailSentAt),
              ));
          } catch {
            console.error("[batch-account-email] failed to release partial invoice claims");
          }
        }
        return deliveryUnknownResponse("invoice", invoiceIds);
      }
      for (const row of rows) {
        if (claimedIds.includes(row.id)) row.invoiceEmailSendStartedAt = invoiceClaimedAt;
      }

      const inv = buildInvoiceEmail(invoiceItems);
      const invLogTo = formatLogRecipients(HQ_INVOICE_TO, HQ_EMAIL);
      try {
        await transporter.sendMail({ from, to: HQ_INVOICE_TO, cc: HQ_EMAIL, subject: inv.subject, text: inv.body });
      } catch {
        const safeError = invoiceDeliveryFailureMessage();
        try {
          await logEmail({ to: invLogTo, subject: inv.subject, kind: "account_email", status: "failed", error: safeError, relatedType: "account_request" });
        } catch {
          console.error("[batch-account-email] failed to persist invoice email failure log");
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
              inArray(accountRequests.id, claimedIds),
              eq(accountRequests.invoiceEmailSendStartedAt, invoiceClaimedAt),
              isNull(accountRequests.invoiceEmailSentAt),
            ))
            .returning({ id: accountRequests.id });
          if (released.length !== claimedIds.length) {
            return deliveryUnknownResponse("invoice", invoiceIds, 500);
          }
        } catch {
          console.error("[batch-account-email] failed to release invoice email claims");
          return deliveryUnknownResponse("invoice", invoiceIds, 500);
        }

        return NextResponse.json({
          success: false,
          partialSuccess: true,
          code: "INVOICE_DELIVERY_FAILED",
          error: "Jon processing email was sent, but the Cailie invoice email failed.",
          count: requestIds.length,
          totalEmails,
          processingEmailSent: true,
          invoiceSent: false,
          invoiceCount: invoiceItems.length,
          invoiceRetryAvailable: true,
          invoiceRetryRequestIds: invoiceItems.map((item) => item.requestId),
        }, { status: 502 });
      }

      try {
        await logEmail({ to: invLogTo, subject: inv.subject, kind: "account_email", status: "success", relatedType: "account_request" });
      } catch {
        console.error("[batch-account-email] failed to persist invoice email success log");
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
            inArray(accountRequests.id, claimedIds),
            eq(accountRequests.invoiceEmailSendStartedAt, invoiceClaimedAt),
            isNull(accountRequests.invoiceEmailSentAt),
          ))
          .returning({ id: accountRequests.id });
        if (finalized.length !== claimedIds.length) {
          return deliveryUnknownResponse("invoice", invoiceIds, 500);
        }
      } catch {
        console.error("[batch-account-email] Cailie email sent but state persistence failed");
        return deliveryUnknownResponse("invoice", invoiceIds, 500);
      }
    }

    return NextResponse.json({
      success: true,
      partialSuccess: false,
      count: requestIds.length,
      totalEmails,
      processingEmailSent: true,
      invoiceSent: invoiceItems.length > 0,
      invoiceCount: invoiceItems.length,
    });
  } catch {
    console.error("[batch-account-email] request failed");
    return NextResponse.json({ error: "Failed to process batch account email request" }, { status: 500 });
  }
}

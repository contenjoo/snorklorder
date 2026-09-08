import { buildBatchEmail, generateAccountEmail, type AccountEmailInput } from "./account-email-template.ts";
import { isMarketLegacyAuditRequest } from "./market-legacy-audit.ts";

export interface ProcessingRequest extends AccountEmailInput {
  id: number;
  confirmToken?: string | null;
}

export interface ProcessingCandidate extends ProcessingRequest {
  partnerLifecycleState?: string | null;
  externalSource?: string | null;
  channel?: string | null;
  marketRequestId?: string | null;
  marketOrderId?: string | null;
  orderNumber?: string | null;
  idempotencyKey?: string | null;
  draftOnly?: boolean;
  status: string;
  confirmedAt?: Date | string | null;
  processingEmailSentAt?: Date | string | null;
  processingEmailSendStartedAt?: Date | string | null;
  invoiceEmailSendStartedAt?: Date | string | null;
  invoiceEmailSentAt?: Date | string | null;
  marketVoidState?: string | null;
  createdAt?: Date | string;
}

export function isIndividualUpgrade(r: Pick<AccountEmailInput, "type" | "accountType">): boolean {
  return r.type === "upgrade" && (r.accountType === "teacher" || r.accountType === "student");
}

export function isProcessingConfirmed(r: { status: string; confirmedAt?: Date | string | null }): boolean {
  return Boolean(r.confirmedAt) || r.status === "processed";
}

/** Billing is independent: an invoiced/paid request may still await Jon's confirmation. */
export function processingReviewReason(r: ProcessingCandidate): string | null {
  if (!isIndividualUpgrade(r) || isProcessingConfirmed(r)
    || !["sent", "invoiced", "paid"].includes(r.status)
    || ["prepared", "voided"].includes(r.marketVoidState || "")
    || (r.channel === "partner" && r.partnerLifecycleState !== "active")
    || isMarketLegacyAuditRequest(r)) return null;
  if (r.processingEmailSendStartedAt || (r.invoiceEmailSendStartedAt && !r.invoiceEmailSentAt)) {
    return "발송 결과 확인 필요";
  }
  // 발송 원장이 도입되기 전 요청은 시각 기록이 없다. 기록 부재만으로
  // 미처리 경고를 만들거나 완료로 추정하지 않는다. 실제 시도/발송 근거가 있을 때만 검토한다.
  if (!r.processingEmailSentAt) {
    return r.invoiceEmailSentAt ? "처리 메일 발송 기록 확인 필요" : null;
  }
  if (!r.confirmToken) return "완료 확인 링크 확인 필요";
  return null;
}

export function isOpenProcessingRequest(r: ProcessingCandidate): boolean {
  return isIndividualUpgrade(r) && !isProcessingConfirmed(r)
    && ["sent", "invoiced", "paid"].includes(r.status)
    && !["prepared", "voided"].includes(r.marketVoidState || "")
    && (r.channel !== "partner" || r.partnerLifecycleState === "active")
    && !isMarketLegacyAuditRequest(r)
    && Boolean(r.processingEmailSentAt && r.confirmToken)
    && !processingReviewReason(r);
}

export function selectProcessingReminders(newRequests: ProcessingRequest[], candidates: ProcessingCandidate[]) {
  if (!newRequests.some(isIndividualUpgrade)) return { reminders: [], manualReview: [] };
  const newIds = new Set(newRequests.map((r) => r.id));
  const unique = [...new Map(candidates.filter((r) => !newIds.has(r.id)).map((r) => [r.id, r])).values()];
  const reminders = unique.filter(isOpenProcessingRequest).sort((a, b) => {
    const aTime = new Date(a.processingEmailSentAt!).getTime();
    const bTime = new Date(b.processingEmailSentAt!).getTime();
    return aTime - bTime || a.id - b.id;
  });
  const manualReview = unique.flatMap((r) => {
    const reason = processingReviewReason(r);
    return reason ? [{ requestId: r.id, reason }] : [];
  });
  return { reminders, manualReview };
}

/** Pure renderer shared by preview and both SMTP paths. No tokens are created here. */
export function buildProcessingEmail(
  fresh: ProcessingRequest[],
  reminders: ProcessingCandidate[],
  options: { baseUrl: string; batch?: boolean },
) {
  const newRequests = [...new Map(fresh.map((r) => [r.id, r])).values()];
  const selected = selectProcessingReminders(newRequests, reminders).reminders;
  const linkLine = (r: ProcessingRequest) => r.confirmToken
    ? `Once done, confirm: ${options.baseUrl}/account-confirm/${r.confirmToken}`
    : "(The confirmation link will be added when this request is sent.)";
  const cumulative = newRequests.some(isIndividualUpgrade);
  const all = [...newRequests, ...selected];
  let email: { subject: string; body: string };
  if (cumulative) {
    const lines = [
      "Hi Jon,", "",
      "New requests and earlier individual account upgrades awaiting confirmation are below.",
      "If you have already upgraded an account, please only confirm it below; do not upgrade it again.",
      "This is a snapshot at send time. Each confirmation page shows the current status.", "",
    ];
    for (const [label, rows] of [["NEW REQUESTS", newRequests], ["AWAITING CONFIRMATION", selected]] as const) {
      lines.push(`${label} (${rows.length})`, "");
      for (const r of rows) {
        const generated = generateAccountEmail(r);
        lines.push(`[#${r.id}] ${generated.subject}`);
        if (label === "AWAITING CONFIRMATION") {
          lines.push(`First sent: ${new Date((r as ProcessingCandidate).processingEmailSentAt!).toISOString().slice(0, 10)} (UTC)`);
        }
        lines.push(generated.body.replace(/^Hi Jon,\s*/, "").replace(/\n\nBanghyun$/, ""), "", linkLine(r), "");
      }
    }
    lines.push("Thank you,", "Banghyun");
    email = {
      subject: `[Snorkl] Account Requests — ${newRequests.length} new, ${selected.length} awaiting confirmation`,
      body: lines.join("\n"),
    };
  } else if (options.batch) {
    email = buildBatchEmail(newRequests.map((r) => ({
      ...generateAccountEmail(r), requestId: r.id, needsInvoice: Boolean(r.needsInvoice), confirmLine: linkLine(r),
    })), all.reduce((sum, r) => sum + countProcessingEmails(r.emails), 0));
  } else {
    const r = newRequests[0];
    const generated = generateAccountEmail(r);
    email = { subject: generated.subject, body: `${generated.body}\n\n${linkLine(r)}` };
  }
  return { ...email, newCount: newRequests.length, pendingCount: selected.length };
}

function countProcessingEmails(raw: string | string[]) {
  return new Set((Array.isArray(raw) ? raw.join(",") : raw).split(/[,;\n]+/)
    .map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))).size;
}

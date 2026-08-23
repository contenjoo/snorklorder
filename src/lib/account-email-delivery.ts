export const ACCOUNT_EMAIL_SEND_MODES = ["send_all", "invoice_only"] as const;
export type AccountEmailSendMode = (typeof ACCOUNT_EMAIL_SEND_MODES)[number];

export interface AccountEmailDeliveryRecord {
  status: string;
  needsInvoice: boolean;
  processingEmailSendStartedAt: Date | string | null;
  processingEmailSentAt: Date | string | null;
  invoiceEmailSendStartedAt: Date | string | null;
  invoiceEmailSentAt: Date | string | null;
}

export type AccountEmailDeliveryState =
  | "ready"
  | "processing_unknown"
  | "invoice_retry"
  | "invoice_unknown"
  | "legacy_complete"
  | "complete";

export function parseAccountEmailSendMode(value: unknown): AccountEmailSendMode | null {
  if (value === undefined) return "send_all";
  return ACCOUNT_EMAIL_SEND_MODES.includes(value as AccountEmailSendMode)
    ? value as AccountEmailSendMode
    : null;
}

export function isValidAccountEmailRequestId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Jon 발송 성공을 경계로 일반 발송과 인보이스 전용 재시도를 분리한다. */
export function getAccountEmailDeliveryState(
  record: AccountEmailDeliveryRecord,
): AccountEmailDeliveryState {
  if (!record.processingEmailSentAt) {
    if (record.processingEmailSendStartedAt) return "processing_unknown";
    // 0016 이전 행은 발송 타임스탬프가 없으므로 기존 업무 상태로 중복 발송을 차단한다.
    return record.status === "draft" ? "ready" : "legacy_complete";
  }
  if (record.needsInvoice && !record.invoiceEmailSentAt) {
    return record.invoiceEmailSendStartedAt ? "invoice_unknown" : "invoice_retry";
  }
  return "complete";
}

/** SMTP 원문 대신 운영 UI와 DB에 남겨도 안전한 고정 오류만 사용한다. */
export function invoiceDeliveryFailureMessage(): string {
  return "Cailie invoice email delivery failed";
}

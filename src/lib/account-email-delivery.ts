export const ACCOUNT_EMAIL_SEND_MODES = ["send_all", "invoice_only"] as const;
export type AccountEmailSendMode = (typeof ACCOUNT_EMAIL_SEND_MODES)[number];

export interface AccountEmailDeliveryRecord {
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
  | "complete";

export function parseAccountEmailSendMode(value: unknown): AccountEmailSendMode | null {
  if (value === undefined) return "send_all";
  return ACCOUNT_EMAIL_SEND_MODES.includes(value as AccountEmailSendMode)
    ? value as AccountEmailSendMode
    : null;
}

/** Jon 발송 성공을 경계로 일반 발송과 인보이스 전용 재시도를 분리한다. */
export function getAccountEmailDeliveryState(
  record: AccountEmailDeliveryRecord,
): AccountEmailDeliveryState {
  if (!record.processingEmailSentAt) {
    return record.processingEmailSendStartedAt ? "processing_unknown" : "ready";
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

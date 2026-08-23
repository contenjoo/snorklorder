export type StripeMessageType = "invoice" | "receipt";

interface StripeMessageClaimRecord {
  status: string;
  invoiceGmailMessageId: string | null;
  receiptGmailMessageId: string | null;
}

/** invoice와 receipt는 별도 메시지 원장을 사용하므로 같은 Gmail thread도 순서대로 처리할 수 있다. */
export function isStripeMessageAlreadyClaimed(
  type: StripeMessageType,
  messageId: string,
  records: StripeMessageClaimRecord[],
): boolean {
  const field = type === "invoice" ? "invoiceGmailMessageId" : "receiptGmailMessageId";
  return records.some((record) => record[field] === messageId);
}

export function isStripeClaimableStatus(type: StripeMessageType, status: string): boolean {
  return type === "invoice"
    ? status === "sent" || status === "processed"
    : status === "invoiced";
}

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

/** Neon/Drizzle가 unique 오류를 직접 또는 cause로 감싸는 두 형태를 모두 처리한다. */
export function isUniqueConstraintViolation(error: unknown): boolean {
  if (readErrorCode(error) === "23505") return true;
  if (!error || typeof error !== "object" || !("cause" in error)) return false;
  return readErrorCode(error.cause) === "23505";
}

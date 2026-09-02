export type MarketPartnerNotificationAction =
  | { action: "preview"; requestId: string; itemIds: string[] }
  | { action: "send"; requestId: string; itemIds: string[]; operationId: string }
  | { action: "status"; operationId: string }
  | { action: "review"; operationId: string; outcome: "sent" | "not_sent"; note: string };

export interface MarketPartnerNotificationResponse {
  success?: boolean;
  duplicate?: boolean;
  operationId?: string;
  status?: "pending" | "sent" | "unknown" | "failed";
  recipientEmail?: string;
  schoolName?: string;
  teacherNames?: string[];
  sentAt?: string | null;
  requiresManualReview?: boolean;
  retryAllowed?: boolean;
  privacy?: "teacher_names_only";
  error?: string | null;
}

function getConfig() {
  const baseUrl = process.env.MARKET_CALLBACK_URL?.trim().replace(/\/+$/, "");
  const secret = process.env.PARTNER_APPROVAL_CALLBACK_SECRET?.trim();
  return baseUrl && secret ? { baseUrl, secret } : null;
}

export async function callMarketPartnerNotification(
  payload: MarketPartnerNotificationAction,
): Promise<{ response: Response; body: MarketPartnerNotificationResponse }> {
  const config = getConfig();
  if (!config) {
    return {
      response: new Response(null, { status: 503 }),
      body: { error: "Market callback is not configured" },
    };
  }
  const response = await fetch(`${config.baseUrl}/api/internal/partner-product-notifications`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-callback-secret": config.secret,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({ error: "Invalid Market response" })) as MarketPartnerNotificationResponse;
  return { response, body };
}

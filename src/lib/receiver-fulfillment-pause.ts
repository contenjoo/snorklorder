const PAUSED_VALUES = new Set(["1", "true", "yes"]);

export const RECEIVER_FULFILLMENT_PAUSED_CODE = "RECEIVER_FULFILLMENT_PAUSED";

export function isReceiverFulfillmentPaused(
  value: string | undefined = process.env.RECEIVER_FULFILLMENT_PAUSED,
): boolean {
  return typeof value === "string" && PAUSED_VALUES.has(value.trim().toLowerCase());
}

/**
 * 배포 중 Market 취소 fence와 수신부 공급 writer가 엇갈리지 않도록
 * 외부 메일·업그레이드 side effect를 명시적으로 중단한다.
 */
export function getReceiverFulfillmentPausedResponse(
  value: string | undefined = process.env.RECEIVER_FULFILLMENT_PAUSED,
): Response | null {
  if (!isReceiverFulfillmentPaused(value)) return null;

  return Response.json({
    code: RECEIVER_FULFILLMENT_PAUSED_CODE,
    error: "Receiver fulfillment is temporarily paused. Retry after deployment completes.",
    retryable: true,
  }, {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": "60",
    },
  });
}

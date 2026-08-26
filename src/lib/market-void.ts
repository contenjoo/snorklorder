export const MARKET_VOID_PHASES = ["prepare", "commit", "abort"] as const;
export const MARKET_VOID_REASON_CODE = "PAYMENT_CANCELLED" as const;
export const MARKET_VOID_MAX_REQUESTS = 100;

const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

export type MarketVoidPhase = (typeof MARKET_VOID_PHASES)[number];

export interface MarketVoidRequestIdentity {
  marketRequestId: string;
  idempotencyKey: string;
  externalRequestId?: string;
}

export interface MarketVoidInput {
  phase: MarketVoidPhase;
  operationId: string;
  marketOrderId: string;
  orderNumber: string;
  reasonCode: typeof MARKET_VOID_REASON_CODE;
  requests: MarketVoidRequestIdentity[];
  expectedVersion?: number;
}

export type MarketVoidValidationResult =
  | { ok: true; value: MarketVoidInput }
  | { ok: false; error: string };

function readReference(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return REFERENCE_PATTERN.test(normalized) ? normalized : null;
}

/** Market 취소 API는 로그·DB에 자유 입력 사유나 개인정보를 남기지 않는 strict 계약만 받는다. */
export function validateMarketVoidInput(value: unknown): MarketVoidValidationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "JSON object body is required" };
  }

  const input = value as Record<string, unknown>;
  const phase = typeof input.phase === "string" && MARKET_VOID_PHASES.includes(input.phase as MarketVoidPhase)
    ? input.phase as MarketVoidPhase
    : null;
  const operationId = readReference(input.operationId);
  const marketOrderId = readReference(input.marketOrderId);
  const orderNumber = readReference(input.orderNumber);

  if (!phase || !operationId || !marketOrderId || !orderNumber) {
    return {
      ok: false,
      error: "phase, operationId, marketOrderId and orderNumber are required",
    };
  }
  if (input.reasonCode !== MARKET_VOID_REASON_CODE) {
    return { ok: false, error: `reasonCode must be ${MARKET_VOID_REASON_CODE}` };
  }
  // 로컬 outbox 생성 전 취소도 빈 배열로 order fence를 먼저 세워 late create를 막는다.
  if (!Array.isArray(input.requests)) {
    return { ok: false, error: "requests must be an array" };
  }
  if (input.requests.length > MARKET_VOID_MAX_REQUESTS) {
    return { ok: false, error: `requests can contain up to ${MARKET_VOID_MAX_REQUESTS} items` };
  }

  const requests: MarketVoidRequestIdentity[] = [];
  const marketRequestIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  for (const item of input.requests) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: "Each request identity must be an object" };
    }
    const request = item as Record<string, unknown>;
    const marketRequestId = readReference(request.marketRequestId);
    const idempotencyKey = readReference(request.idempotencyKey);
    const externalRequestId = request.externalRequestId === undefined
      ? undefined
      : readReference(request.externalRequestId);
    if (!marketRequestId || !idempotencyKey || (request.externalRequestId !== undefined && !externalRequestId)) {
      return {
        ok: false,
        error: "Each request requires valid marketRequestId and idempotencyKey; externalRequestId is optional",
      };
    }
    if (marketRequestIds.has(marketRequestId) || idempotencyKeys.has(idempotencyKey)) {
      return { ok: false, error: "Duplicate request identity" };
    }
    marketRequestIds.add(marketRequestId);
    idempotencyKeys.add(idempotencyKey);
    requests.push({
      marketRequestId,
      idempotencyKey,
      ...(externalRequestId ? { externalRequestId } : {}),
    });
  }

  const expectedVersion = input.expectedVersion;
  if (phase === "prepare") {
    if (expectedVersion !== undefined) {
      return { ok: false, error: "expectedVersion is not allowed for prepare" };
    }
  } else if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 0) {
    return { ok: false, error: "expectedVersion must be a non-negative integer for commit or abort" };
  }

  // DB fingerprint가 재시도마다 같도록 배열 순서를 정규화한다.
  requests.sort((left, right) => left.marketRequestId.localeCompare(right.marketRequestId));

  return {
    ok: true,
    value: {
      phase,
      operationId,
      marketOrderId,
      orderNumber,
      reasonCode: MARKET_VOID_REASON_CODE,
      requests,
      ...(phase === "prepare" ? {} : { expectedVersion: Number(expectedVersion) }),
    },
  };
}

export interface MarketVoidDbResult {
  ok: boolean;
  code?: string;
  state?: "active" | "non_voidable" | "prepared" | "voided";
  version?: number;
  idempotent?: boolean;
  abortCompleted?: boolean;
  requests?: Array<{
    marketRequestId: string | null;
    externalRequestId: string;
    state: string;
  }>;
}

export function marketVoidErrorMessage(code: string | undefined): string {
  switch (code) {
    case "MARKET_VOID_NOT_PREPARABLE":
      return "A Snorkl request has already entered fulfillment and cannot be voided automatically.";
    case "MARKET_VOID_LEGACY_ORDER_MATCH":
      return "A legacy Snorkl request matches this order number. Manual audit is required before cancellation.";
    case "MARKET_VOID_IDENTITY_CONFLICT":
      return "Market request identity does not match the stored Snorkl request.";
    case "MARKET_VOID_OPERATION_CONFLICT":
      return "Another cancellation operation already owns this order fence.";
    case "MARKET_VOID_OPERATION_ABORTED":
      return "This cancellation operation was already aborted and cannot be prepared again.";
    case "MARKET_VOID_VERSION_CONFLICT":
    case "MARKET_VOID_CONCURRENT_CONFLICT":
      return "The cancellation fence changed concurrently. Read the latest state before retrying.";
    case "MARKET_VOID_ALREADY_COMMITTED":
      return "A committed void cannot be aborted.";
    default:
      return "The Market void transition was rejected.";
  }
}

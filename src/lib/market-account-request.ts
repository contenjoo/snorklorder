import { createHash } from "node:crypto";

export const MARKET_EXTERNAL_SOURCE = "market" as const;
export const MARKET_DRAFT_DELIVERY_MODE = "manual_only" as const;
export const MARKET_MAX_QUANTITY = 1000;

const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const MARKET_IDENTITY_FIELDS = [
  "externalSource",
  "marketRequestId",
  "marketOrderId",
  "orderNumber",
  "idempotencyKey",
  "draftOnly",
] as const;

interface MarketEnvelopeInput {
  externalSource?: unknown;
  marketRequestId?: unknown;
  marketOrderId?: unknown;
  orderNumber?: unknown;
  idempotencyKey?: unknown;
  draftOnly?: unknown;
  status?: unknown;
}

export interface MarketEnvelope {
  externalSource: typeof MARKET_EXTERNAL_SOURCE;
  marketRequestId: string;
  marketOrderId: string;
  orderNumber: string;
  idempotencyKey: string;
  draftOnly: true;
  status: "draft";
}

export type MarketEnvelopeResult =
  | { ok: true; value: MarketEnvelope }
  | { ok: false; error: string };

export type MarketQuantityResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

/** Market 카탈로그 계약과 동일하게 1~1000개의 정수만 받는다. */
export function validateMarketQuantity(value: unknown): MarketQuantityResult {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MARKET_MAX_QUANTITY) {
    return {
      ok: false,
      error: `Invalid quantity: must be a positive integer between 1 and ${MARKET_MAX_QUANTITY}`,
    };
  }
  return { ok: true, value: quantity };
}

/** 신규 식별자가 하나라도 오면 전체 strict 계약으로 처리해 부분 업그레이드를 막는다. */
export function containsMarketIdentity(input: Record<string, unknown>): boolean {
  return MARKET_IDENTITY_FIELDS.some((field) => input[field] !== undefined);
}

/** 2단계 배포 중 기존 market 호출은 초안 상태만 임시 허용한다. */
export function validateLegacyMarketDraft(input: { status?: unknown }): MarketEnvelopeResult | { ok: true } {
  if (input.status !== undefined && input.status !== "draft") {
    return { ok: false, error: "status must be draft" };
  }
  return { ok: true };
}

function readReference(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return REFERENCE_PATTERN.test(normalized) ? normalized : null;
}

/**
 * 외부 API 키 수신은 market의 초안 생성 계약만 허용한다.
 * 상태를 강제로 덮어써서 숨기지 않고 잘못된 계약은 명시적으로 거절한다.
 */
export function validateMarketEnvelope(input: MarketEnvelopeInput): MarketEnvelopeResult {
  if (input.externalSource !== MARKET_EXTERNAL_SOURCE) {
    return { ok: false, error: "externalSource must be market" };
  }
  if (input.draftOnly !== true) {
    return { ok: false, error: "draftOnly must be true" };
  }
  if (input.status !== undefined && input.status !== "draft") {
    return { ok: false, error: "status must be draft" };
  }

  const marketRequestId = readReference(input.marketRequestId);
  const marketOrderId = readReference(input.marketOrderId);
  const orderNumber = readReference(input.orderNumber);
  const idempotencyKey = readReference(input.idempotencyKey);
  if (!marketRequestId || !marketOrderId || !orderNumber || !idempotencyKey) {
    return {
      ok: false,
      error: "marketRequestId, marketOrderId, orderNumber and idempotencyKey are required",
    };
  }

  return {
    ok: true,
    value: {
      externalSource: MARKET_EXTERNAL_SOURCE,
      marketRequestId,
      marketOrderId,
      orderNumber,
      idempotencyKey,
      draftOnly: true,
      status: "draft",
    },
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, entryValue]) => [key, canonicalize(entryValue)]));
  }
  return value;
}

/** 개인정보 원문을 멱등 비교에 남기지 않도록 정규화 payload의 SHA-256만 저장한다. */
export function hashMarketPayload(payload: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");
}

export function classifyMarketReplay(
  storedPayloadHash: string | null,
  incomingPayloadHash: string,
): "duplicate" | "conflict" {
  return storedPayloadHash === incomingPayloadHash ? "duplicate" : "conflict";
}

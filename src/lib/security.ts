import { NextRequest, NextResponse } from "next/server";

interface RateLimitOptions {
  request: Request | NextRequest;
  key: string;
  limit: number;
  windowMs: number;
}

interface RateLimitResult {
  ok: boolean;
  retryAfter: number;
}

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5000;

function getClientFingerprint(request: Request | NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";
  return `${ip}:${userAgent.slice(0, 120)}`;
}

function cleanupBuckets(now: number) {
  for (const [key, bucket] of Array.from(buckets.entries())) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }

  if (buckets.size <= MAX_BUCKETS) return;

  const entries = Array.from(buckets.entries()).sort((a, b) => a[1].resetAt - b[1].resetAt);
  for (const [key] of entries.slice(0, buckets.size - MAX_BUCKETS)) {
    buckets.delete(key);
  }
}

export function checkRateLimit(options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  cleanupBuckets(now);

  const bucketKey = `${options.key}:${getClientFingerprint(options.request)}`;
  const current = buckets.get(bucketKey);

  if (!current || current.resetAt <= now) {
    buckets.set(bucketKey, {
      count: 1,
      resetAt: now + options.windowMs,
    });
    return { ok: true, retryAfter: 0 };
  }

  if (current.count >= options.limit) {
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  buckets.set(bucketKey, current);
  return { ok: true, retryAfter: 0 };
}

export function createRateLimitResponse(message = "Too many requests. Please try again later.", retryAfter = 60) {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
      },
    }
  );
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeText(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength);
}

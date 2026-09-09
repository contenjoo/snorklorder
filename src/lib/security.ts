import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { sql } from "drizzle-orm";

interface RateLimitOptions {
 request: Request | NextRequest; key: string; limit: number; windowMs: number;
 subject?: string;
}
export function clientIp(request: Request) {
 // Vercel overwrites this header at its trusted ingress. Never trust a caller's generic forwarded-for.
 if (process.env.VERCEL === "1") return request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || "unknown";
 return "local";
}
export async function checkRateLimit(options: RateLimitOptions): Promise<{ok:boolean; retryAfter:number}> {
 const identity = options.subject ?? clientIp(options.request);
 const key = createHash("sha256").update(`${options.key}:${identity}`).digest("hex");
 try {
  const result = await db.execute(sql`
   INSERT INTO security_rate_limits(key,count,reset_at)
   VALUES(${key},1,now()+${options.windowMs}*interval '1 millisecond')
   ON CONFLICT(key) DO UPDATE SET
    count=CASE WHEN security_rate_limits.reset_at<=now() THEN 1 ELSE security_rate_limits.count+1 END,
    reset_at=CASE WHEN security_rate_limits.reset_at<=now() THEN excluded.reset_at ELSE security_rate_limits.reset_at END
   RETURNING count, greatest(1,ceil(extract(epoch FROM reset_at-now()))) AS retry_after`);
  const row = result.rows[0];
  return {ok:Number(row.count)<=options.limit,retryAfter:Number(row.retry_after)};
 } catch (error) {
  console.error("[rate-limit] unavailable", error);
  return {ok:false,retryAfter:-1};
 }
}
export function createRateLimitResponse(message="Too many requests. Please try again later.", retryAfter=60) {
 return NextResponse.json({error:retryAfter<0?"Service temporarily unavailable":message}, {
  status:retryAfter<0?503:429,headers:{"Retry-After":String(retryAfter<0?60:retryAfter)},
 });
}
export async function checkEmailSendLimit(request: Request, email: string) {
 for (const rule of [{key:"email-minute",limit:1,windowMs:60000},{key:"email-hour",limit:5,windowMs:3600000}]) {
  const result=await checkRateLimit({request,subject:email.trim().toLowerCase(),...rule});
  if(!result.ok) return createRateLimitResponse("Please wait before requesting another email.",result.retryAfter);
 }
 return null;
}
export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * 콤마/세미콜론/줄바꿈으로 구분된 이메일 문자열 → 정규화된 유효 이메일 목록.
 * trim + 소문자화 + 형식 검증 + 중복 제거(입력 순서 유지).
 */
export function parseEmailList(raw: string): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[,;\n]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e && isValidEmail(e))
    ),
  ];
}

export function normalizeText(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength);
}

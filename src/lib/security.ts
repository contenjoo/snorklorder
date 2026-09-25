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

/**
 * Normalises a rate-limit identity so IPv6 rotation within a single /64 can't bypass per-IP
 * limits: IPv4 addresses (and IPv4-mapped ::ffff:a.b.c.d) are left as their IPv4 form, IPv6
 * addresses are truncated to their /64 prefix. Non-IP values (e.g. "unknown", "local") pass
 * through unchanged.
 */
export function normalizeIpForRateLimit(ip: string): string {
 if (!ip) return ip;
 const trimmed = ip.trim();
 if (!trimmed.includes(":")) return trimmed; // IPv4 or opaque token (e.g. "unknown", "local")

 // IPv4-mapped IPv6, e.g. ::ffff:192.168.1.1
 const mapped = trimmed.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
 if (mapped) return mapped[1];

 // Expand '::' compression to 8 groups so we can safely take the first 4 (the /64 prefix).
 const [head, tail] = trimmed.split("::");
 const headGroups = head ? head.split(":").filter(Boolean) : [];
 const tailGroups = tail ? tail.split(":").filter(Boolean) : [];
 let groups: string[];
 if (trimmed.includes("::")) {
  const missing = 8 - headGroups.length - tailGroups.length;
  groups = [...headGroups, ...Array(Math.max(missing, 0)).fill("0"), ...tailGroups];
 } else {
  groups = trimmed.split(":");
 }
 const prefix = groups.slice(0, 4).map((g) => g || "0");
 return prefix.join(":") + "::/64";
}

export async function checkRateLimit(options: RateLimitOptions): Promise<{ok:boolean; retryAfter:number}> {
 const identity = options.subject ?? normalizeIpForRateLimit(clientIp(options.request));
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
 const normalizedEmail = email.trim().toLowerCase();
 const ipBucket = normalizeIpForRateLimit(clientIp(request));
 // Strict buckets are keyed on email+IP so one attacker can't spend a victim's whole budget by
 // hammering their address from a single IP. A looser per-address ceiling (any IP) still caps
 // total mail sent to one address.
 for (const rule of [
  {key:"email-minute",limit:1,windowMs:60000,subject:`${normalizedEmail}|${ipBucket}`},
  {key:"email-hour",limit:5,windowMs:3600000,subject:`${normalizedEmail}|${ipBucket}`},
  {key:"email-hour-address",limit:20,windowMs:3600000,subject:normalizedEmail},
 ]) {
  const result=await checkRateLimit({request,...rule});
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

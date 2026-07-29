import { cookies } from "next/headers";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { schoolLoginTokens } from "@/db/schema";

const SCHOOL_COOKIE_NAME = "snorkl-school-auth";
const LOGIN_TOKEN_TTL_MS = 1000 * 60 * 30; // 매직링크 30분
const SESSION_MAX_AGE = 60 * 60 * 24 * 14; // 세션 14일

function secret(): string {
  return (
    process.env.SCHOOL_SESSION_SECRET ||
    process.env.ADMIN_PASSWORD ||
    "dev-insecure-secret"
  );
}

/** schoolId 를 HMAC 서명한 쿠키 값으로 인코딩 */
function signSchoolSession(schoolId: number): string {
  const payload = String(schoolId);
  const sig = createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/** 쿠키 값 검증 → schoolId | null */
function verifySchoolSession(value: string | undefined | null): number | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(payload).digest("hex");
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  const id = Number(payload);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** 현재 요청의 학교 세션 schoolId 조회 */
export async function getSchoolSession(): Promise<number | null> {
  const store = await cookies();
  return verifySchoolSession(store.get(SCHOOL_COOKIE_NAME)?.value);
}

export async function setSchoolSession(schoolId: number): Promise<void> {
  const store = await cookies();
  store.set(SCHOOL_COOKIE_NAME, signSchoolSession(schoolId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSchoolSession(): Promise<void> {
  const store = await cookies();
  store.delete(SCHOOL_COOKIE_NAME);
}

/** 매직링크 로그인 토큰 발급 */
export async function createSchoolLoginToken(email: string, schoolId: number): Promise<string> {
  const token = randomBytes(24).toString("hex");
  await db.insert(schoolLoginTokens).values({
    email: email.trim().toLowerCase(),
    schoolId,
    token,
    expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS),
  });
  return token;
}

/** 매직링크 토큰 소비(1회용) → {schoolId, email} | null */
export async function consumeSchoolLoginToken(
  token: string
): Promise<{ schoolId: number; email: string } | null> {
  const [row] = await db
    .select()
    .from(schoolLoginTokens)
    .where(eq(schoolLoginTokens.token, token));
  if (!row) return null;
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  await db
    .update(schoolLoginTokens)
    .set({ usedAt: new Date() })
    .where(eq(schoolLoginTokens.id, row.id));
  return { schoolId: row.schoolId, email: row.email };
}

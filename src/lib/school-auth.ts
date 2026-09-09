import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "@/db";
import { schoolLoginTokens } from "@/db/schema";

const SCHOOL_COOKIE_NAME = "snorkl-school-auth";
const LOGIN_TOKEN_TTL_MS = 1000 * 60 * 30; // 매직링크 30분
import { signSchoolSession, verifySchoolSession, SCHOOL_SESSION_MAX_AGE as SESSION_MAX_AGE } from "@/lib/school-session";

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
export async function createSchoolLoginToken(email: string, schoolId: number, browserHash: string): Promise<string> {
  const token = randomBytes(24).toString("hex");
  await db.insert(schoolLoginTokens).values({
    browserHash,
    email: email.trim().toLowerCase(),
    schoolId,
    token,
    expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS),
  });
  return token;
}

/** 매직링크 토큰 소비(1회용) → {schoolId, email} | null */
export async function consumeSchoolLoginToken(
  token: string, browserHash: string
): Promise<{ schoolId: number; email: string } | null> {
  const [row] = await db.update(schoolLoginTokens).set({usedAt:new Date()})
    .where(and(eq(schoolLoginTokens.token,token),eq(schoolLoginTokens.browserHash,browserHash),isNull(schoolLoginTokens.usedAt),gt(schoolLoginTokens.expiresAt,new Date())))
    .returning({schoolId:schoolLoginTokens.schoolId,email:schoolLoginTokens.email});
  return row ?? null;
}

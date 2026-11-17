import { createHash, createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { schoolStoreInputLinks } from "@/db/schema";
import { readSchoolStoreLink } from "./school-store-link";

const SHORT_CODE = /^[A-Za-z0-9_-]{22}$/;

function codeHash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function shortCodeForToken(signedToken: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`school-store-short:${signedToken}`)
    .digest("base64url")
    .slice(0, 22);
}

/** Keep the signed payload, identifier and expiry unchanged across retries. */
export async function shortenSchoolStoreLink(
  signedToken: string,
  secret: string,
  now = Date.now(),
): Promise<{ code: string; expiresAt: number }> {
  const payload = readSchoolStoreLink(signedToken, secret, now);
  if (!payload) throw new Error("유효한 학교장터 입력 링크를 확인해 주세요.");

  const code = shortCodeForToken(signedToken, secret);
  const hash = codeHash(code);
  await db.insert(schoolStoreInputLinks).values({
    codeHash: hash,
    signedToken,
    expiresAt: new Date(payload.expiresAt),
  }).onConflictDoNothing({ target: schoolStoreInputLinks.codeHash });

  const [stored] = await db.select({
    signedToken: schoolStoreInputLinks.signedToken,
    expiresAt: schoolStoreInputLinks.expiresAt,
  }).from(schoolStoreInputLinks).where(eq(schoolStoreInputLinks.codeHash, hash)).limit(1);
  if (!stored || stored.signedToken !== signedToken || stored.expiresAt.getTime() !== payload.expiresAt) {
    throw new Error("학교장터 입력 링크를 저장하지 못했습니다.");
  }
  return { code, expiresAt: payload.expiresAt };
}

/** Legacy signed URLs remain self-contained; only short codes need a lookup. */
export async function resolveSchoolStoreInputLink(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<ReturnType<typeof readSchoolStoreLink>> {
  if (!secret.trim()) return null;
  if (token.includes(".")) return readSchoolStoreLink(token, secret, now);
  if (!SHORT_CODE.test(token)) return null;

  const [stored] = await db.select({
    signedToken: schoolStoreInputLinks.signedToken,
    expiresAt: schoolStoreInputLinks.expiresAt,
  }).from(schoolStoreInputLinks).where(eq(schoolStoreInputLinks.codeHash, codeHash(token))).limit(1);
  if (!stored || !(stored.expiresAt.getTime() > now)) return null;
  if (shortCodeForToken(stored.signedToken, secret) !== token) return null;
  return readSchoolStoreLink(stored.signedToken, secret, now);
}

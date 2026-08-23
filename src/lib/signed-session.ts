export type SessionPartnerRole = "jon" | "jeff" | "cailie";

export const ADMIN_SESSION_COOKIE_NAME = "snorkl-admin-auth";
export const PARTNER_SESSION_COOKIE_NAME = "snorkl-partner-auth";
export const ADMIN_SESSION_MAX_AGE = 60 * 60 * 24 * 30;
export const PARTNER_SESSION_MAX_AGE = 60 * 60 * 24 * 90;

const TOKEN_VERSION = 1;
const encoder = new TextEncoder();

type SessionPurpose = "admin" | "partner";

interface SessionPayload {
  v: typeof TOKEN_VERSION;
  purpose: SessionPurpose;
  role?: SessionPartnerRole;
  exp: number;
  nonce: string;
}

function getSessionSecret(): string | null {
  for (const value of [
    process.env.ADMIN_SESSION_SECRET,
    process.env.SCHOOL_SESSION_SECRET,
    process.env.ADMIN_PASSWORD,
  ]) {
    const secret = value?.trim();
    if (secret) return secret;
  }
  return null;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const paddingLength = (4 - (value.length % 4)) % 4;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(paddingLength));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function createNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function signPayload(payload: SessionPayload, secret: string): Promise<string> {
  const encodedPayload = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret);
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(encodedPayload));
  return `${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function createSessionToken(
  purpose: SessionPurpose,
  maxAgeSeconds: number,
  role?: SessionPartnerRole,
  nowMs = Date.now(),
): Promise<string | null> {
  const secret = getSessionSecret();
  if (!secret) return null;
  return signPayload({
    v: TOKEN_VERSION,
    purpose,
    ...(role ? { role } : {}),
    exp: Math.floor(nowMs / 1000) + maxAgeSeconds,
    nonce: createNonce(),
  }, secret);
}

async function readVerifiedPayload(token: string | null | undefined, nowMs = Date.now()): Promise<SessionPayload | null> {
  const secret = getSessionSecret();
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, encodedSignature] = parts;
  const signature = base64UrlToBytes(encodedSignature);
  const payloadBytes = base64UrlToBytes(encodedPayload);
  if (!signature || !payloadBytes) return null;

  try {
    const key = await importHmacKey(secret);
    const validSignature = await globalThis.crypto.subtle.verify(
      "HMAC",
      key,
      new Uint8Array(signature).buffer,
      encoder.encode(encodedPayload),
    );
    if (!validSignature) return null;

    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<SessionPayload>;
    if (
      parsed.v !== TOKEN_VERSION
      || (parsed.purpose !== "admin" && parsed.purpose !== "partner")
      || typeof parsed.exp !== "number"
      || !Number.isInteger(parsed.exp)
      || typeof parsed.nonce !== "string"
      || !/^[A-Za-z0-9_-]{20,}$/.test(parsed.nonce)
      || parsed.exp <= Math.floor(nowMs / 1000)
    ) {
      return null;
    }
    return parsed as SessionPayload;
  } catch {
    return null;
  }
}

export function createAdminSessionToken(nowMs = Date.now()): Promise<string | null> {
  return createSessionToken("admin", ADMIN_SESSION_MAX_AGE, undefined, nowMs);
}

export function createPartnerSessionToken(role: SessionPartnerRole, nowMs = Date.now()): Promise<string | null> {
  return createSessionToken("partner", PARTNER_SESSION_MAX_AGE, role, nowMs);
}

export async function verifyAdminSessionToken(
  token: string | null | undefined,
  nowMs = Date.now(),
): Promise<boolean> {
  const payload = await readVerifiedPayload(token, nowMs);
  return payload?.purpose === "admin" && payload.role === undefined;
}

export async function verifyPartnerSessionToken(
  token: string | null | undefined,
  nowMs = Date.now(),
): Promise<SessionPartnerRole | null> {
  const payload = await readVerifiedPayload(token, nowMs);
  return payload?.purpose === "partner" && ["jon", "jeff", "cailie"].includes(payload.role || "")
    ? payload.role as SessionPartnerRole
    : null;
}

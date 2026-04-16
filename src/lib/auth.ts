import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE_NAME = "snorkl-admin-auth";
const PARTNER_COOKIE_NAME = "snorkl-partner-auth"; // value = "jon" | "jeff"

const DEFAULT_ADMIN_PASSWORD_HASH =
  "ee80ee848a55ef45f8677a1bca2ef5217c4113e2257e6d16a286fdba067be7d5";

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function getAdminPassword() {
  const password = process.env.ADMIN_PASSWORD?.trim();
  return password && password.length > 0 ? password : null;
}

function getJonPassword() {
  const password = process.env.JON_PASSWORD?.trim();
  return password && password.length > 0 ? password : null;
}

function getJeffPassword() {
  const password = process.env.JEFF_PASSWORD?.trim();
  return password && password.length > 0 ? password : null;
}

/** Returns "jon" | "jeff" | null */
export function verifyPartnerPassword(password: string): string | null {
  const trimmed = password.trim();
  const jonPw = getJonPassword();
  if (jonPw && trimmed === jonPw) return "jon";
  const jeffPw = getJeffPassword();
  if (jeffPw && trimmed === jeffPw) return "jeff";
  return null;
}

export async function checkAuth(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value === "authenticated";
}

export function isAdminPasswordConfigured(): boolean {
  return getAdminPassword() !== null || DEFAULT_ADMIN_PASSWORD_HASH.length > 0;
}

export function verifyPassword(password: string): boolean {
  const trimmed = password.trim();
  if (hashPassword(trimmed) === DEFAULT_ADMIN_PASSWORD_HASH) {
    return true;
  }
  const adminPassword = getAdminPassword();
  if (adminPassword) {
    return trimmed === adminPassword;
  }
  return false;
}

export { COOKIE_NAME, PARTNER_COOKIE_NAME };

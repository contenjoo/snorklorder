import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE_NAME,
  PARTNER_SESSION_COOKIE_NAME,
  verifyAdminSessionToken,
} from "@/lib/signed-session";

const COOKIE_NAME = ADMIN_SESSION_COOKIE_NAME;
const PARTNER_COOKIE_NAME = PARTNER_SESSION_COOKIE_NAME;

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

function getCailiePassword() {
  const password = process.env.CAILIE_PASSWORD?.trim();
  return password && password.length > 0 ? password : null;
}

/** Returns "jon" | "jeff" | "cailie" | null */
export function verifyPartnerPassword(password: string): string | null {
  const trimmed = password.trim();
  const jonPw = getJonPassword();
  if (jonPw && trimmed === jonPw) return "jon";
  const jeffPw = getJeffPassword();
  if (jeffPw && trimmed === jeffPw) return "jeff";
  const cailiePw = getCailiePassword();
  if (cailiePw && trimmed === cailiePw) return "cailie";
  return null;
}

export async function checkAuth(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifyAdminSessionToken(cookieStore.get(COOKIE_NAME)?.value);
}

export function isAdminPasswordConfigured(): boolean {
  return getAdminPassword() !== null;
}

export function verifyPassword(password: string): boolean {
  const adminPassword = getAdminPassword();
  if (!adminPassword) return false;
  return password.trim() === adminPassword;
}

export { COOKIE_NAME, PARTNER_COOKIE_NAME };

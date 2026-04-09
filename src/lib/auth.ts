import { cookies } from "next/headers";

const COOKIE_NAME = "snorkl-admin-auth";
const PARTNER_COOKIE_NAME = "snorkl-partner-auth"; // value = "jon" | "jeff"

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
  return getAdminPassword() !== null;
}

export function verifyPassword(password: string): boolean {
  const adminPassword = getAdminPassword();
  if (!adminPassword) return false;
  return password.trim() === adminPassword;
}

export { COOKIE_NAME, PARTNER_COOKIE_NAME };

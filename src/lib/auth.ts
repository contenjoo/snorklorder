import { cookies } from "next/headers";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "snorkl2026";
const COOKIE_NAME = "snorkl-admin-auth";

export async function checkAuth(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value === "authenticated";
}

export function verifyPassword(password: string): boolean {
  return password === ADMIN_PASSWORD;
}

export { COOKIE_NAME };

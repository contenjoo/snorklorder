export const CONFIRM_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export function confirmationExpiry() { return new Date(Date.now() + CONFIRM_TOKEN_TTL_MS); }
export function confirmationExpired(row: { tokenExpiresAt: Date | null }) {
  return !row.tokenExpiresAt || row.tokenExpiresAt.getTime() <= Date.now();
}

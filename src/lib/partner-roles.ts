// 파트너 포털 역할 SSOT — proxy(미들웨어)에서도 import하므로 순수 상수만 둘 것
export const PARTNER_ROLES = ["jon", "jeff", "cailie"] as const;
export type PartnerRole = (typeof PARTNER_ROLES)[number];

/** 업그레이드 확정 권한 (Cailie가 담당, Jon도 유지) */
export const PARTNER_UPGRADE_ROLES: readonly PartnerRole[] = ["jon", "cailie"];

export function isPartnerRole(value: string | undefined | null): value is PartnerRole {
  return !!value && (PARTNER_ROLES as readonly string[]).includes(value);
}

export function canConfirmUpgrades(value: string | undefined | null): boolean {
  return !!value && (PARTNER_UPGRADE_ROLES as readonly string[]).includes(value);
}

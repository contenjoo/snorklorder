import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type SchoolStoreLinkConfig = {
  schoolName: string;
  quantity: number;
  accountType: "teacher" | "student" | "school";
  type: "upgrade" | "extension";
  termYears: number;
  extensionDate: string | null;
};
type LinkPayload = SchoolStoreLinkConfig & { purpose: "school-store-input"; version: 1; id: string; expiresAt: number };
const LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export function parseSchoolStoreLinkConfig(value: unknown): SchoolStoreLinkConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("학교명과 구매 정보를 확인해 주세요.");
  const v = value as Record<string, unknown>;
  const schoolName = typeof v.schoolName === "string" ? v.schoolName.trim() : "";
  if (schoolName.length < 2 || schoolName.length > 100 || /[\r\n\x00-\x1f]/.test(schoolName)) throw new Error("학교명을 확인해 주세요.");
  if (!Number.isInteger(v.quantity) || Number(v.quantity) < 1 || Number(v.quantity) > 500) throw new Error("구매 수량은 1~500개로 입력해 주세요.");
  if (!["teacher", "student", "school"].includes(String(v.accountType))) throw new Error("계정 종류를 확인해 주세요.");
  if (v.accountType === "school" && v.quantity !== 1) throw new Error("학교 단체 이용권은 대표 계정 1개를 입력합니다.");
  if (v.type !== "upgrade" && v.type !== "extension") throw new Error("신청 유형을 확인해 주세요.");
  if (v.termYears !== 1 && v.termYears !== 2) throw new Error("이용 기간을 확인해 주세요.");
  const extensionDate = v.type === "extension" && typeof v.extensionDate === "string" ? v.extensionDate : null;
  if (v.type === "extension" && (!extensionDate || !/^\d{4}-\d{2}-\d{2}$/.test(extensionDate) || new Date(extensionDate).toISOString().slice(0, 10) !== extensionDate)) throw new Error("정확한 연장 종료일을 입력해 주세요.");
  return { schoolName, quantity: Number(v.quantity), accountType: v.accountType as SchoolStoreLinkConfig["accountType"], type: v.type, termYears: v.termYears, extensionDate };
}

function signature(encoded: string, secret: string) {
  return createHmac("sha256", secret).update(`school-store-input:${encoded}`).digest();
}
export function createSchoolStoreLink(config: SchoolStoreLinkConfig, secret: string, now = Date.now()) {
  if (!secret.trim()) throw new Error("링크 생성 설정을 확인해 주세요.");
  const payload: LinkPayload = { ...parseSchoolStoreLinkConfig(config), purpose: "school-store-input", version: 1, id: randomUUID(), expiresAt: now + LIFETIME_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${encoded}.${signature(encoded, secret).toString("base64url")}`, expiresAt: payload.expiresAt };
}
export function readSchoolStoreLink(token: string, secret: string, now = Date.now()): LinkPayload | null {
  if (!secret.trim() || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return null;
  try {
    const actual = Buffer.from(parts[1], "base64url"), expected = signature(parts[0], secret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const value = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (value.purpose !== "school-store-input" || value.version !== 1 || !/^[0-9a-f-]{36}$/.test(value.id) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now) return null;
    return { ...parseSchoolStoreLinkConfig(value), purpose: value.purpose, version: 1, id: value.id, expiresAt: value.expiresAt };
  } catch { return null; }
}
export function parseSchoolStoreEmails(value: unknown, quantity: number): string[] {
  if (typeof value !== "string" || value.length > 130000) throw new Error("이메일을 입력해 주세요.");
  const emails = value.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (emails.some((email) => email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error("이메일 주소를 확인해 주세요.");
  if (new Set(emails).size !== emails.length) throw new Error("같은 이메일을 중복 입력하셨습니다.");
  if (emails.length !== quantity) throw new Error(`구매 수량에 맞게 이메일 ${quantity}개를 입력해 주세요.`);
  return emails;
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * 콤마/세미콜론/줄바꿈으로 구분된 이메일 문자열 → 정규화된 유효 이메일 목록.
 * trim + 소문자화 + 형식 검증 + 중복 제거(입력 순서 유지).
 */
export function parseEmailList(raw: string): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[,;\n]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e && isValidEmail(e))
    ),
  ];
}

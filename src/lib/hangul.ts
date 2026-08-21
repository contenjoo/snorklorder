// 한글 초성 검색 유틸 — 커맨드 팔레트에서 "ㄱㅇㅈ" → "고양중" 매칭용.
const CHOSEONG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

/** 문자열의 한글 음절을 초성으로 치환 ("고양중" → "ㄱㅇㅈ"). 비한글 문자는 그대로 둔다. */
export function toChoseong(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      out += CHOSEONG[Math.floor((code - 0xac00) / 588)];
    } else {
      out += ch;
    }
  }
  return out;
}

/** 쿼리가 초성으로만 이루어졌는지 (초성 검색 모드 판별) */
export function isChoseongQuery(q: string): boolean {
  if (!q) return false;
  for (const ch of q) {
    if (!CHOSEONG.includes(ch) && ch !== " ") return false;
  }
  return true;
}

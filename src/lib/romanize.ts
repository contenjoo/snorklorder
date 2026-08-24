/**
 * 한글 학교명 → 영문 변환 폴백.
 *
 * Google 비공식 번역 endpoint(gtx)는 데이터센터 IP(Vercel 등)에서 429로 차단되는
 * 일이 잦아, 외부 의존 없이 동작하는 국어의 로마자 표기법(RR) 기반 변환을 둔다.
 * 학교명은 "고유명사 + 학교 종류 접미사" 구조가 규칙적이라
 * 접미사는 영어 대응어로, 나머지는 로마자 표기로 옮기면 실사용 표기와 거의 일치한다.
 * (예: 효명고등학교 → Hyomyeong High School)
 */

const CHO = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const JUNG = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const JONG = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];

/** 한글 음절을 로마자 표기법(자모 단위, 음운 동화 미적용)으로 변환. 비한글 문자는 그대로 둔다. */
export function romanizeHangul(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) {
      out += ch;
      continue;
    }
    const cho = Math.floor(code / 588);
    const jung = Math.floor((code % 588) / 28);
    const jong = code % 28;
    out += CHO[cho] + JUNG[jung] + JONG[jong];
  }
  return out;
}

// 긴 접미사 우선 매칭 (예: "여자고등학교"가 "고등학교"보다 먼저)
const SCHOOL_SUFFIXES: [string, string][] = [
  ["외국어고등학교", "Foreign Language High School"],
  ["과학고등학교", "Science High School"],
  ["예술고등학교", "Arts High School"],
  ["체육고등학교", "Sports High School"],
  ["여자고등학교", "Girls' High School"],
  ["남자고등학교", "Boys' High School"],
  ["여자중학교", "Girls' Middle School"],
  ["남자중학교", "Boys' Middle School"],
  ["고등학교", "High School"],
  ["중학교", "Middle School"],
  ["초등학교", "Elementary School"],
  ["국제학교", "International School"],
  ["사이버대학교", "Cyber University"],
  ["교육대학교", "University of Education"],
  ["여자대학교", "Women's University"],
  ["대학교", "University"],
  ["대학원", "Graduate School"],
  ["전문대학", "College"],
  ["대학", "College"],
  ["유치원", "Kindergarten"],
  ["어학원", "Language Academy"],
  ["학원", "Academy"],
  ["학교", "School"],
];

function capitalize(word: string): string {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

/** "효명고등학교" → "Hyomyeong High School". 접미사 없으면 전체 로마자 변환만. */
export function translateSchoolName(korean: string): string {
  const name = korean.trim();
  if (!name) return "";

  let stem = name;
  let suffixEn = "";
  for (const [ko, en] of SCHOOL_SUFFIXES) {
    if (stem.endsWith(ko)) {
      stem = stem.slice(0, -ko.length).trim();
      suffixEn = en;
      break;
    }
  }

  const romanized = stem
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => capitalize(romanizeHangul(w)))
    .join(" ");

  return [romanized, suffixEn].filter(Boolean).join(" ").trim();
}

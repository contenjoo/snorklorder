import assert from "node:assert/strict";
import test from "node:test";
import {
  isSuspiciousSchoolTranslation,
  translateKnownSchoolName,
  translateSchoolName,
} from "../src/lib/romanize.ts";

test("사범대학 부설 학교는 로마자 덩어리가 아니라 공식 영문명 계열로 변환한다", () => {
  assert.equal(
    translateKnownSchoolName("전남대학교사범대학부설고등학교"),
    "Chonnam National University High School",
  );
  assert.equal(
    translateSchoolName("전남대학교사범대학부설고등학교"),
    "Chonnam National University High School",
  );
});

test("Google 번역 결과가 학교명 로마자 덩어리면 의심 결과로 본다", () => {
  assert.equal(
    isSuspiciousSchoolTranslation("Jeonnamdaehakgyosabeomdaehakbuseol High School"),
    true,
  );
  assert.equal(isSuspiciousSchoolTranslation("Chonnam National University High School"), false);
});

test("기존 단순 학교명 폴백은 유지한다", () => {
  assert.equal(translateSchoolName("효명고등학교"), "Hyomyeong High School");
});

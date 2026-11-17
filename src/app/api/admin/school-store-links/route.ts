import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth";
import { createSchoolStoreLink, parseSchoolStoreLinkConfig, readSchoolStoreLink } from "@/lib/school-store-link";
import { shortenSchoolStoreLink } from "@/lib/school-store-short-link";

export async function POST(req: NextRequest) {
  if (!(await checkAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const secret = process.env.ADMIN_SESSION_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "링크 생성 설정을 확인해 주세요." }, { status: 503 });
  let token: string;
  try {
    const input = await req.json();
    if (input && typeof input === "object" && Object.hasOwn(input, "existingToken")) {
      if (typeof input.existingToken !== "string" || !readSchoolStoreLink(input.existingToken, secret)) {
        throw new Error("유효한 기존 학교장터 입력 링크를 확인해 주세요.");
      }
      token = input.existingToken;
    } else {
      token = createSchoolStoreLink(parseSchoolStoreLinkConfig(input), secret).token;
    }
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "입력 내용을 확인해 주세요." }, { status: 400 }); }
  try {
    const { code, expiresAt } = await shortenSchoolStoreLink(token, secret);
    const base = (process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin).replace(/\/$/, "");
    return NextResponse.json({ url: `${base}/s/${code}`, expiresAt }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[school-store-links] failed to create short link");
    return NextResponse.json({ error: "링크를 만들지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

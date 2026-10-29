import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth";
import { createSchoolStoreLink, parseSchoolStoreLinkConfig } from "@/lib/school-store-link";

export async function POST(req: NextRequest) {
  if (!(await checkAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const secret = process.env.ADMIN_SESSION_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "링크 생성 설정을 확인해 주세요." }, { status: 503 });
  let config;
  try { config = parseSchoolStoreLinkConfig(await req.json()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "입력 내용을 확인해 주세요." }, { status: 400 }); }
  const { token, expiresAt } = createSchoolStoreLink(config, secret);
  const base = process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin;
  return NextResponse.json({ url: `${base}/school-store/${token}`, expiresAt }, { headers: { "Cache-Control": "no-store" } });
}

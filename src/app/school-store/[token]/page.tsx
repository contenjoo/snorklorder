import type { Metadata } from "next";
import { readSchoolStoreLink } from "@/lib/school-store-link";
import SchoolStoreInput from "@/components/school-store-input";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Snorkl 계정 이메일 입력", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const config = readSchoolStoreLink(token, process.env.ADMIN_SESSION_SECRET || "");
  if (!config) return <main className="mx-auto max-w-lg p-8"><h1 className="text-xl font-bold">링크를 확인해 주세요</h1><p className="mt-4">유효하지 않거나 만료된 링크입니다. 담당자에게 새 링크를 요청해 주세요.</p></main>;
  return <SchoolStoreInput token={token} schoolName={config.schoolName} quantity={config.quantity} accountType={config.accountType} requestType={config.type} />;
}

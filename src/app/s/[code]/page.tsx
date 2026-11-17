import type { Metadata } from "next";
import SchoolStoreInput from "@/components/school-store-input";
import { resolveSchoolStoreInputLink } from "@/lib/school-store-short-link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Snorkl 계정 이메일 입력",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let config;
  try {
    // This route accepts short codes only; existing signed links retain their original route.
    config = /^[A-Za-z0-9_-]{22}$/.test(code)
      ? await resolveSchoolStoreInputLink(code, process.env.ADMIN_SESSION_SECRET || "")
      : null;
  } catch {
    return <main className="mx-auto max-w-lg p-8">
      <h1 className="text-xl font-bold">잠시 후 다시 열어 주세요</h1>
      <p className="mt-4">링크를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
    </main>;
  }
  if (!config) return <main className="mx-auto max-w-lg p-8">
    <h1 className="text-xl font-bold">링크를 확인해 주세요</h1>
    <p className="mt-4">유효하지 않거나 만료된 링크입니다. 담당자에게 새 링크를 요청해 주세요.</p>
  </main>;
  return <SchoolStoreInput token={code} schoolName={config.schoolName} quantity={config.quantity} accountType={config.accountType} requestType={config.type} />;
}

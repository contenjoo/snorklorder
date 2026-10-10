"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SchoolAuthShell } from "@/components/school-auth-shell";

function SchoolLoginForm() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/school/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Ignore errors: API never enumerates, so always show the same message.
    } finally {
      setLoading(false);
      setSubmitted(true);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-4" role="status">
        <div className="flex items-start gap-3 rounded-xl bg-blue-50 p-4">
          <span className="text-xl" aria-hidden>✉️</span>
          <div className="text-sm text-gray-700">
            <p className="font-semibold text-gray-900">메일함을 확인해 주세요</p>
            <p className="mt-1">
              <span className="font-medium break-all">{email}</span> 이(가) 학교 관리자로 등록된 이메일이면 로그인 링크를 보냈습니다.
            </p>
          </div>
        </div>
        <ul className="space-y-1.5 text-xs text-gray-500">
          <li>• 링크는 <strong className="text-gray-700">30분</strong> 동안 쓸 수 있어요.</li>
          <li>• 로그인을 요청한 <strong className="text-gray-700">이 브라우저</strong>에서 링크를 열어 주세요.</li>
          <li>• 몇 분이 지나도 메일이 없으면 스팸함을 확인해 주세요.</li>
        </ul>
        <button
          type="button"
          onClick={() => setSubmitted(false)}
          className="w-full rounded-xl border-2 border-gray-200 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          다른 이메일로 다시 받기
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error === "invalid" && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          링크가 유효하지 않거나 만료되었습니다. 로그인 링크를 다시 받아 주세요.
        </p>
      )}
      <p className="text-sm text-gray-600">
        학교 관리자로 등록된 이메일을 입력하면 로그인 링크를 보내 드려요. 비밀번호는 필요 없습니다.
      </p>
      <div className="space-y-1.5">
        <label htmlFor="school-admin-email" className="text-sm font-semibold text-gray-800">이메일</label>
        <input
          id="school-admin-email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@school.kr"
          className="w-full h-12 rounded-xl border-2 border-gray-200 bg-white px-4 text-base text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full h-12 rounded-xl bg-blue-600 text-base font-bold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "보내는 중…" : "로그인 링크 받기"}
      </button>
      <p className="text-center text-xs text-gray-400">
        교사 프리미엄 등록은 <Link href="/" className="font-medium text-blue-600 hover:underline">교사 등록 페이지</Link>에서 해 주세요.
      </p>
    </form>
  );
}

export default function SchoolLoginPage() {
  return (
    <SchoolAuthShell title="학교 관리자 로그인" subtitle="School admin login">
      <Suspense fallback={null}>
        <SchoolLoginForm />
      </Suspense>
    </SchoolAuthShell>
  );
}

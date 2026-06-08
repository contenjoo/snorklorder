"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

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

  return (
    <div className="max-w-md mx-auto mt-20 p-6 border rounded">
      <h1 className="text-xl font-semibold mb-4">학교 관리자 로그인 / School admin login</h1>

      {error === "invalid" && (
        <p className="mb-4 text-sm text-red-600">
          링크가 유효하지 않거나 만료되었습니다. 다시 시도하세요.
        </p>
      )}

      {submitted ? (
        <p className="text-sm text-gray-700">
          로그인 링크를 이메일로 보냈습니다. 메일함을 확인하세요. / If your email is registered as a
          school admin, a login link has been sent.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@school.edu"
            className="border rounded px-3 py-2"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50"
          >
            {loading ? "전송 중... / Sending..." : "로그인 링크 받기 / Send login link"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function SchoolLoginPage() {
  return (
    <Suspense fallback={null}>
      <SchoolLoginForm />
    </Suspense>
  );
}

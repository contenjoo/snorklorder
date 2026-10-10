import type { ReactNode } from "react";

/** 학교 관리자 로그인 화면 공통 틀 — 교사 등록 화면(/)과 같은 브랜드 머리·꼬리. */
export function SchoolAuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md break-keep">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-white rounded-full px-4 py-2 shadow-sm border border-gray-100 mb-4">
            <div className="w-6 h-6 bg-blue-600 rounded-md flex items-center justify-center">
              <span className="text-white text-xs font-black">S</span>
            </div>
            <span className="font-bold text-gray-800">Snorkl</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {subtitle && <p className="text-gray-500 mt-1">{subtitle}</p>}
        </div>
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">{children}</div>
        <p className="text-center text-xs text-gray-500 mt-6">
          Powered by <span className="font-semibold">LearnToday</span> · <a href="https://snorkl.app" className="hover:text-gray-700">snorkl.app</a>
        </p>
      </div>
    </div>
  );
}

'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { SchoolAuthShell } from '@/components/school-auth-shell';

export default function LoginConfirm({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/school/login/verify/${token}`, { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (r.ok) { location.assign('/school'); return; }
      setError(data.error || '로그인하지 못했습니다.');
    } catch { setError('연결에 실패했습니다. 잠시 후 다시 시도해 주세요.'); }
    setBusy(false);
  }

  return (
    <SchoolAuthShell title="학교 관리자 로그인" subtitle="School admin login">
      <div className="space-y-4">
        {error ? (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        ) : (
          <p className="text-sm text-gray-600">아래 버튼을 누르면 이 브라우저에서 학교 관리자 로그인이 완료됩니다.</p>
        )}
        <button
          type="button"
          className="w-full h-12 rounded-xl bg-blue-600 text-base font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          disabled={busy}
          onClick={confirm}
        >
          {busy ? '확인 중…' : error ? '다시 시도' : '로그인 완료하기'}
        </button>
        <Link href="/school/login" className="block text-center text-sm text-gray-500 hover:text-gray-700 hover:underline">
          새 로그인 링크 받기
        </Link>
      </div>
    </SchoolAuthShell>
  );
}

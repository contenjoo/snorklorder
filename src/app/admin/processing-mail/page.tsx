'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type Item = { message_id: string; request_id: number | null; school_name: string | null; sender: string; received_at: string; excerpt: string; reason: string | null; evidence_reason: string; outcome: string | null; authenticated: boolean; source_verified: boolean; incomplete: boolean };
type View = 'review' | 'resolved' | 'unlinked' | 'ignored';
type Counts = Record<View, number>;

const VIEWS: { value: View; label: string; hint: string }[] = [
  { value: 'review', label: '검토 필요', hint: '요청과 연결됐지만 자동 반영 조건이 부족해 사람이 판단해야 하는 답장' },
  { value: 'resolved', label: '처리됨', hint: '자동 반영됐거나 이미 완료였거나 검토에서 제외한 답장' },
  { value: 'unlinked', label: '연결 실패', hint: '우리 메일에 단 Jon 답장인데 어느 요청인지 찾지 못해 반영하지 않은 메일. Gmail에서 열어 확인해 주세요' },
  { value: 'ignored', label: '답장 아님', hint: 'Snorkl 자동·홍보 메일처럼 우리 메일에 대한 답장이 아닌 메일. 아무것도 반영하지 않습니다' },
];
const OUTCOME: Record<string, { label: string; cls: string }> = {
  review: { label: '검토 필요', cls: 'bg-amber-100 text-amber-800' },
  applied: { label: '완료 반영', cls: 'bg-emerald-100 text-emerald-800' },
  already_confirmed: { label: '이미 완료', cls: 'bg-slate-100 text-slate-600' },
  excluded: { label: '검토 제외', cls: 'bg-slate-100 text-slate-500' },
};

export default function ProcessingMailPage() {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>('review');
  const [items, setItems] = useState<Item[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(currentView: View, current: number) {
    const res = await fetch(`/api/admin/processing-mail?view=${currentView}&page=${current}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('목록을 불러오지 못했습니다. 관리자 로그인 상태를 확인해 주세요.');
    const data = await res.json();
    setItems(data.items); setHasMore(data.hasMore); setCounts(data.counts ?? null);
  }
  useEffect(() => { load(view, page).catch((e) => { setItems([]); setMessage(e.message); }); }, [view, page]);

  function switchView(next: View) {
    if (next === view) return;
    setItems(null); setPage(0); setMessage(''); setView(next);
  }

  async function review(item: Item, action: 'confirm' | 'exclude') {
    const note = notes[`${item.message_id}:${item.request_id}`]?.trim();
    if (!note || note.length < 3) { setMessage('이 요청을 완료 또는 제외할 근거를 3자 이상 입력해 주세요.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/processing-mail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: item.message_id, requestId: item.request_id, action, note }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      setMessage(action === 'confirm' ? '처리 완료를 기록했습니다. 추가 메일은 발송하지 않았습니다.' : '검토에서 제외했습니다.');
      await load(view, page);
    } catch (e) { setMessage(e instanceof Error ? e.message : '요청 실패'); } finally { setBusy(false); }
  }

  const current = VIEWS.find((v) => v.value === view)!;
  const emptyText = view === 'review' ? '검토할 답장이 없습니다 ✓' : view === 'resolved' ? '처리된 답장이 없습니다' : view === 'unlinked' ? '연결 실패한 답장이 없습니다 ✓' : '답장이 아닌 메일이 없습니다';

  return (
    <div className="space-y-3 pb-20 md:pb-0">
      <div>
        <Link href="/admin/accounts" className="text-xs text-slate-500 hover:underline">← 계정 요청</Link>
        <h1 className="text-lg font-bold text-slate-900">처리 완료 메일 검토</h1>
        <p className="text-xs text-slate-500">Jon이 직접 답장했고 계정·내용이 요청과 일치하면 자동으로 완료 처리합니다. 조건이 부족한 답장만 &quot;검토 필요&quot;에 남습니다.</p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="메일 분류">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            role="tab"
            aria-selected={view === v.value}
            onClick={() => switchView(v.value)}
            className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${view === v.value ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}
          >
            {v.label}{counts ? ` ${counts[v.value]}` : ''}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">{current.hint}</p>

      {message && <p role="status" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">{message}</p>}

      {items === null ? (
        <p className="rounded-xl border bg-white py-10 text-center text-sm text-slate-400">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border bg-white py-10 text-center text-sm text-slate-400">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => {
            const outcome = OUTCOME[item.outcome || ''];
            const noteKey = `${item.message_id}:${item.request_id}`;
            const excerpt = item.excerpt.trim();
            return (
              <article key={`${item.message_id}:${item.request_id}:${i}`} className="space-y-2 rounded-xl border bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[13px] font-semibold text-slate-900">
                    {item.request_id ? `#${item.request_id} ${item.school_name || ''}` : '연결된 요청 없음'}
                  </h2>
                  {outcome && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${outcome.cls}`}>{outcome.label}</span>}
                  <span className="ml-auto text-[11px] text-slate-400">{new Date(item.received_at).toLocaleString('ko-KR')} · {item.sender}</span>
                </div>
                {excerpt
                  ? <blockquote className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 text-[12px] text-slate-700">{excerpt}</blockquote>
                  : <p className="text-[11px] italic text-slate-400">본문 없음</p>}
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  <span>{item.reason || item.evidence_reason}{item.incomplete ? ' · 선행 메일을 다시 수집합니다' : ''}</span>
                  <a className="ml-auto text-blue-600 hover:underline" target="_blank" rel="noreferrer" href={`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`rfc822msgid:${item.message_id}`)}`}>Gmail에서 열기 ↗</a>
                </div>
                {item.outcome === 'review' && item.request_id && (
                  <div className="space-y-2 border-t pt-2">
                    <label className="block text-[11px] font-medium text-slate-600" htmlFor={`review-note-${i}`}>검토 근거 — #{item.request_id}</label>
                    <textarea id={`review-note-${i}`} className="w-full rounded-lg border p-2 text-[12px]" maxLength={1000} value={notes[noteKey] || ''} onChange={(e) => setNotes({ ...notes, [noteKey]: e.target.value })} placeholder="추가로 확인한 완료 근거 또는 제외 사유" />
                    <div className="flex gap-2">
                      <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40" disabled={busy || !item.authenticated || !item.source_verified || item.incomplete} onClick={() => review(item, 'confirm')}>이 요청 처리 완료</button>
                      <button className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40" disabled={busy} onClick={() => review(item, 'exclude')}>검토 제외</button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {(page > 0 || hasMore) && (
        <div className="flex items-center justify-center gap-3 text-xs">
          <button className="rounded-lg px-3 py-1 ring-1 ring-slate-200 disabled:opacity-40" disabled={page === 0 || busy} onClick={() => { setItems(null); setPage(page - 1); }}>이전</button>
          <span className="text-slate-500">{page + 1}페이지</span>
          <button className="rounded-lg px-3 py-1 ring-1 ring-slate-200 disabled:opacity-40" disabled={!hasMore || busy} onClick={() => { setItems(null); setPage(page + 1); }}>다음</button>
        </div>
      )}
    </div>
  );
}

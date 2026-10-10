'use client';

import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';

type LinkState = 'expired' | 'live' | 'done';
interface LinkRow { kind: 'batch' | 'account' | 'domain'; id: number; label: string; size: number | null; state: LinkState; expires_at: string }

const KIND_LABEL: Record<LinkRow['kind'], string> = { batch: '교사 묶음', account: '계정 요청', domain: '도메인' };
const KIND_UNIT: Record<LinkRow['kind'], string> = { batch: '명', account: '계정', domain: '' };
const TABS: { value: LinkState; label: string; hint: string; tone: string }[] = [
  { value: 'expired', label: '재발급 필요', hint: 'Jon이 확인하기 전에 만료된 링크', tone: 'text-rose-700' },
  { value: 'live', label: '대기 중', hint: '아직 유효하고 확인 전인 링크', tone: 'text-blue-700' },
  { value: 'done', label: '완료', hint: '최근 완료 50건', tone: 'text-slate-500' },
];
const DAY = 24 * 60 * 60 * 1000;

function kstDate(iso: string) {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function expiryText(row: LinkRow, now: number) {
  const diff = new Date(row.expires_at).getTime() - now;
  if (row.state === 'live') return { text: `D-${Math.max(0, Math.ceil(diff / DAY))} · ${kstDate(row.expires_at)}까지`, cls: diff < 3 * DAY ? 'text-amber-700' : 'text-slate-500' };
  if (row.state === 'expired') return { text: `${Math.max(1, Math.floor(-diff / DAY))}일 전 만료 · ${kstDate(row.expires_at)}`, cls: 'text-rose-700' };
  return { text: `만료일 ${kstDate(row.expires_at)}`, cls: 'text-slate-400' };
}

export default function ConfirmationLinks() {
  const [rows, setRows] = useState<LinkRow[] | null>(null);
  const [tab, setTab] = useState<LinkState | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ key: string; label: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(0);

  async function load() {
    const r = await fetch('/api/admin/confirmation-links', { cache: 'no-store' });
    if (!r.ok) { setError('목록을 불러오지 못했습니다.'); setRows([]); return; }
    setRows(await r.json());
    setNow(Date.now());
  }
  useEffect(() => { void load(); }, []);

  const counts = useMemo(() => {
    const c: Record<LinkState, number> = { expired: 0, live: 0, done: 0 };
    for (const row of rows || []) c[row.state]++;
    return c;
  }, [rows]);
  // 처음 열면 손댈 게 있는 탭부터.
  const activeTab: LinkState = tab ?? (counts.expired > 0 ? 'expired' : 'live');
  const q = search.trim().toLowerCase();
  const visible = (rows || []).filter((row) => row.state === activeTab
    && (!q || row.label.toLowerCase().includes(q) || `#${row.id}`.includes(q) || String(row.id) === q));

  async function rotate(row: LinkRow) {
    const ok = window.confirm(`${KIND_LABEL[row.kind]} #${row.id} (${row.label})\n\n기존 링크는 바로 쓸 수 없게 됩니다. 새 링크를 만들까요?\n메일은 자동으로 나가지 않습니다.`);
    if (!ok) return;
    const key = `${row.kind}-${row.id}`;
    setBusyKey(key); setError(''); setCopied(false);
    try {
      const r = await fetch('/api/admin/confirmation-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: row.kind, id: row.id }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || '재발급하지 못했습니다.'); return; }
      setIssued({ key, label: `${KIND_LABEL[row.kind]} #${row.id} · ${row.label}`, url: d.url });
      await load();
    } finally { setBusyKey(null); }
  }

  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setError('복사하지 못했습니다. 링크를 직접 선택해 복사해 주세요.'); }
  }

  return (
    <div className="space-y-3 pb-20 md:pb-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-lg font-bold text-slate-900">확인 링크</h1>
          <p className="text-xs text-slate-500">Jon이 처리 완료를 누르는 링크입니다. 재발급하면 기존 링크는 바로 만료되고, 메일은 자동 발송되지 않습니다.</p>
        </div>
        <Input placeholder="학교명 또는 #번호" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-xs sm:ml-auto sm:w-48" aria-label="확인 링크 검색" />
      </div>

      {issued && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm" role="status">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-emerald-900">새 링크 발급됨</strong>
            <span className="text-xs text-emerald-800">{issued.label}</span>
            <button type="button" onClick={() => setIssued(null)} className="ml-auto text-xs text-emerald-700 hover:underline">닫기</button>
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 text-[11px] text-slate-700 ring-1 ring-emerald-100">{issued.url}</code>
            <button type="button" onClick={() => copy(issued.url)} className="shrink-0 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800">
              {copied ? '복사됨 ✓' : '링크 복사'}
            </button>
          </div>
        </div>
      )}
      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">{error}</p>}

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="링크 상태">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={activeTab === t.value}
            onClick={() => setTab(t.value)}
            className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${activeTab === t.value ? 'bg-slate-900 text-white' : `bg-white ring-1 ring-slate-200 hover:bg-slate-50 ${t.tone}`}`}
          >
            {t.label} {rows ? counts[t.value] : ''}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-slate-400">{TABS.find((t) => t.value === activeTab)?.hint}</p>

      <div className="overflow-hidden rounded-xl border bg-white">
        {rows === null ? (
          <p className="py-10 text-center text-sm text-slate-400">불러오는 중…</p>
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            {q ? '검색 결과 없음' : activeTab === 'expired' ? '재발급할 링크가 없습니다 ✓' : '링크가 없습니다'}
          </p>
        ) : (
          <ul className="divide-y">
            {visible.map((row) => {
              const key = `${row.kind}-${row.id}`;
              const expiry = expiryText(row, now);
              return (
                <li key={key} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 ${issued?.key === key ? 'bg-emerald-50/60' : ''}`}>
                  <span className="w-16 shrink-0 text-[10px] font-semibold text-slate-500">{KIND_LABEL[row.kind]}</span>
                  <span className="w-12 shrink-0 font-mono text-[11px] text-slate-400">#{row.id}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-900" title={row.label}>{row.label}</span>
                  {row.size ? <span className="shrink-0 text-[11px] text-slate-400">{row.size}{KIND_UNIT[row.kind]}</span> : null}
                  <span className={`w-36 shrink-0 text-right text-[11px] tabular-nums ${expiry.cls}`}>{expiry.text}</span>
                  {row.state !== 'done' && (
                    <button
                      type="button"
                      disabled={busyKey !== null}
                      onClick={() => rotate(row)}
                      className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40 ${row.state === 'expired' ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}
                    >
                      {busyKey === key ? '발급 중…' : '재발급'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

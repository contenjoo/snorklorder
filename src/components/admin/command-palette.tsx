"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { toChoseong, isChoseongQuery } from "@/lib/hangul";

// ── 데이터셋 ──────────────────────────────────────────────────────────────
// /api/admin/search 가 전 엔티티를 한 번에 내려준다. 모듈 캐시로 팔레트를
// 다시 열어도 재요청하지 않는다 (30초 TTL).

interface SchoolRow { id: number; name: string; nameEn: string | null; code: string; team: string | null; domain: string | null }
interface TeacherRow { id: number; name: string; email: string; subject: string | null; status: string; schoolId: number; schoolName: string }
interface AccountRow { id: number; schoolName: string; schoolNameEn: string | null; emails: string; status: string; type: string }
interface DomainRow { id: number; schoolName: string; domain: string; status: string }
interface RequestRow { id: number; name: string; contactEmail: string; status: string }
interface Dataset { schools: SchoolRow[]; teachers: TeacherRow[]; accounts: AccountRow[]; domains: DomainRow[]; requests: RequestRow[] }

let _cache: { data: Dataset; at: number } | null = null;
let _inflight: Promise<Dataset> | null = null;
const TTL = 30_000;

async function loadDataset(): Promise<Dataset> {
  if (_cache && Date.now() - _cache.at < TTL) return _cache.data;
  if (!_inflight) {
    _inflight = fetch("/api/admin/search")
      .then((r) => (r.ok ? r.json() : { schools: [], teachers: [], accounts: [], domains: [], requests: [] }))
      .then((data: Dataset) => { _cache = { data, at: Date.now() }; return data; })
      .finally(() => { _inflight = null; });
  }
  return _inflight;
}

// ── 아이템 모델 ───────────────────────────────────────────────────────────

interface Item {
  key: string;
  section: string;
  icon: string;
  title: string;
  titleEn?: string | null;
  meta?: string | null;
  mono?: string | null; // 이메일 등 고정폭 표기
  href: string;
  score: number;
}

const ACTIONS: Omit<Item, "score">[] = [
  { key: "a-new", section: "액션", icon: "➕", title: "새 정산 요청", href: "/admin/accounts?new=1" },
  { key: "a-acc", section: "액션", icon: "🧾", title: "정산으로 이동", href: "/admin/accounts" },
  { key: "a-sch", section: "액션", icon: "🏫", title: "학교 관리로 이동", href: "/admin/schools" },
  { key: "a-tea", section: "액션", icon: "👩‍🏫", title: "교사 관리로 이동", href: "/admin/teachers" },
  { key: "a-dom", section: "액션", icon: "🌐", title: "도메인 유료 등록", href: "/admin/domains" },
  { key: "a-req", section: "액션", icon: "📥", title: "학교 등록 요청", href: "/admin/requests" },
  { key: "a-lv-e", section: "액션", icon: "🟢", title: "초등 교사만 보기", href: "/admin/teachers?level=초" },
  { key: "a-lv-m", section: "액션", icon: "🔵", title: "중학교 교사만 보기", href: "/admin/teachers?level=중" },
  { key: "a-lv-h", section: "액션", icon: "🔴", title: "고등학교 교사만 보기", href: "/admin/teachers?level=고" },
];

const STATUS_KO: Record<string, string> = {
  pending: "대기", sent: "발송", upgraded: "확정", individual: "개별",
  draft: "작성 중", processed: "처리 완료", invoiced: "인보이스", paid: "결제 완료",
  approved: "승인", rejected: "반려", done: "완료",
};

// ── 매칭·랭킹 ─────────────────────────────────────────────────────────────
// 필드별 가중치 × 매치 위치(접두 > 중간)로 점수. 초성 쿼리는 초성열에 매칭.

function fieldScore(field: string | null | undefined, q: string, cho: boolean, weight: number): number {
  if (!field) return 0;
  const hay = cho ? toChoseong(field) : field.toLowerCase();
  const idx = hay.indexOf(q);
  if (idx < 0) return 0;
  return weight + (idx === 0 ? 40 : 0) - Math.min(idx, 20);
}

function searchAll(ds: Dataset, rawQuery: string): Item[] {
  const cho = isChoseongQuery(rawQuery);
  const q = cho ? rawQuery.replace(/\s/g, "") : rawQuery.toLowerCase();
  const out: Item[] = [];

  for (const a of ACTIONS) {
    const s = fieldScore(a.title, q, cho, 50);
    if (s > 0) out.push({ ...a, score: s + 100 });
  }
  for (const s of ds.schools) {
    const sc = Math.max(
      fieldScore(s.name, q, cho, 100), fieldScore(s.nameEn, q, cho, 70),
      fieldScore(s.code, q, cho, 60), fieldScore(s.domain, q, cho, 60),
      fieldScore(s.team, q, cho, 40),
    );
    if (sc > 0) out.push({
      key: `s-${s.id}`, section: "학교", icon: "🏫", title: s.name, titleEn: s.nameEn,
      meta: s.team, href: `/admin/schools?focus=${s.id}`, score: sc + 30,
    });
  }
  for (const t of ds.teachers) {
    const sc = Math.max(
      fieldScore(t.name, q, cho, 90), fieldScore(t.email, q, cho, 80),
      fieldScore(t.subject, q, cho, 70), fieldScore(t.schoolName, q, cho, 30),
    );
    if (sc > 0) out.push({
      key: `t-${t.id}`, section: "교사", icon: "👩‍🏫", title: t.name,
      meta: [t.schoolName, t.subject, STATUS_KO[t.status] || t.status].filter(Boolean).join(" · "),
      mono: t.email, href: `/admin/teachers?q=${encodeURIComponent(t.email)}`, score: sc + 20,
    });
  }
  for (const a of ds.accounts) {
    const sc = Math.max(
      fieldScore(a.schoolName, q, cho, 80), fieldScore(a.schoolNameEn, q, cho, 50),
      fieldScore(a.emails, q, cho, 60),
    );
    if (sc > 0) out.push({
      key: `acc-${a.id}`, section: "정산", icon: "🧾", title: a.schoolName,
      meta: [a.type === "extension" ? "연장" : a.type === "email_change" ? "이메일 변경" : "업그레이드", STATUS_KO[a.status] || a.status].join(" · "),
      mono: a.emails.split(/[,;\n]+/)[0]?.trim() || null,
      href: `/admin/accounts?focus=${a.id}`, score: sc + 25,
    });
  }
  for (const d of ds.domains) {
    const sc = Math.max(fieldScore(d.schoolName, q, cho, 80), fieldScore(d.domain, q, cho, 80));
    if (sc > 0) out.push({
      key: `d-${d.id}`, section: "도메인", icon: "🌐", title: d.schoolName,
      meta: STATUS_KO[d.status] || d.status, mono: `@${d.domain.replace(/^@/, "")}`,
      href: "/admin/domains", score: sc + 15,
    });
  }
  for (const r of ds.requests) {
    const sc = Math.max(fieldScore(r.name, q, cho, 70), fieldScore(r.contactEmail, q, cho, 60));
    if (sc > 0) out.push({
      key: `r-${r.id}`, section: "학교 등록 요청", icon: "📥", title: r.name,
      meta: STATUS_KO[r.status] || r.status, mono: r.contactEmail,
      href: "/admin/requests", score: sc + 10,
    });
  }

  // 섹션당 상한을 두고 점수순 정렬 (한 섹션이 결과를 독식하지 않도록)
  const CAP: Record<string, number> = { "액션": 4, "학교": 6, "교사": 8, "정산": 6, "도메인": 4, "학교 등록 요청": 4 };
  const bySection = new Map<string, Item[]>();
  for (const item of out.sort((a, b) => b.score - a.score)) {
    const list = bySection.get(item.section) || [];
    if (list.length < (CAP[item.section] ?? 5)) { list.push(item); bySection.set(item.section, list); }
  }
  const ORDER = ["액션", "학교", "교사", "정산", "도메인", "학교 등록 요청"];
  return ORDER.flatMap((sec) => bySection.get(sec) || []);
}

// ── 최근 항목 (localStorage) ──────────────────────────────────────────────

const RECENT_KEY = "snorkl-palette-recents";

function readRecents(): Item[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(0, 6).map((r: Item) => ({ ...r, section: "최근", score: 0 })) : [];
  } catch { return []; }
}

function pushRecent(item: Item) {
  try {
    const rest = readRecents().filter((r) => r.key !== item.key);
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ ...item, section: "최근" }, ...rest].slice(0, 6)));
  } catch { /* storage 실패는 무시 */ }
}

// ── 하이라이트 ────────────────────────────────────────────────────────────

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q || isChoseongQuery(query)) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-amber-100 px-0 text-inherit">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

// ── 컴포넌트 ──────────────────────────────────────────────────────────────

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// open 일 때만 PaletteInner 를 마운트해 매번 깨끗한 상태로 시작한다
// (닫힘 시 query/선택 리셋용 effect 가 필요 없어짐 — react-compiler 규칙 준수).
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(<PaletteInner onClose={() => onOpenChange(false)} />, document.body);
}

function PaletteInner({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [recents] = useState<Item[]>(() => readRecents());
  // 선택 상태는 (쿼리, 인덱스) 쌍으로 저장 — 쿼리가 바뀌면 자동으로 0으로 돌아간다
  const [sel, setSel] = useState<{ q: string; i: number }>({ q: "", i: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Esc 안전망 + 데이터셋 프리로드 + 포커스
  useEffect(() => {
    function onKeyDownDoc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDownDoc);
    loadDataset().then(setDataset);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", onKeyDownDoc);
      cancelAnimationFrame(id);
    };
  }, [onClose]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim();
    if (!q) {
      const actions = ACTIONS.slice(0, 6).map((a) => ({ ...a, score: 0 }));
      return [...recents, ...actions];
    }
    if (!dataset) return [];
    return searchAll(dataset, q);
  }, [query, dataset, recents]);

  const selectedIndex = sel.q === query && items.length > 0 ? Math.min(sel.i, items.length - 1) : 0;

  // 선택 항목이 스크롤 밖이면 따라간다
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const runItem = useCallback((item: Item) => {
    if (!item.key.startsWith("a-")) pushRecent(item);
    router.push(item.href);
    onClose();
  }, [router, onClose]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel({ q: query, i: items.length === 0 ? 0 : (selectedIndex + 1) % items.length });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel({ q: query, i: items.length === 0 ? 0 : (selectedIndex - 1 + items.length) % items.length });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[selectedIndex];
      if (item) runItem(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/45 pt-[12vh] backdrop-blur-[2px] animate-in fade-in duration-100"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[min(600px,92vw)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-100">
        <div className="relative border-b border-slate-100">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="학교·교사·이메일·과목·정산·도메인 검색 — 초성(ㄱㅇㅈ)도 됩니다"
            className="w-full bg-transparent py-4 pl-11 pr-4 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
        </div>

        <div ref={listRef} className="max-h-[55vh] overflow-y-auto py-1.5">
          {query.trim() && !dataset && (
            <p className="px-4 py-6 text-center text-xs text-slate-400">불러오는 중…</p>
          )}
          {items.length === 0 && query.trim() && dataset && (
            <p className="px-4 py-6 text-center text-xs text-slate-400">
              &ldquo;{query}&rdquo; 검색 결과 없음
            </p>
          )}

          {items.map((item, index) => {
            const isSelected = index === selectedIndex;
            const showHeader = index === 0 || items[index - 1].section !== item.section;
            return (
              <div key={item.key}>
                {showHeader && (
                  <p className="px-4 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
                    {item.section}
                  </p>
                )}
                <div
                  data-idx={index}
                  onMouseEnter={() => setSel({ q: query, i: index })}
                  onClick={() => runItem(item)}
                  className={`mx-1.5 flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                    isSelected ? "bg-indigo-50 text-slate-900" : "text-slate-700"
                  }`}
                >
                  <span className="shrink-0 text-sm">{item.icon}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-slate-900">
                      <Highlight text={item.title} query={query} />
                    </span>
                    {item.titleEn && <span className="ml-2 text-xs text-slate-400">{item.titleEn}</span>}
                    {item.meta && <span className="ml-2 text-xs text-slate-400">{item.meta}</span>}
                    {item.mono && (
                      <span className="ml-2 font-mono text-xs text-slate-400">
                        <Highlight text={item.mono} query={query} />
                      </span>
                    )}
                  </span>
                  <span className={`shrink-0 text-[11px] ${isSelected ? "text-indigo-500" : "text-slate-300"}`}>↵</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
          <span>↑↓ 이동</span><span>↵ 선택</span><span>esc 닫기</span>
          <span className="ml-auto">초성 검색 지원 · 어디서든 ⌘K</span>
        </div>
      </div>
    </div>
  );
}

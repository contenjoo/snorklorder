"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";

interface SchoolResult {
  id: number;
  name: string;
  nameEn: string | null;
  code: string;
  team: string | null;
}

interface TeacherResult {
  id: number;
  name: string;
  email: string;
  schoolId: number;
  schoolName: string;
}

interface ActionItem {
  type: "action";
  key: string;
  icon: string;
  label: string;
  hint: string;
  href: string;
}

interface SchoolItem {
  type: "school";
  key: string;
  data: SchoolResult;
}

interface TeacherItem {
  type: "teacher";
  key: string;
  data: TeacherResult;
}

type PaletteItem = ActionItem | SchoolItem | TeacherItem;

const DEFAULT_ACTIONS: ActionItem[] = [
  // TODO: /admin/accounts is owned by another in-flight change. It does not yet read
  // `?new=1` to auto-open the "new request" dialog — this link currently just navigates
  // to the accounts page. Wire up the auto-open once that page settles.
  { type: "action", key: "new-account", icon: "➕", label: "새 정산 요청", hint: "이동", href: "/admin/accounts?new=1" },
  { type: "action", key: "goto-accounts", icon: "🧾", label: "정산으로 이동", hint: "이동", href: "/admin/accounts" },
  { type: "action", key: "pending-teachers", icon: "⏳", label: "교사 승인 대기 보기", hint: "이동", href: "/admin" },
  { type: "action", key: "goto-schools", icon: "🏫", label: "학교 관리로 이동", hint: "이동", href: "/admin/schools" },
  { type: "action", key: "goto-teachers", icon: "👩‍🏫", label: "교사 관리로 이동", hint: "이동", href: "/admin/teachers" },
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [schools, setSchools] = useState<SchoolResult[]>([]);
  const [teachers, setTeachers] = useState<TeacherResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Safety-net Esc handler (primary handling is on the input's onKeyDown)
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSchools([]);
      setTeachers([]);
      setSelectedIndex(0);
      return;
    }
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Debounced search
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSchools([]);
      setTeachers([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      Promise.all([
        fetch(`/api/schools/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
        fetch(`/api/teachers?search=${encodeURIComponent(q)}`, { signal: controller.signal })
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
      ]).then(([schoolResults, teacherResults]) => {
        setSchools(Array.isArray(schoolResults) ? schoolResults.slice(0, 5) : []);
        setTeachers(Array.isArray(teacherResults) ? teacherResults.slice(0, 5) : []);
      });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim();
    if (!q) return DEFAULT_ACTIONS;
    const schoolItems: SchoolItem[] = schools.map((s) => ({ type: "school", key: `school-${s.id}`, data: s }));
    const teacherItems: TeacherItem[] = teachers.map((t) => ({ type: "teacher", key: `teacher-${t.id}`, data: t }));
    return [...schoolItems, ...teacherItems];
  }, [query, schools, teachers]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items.length]);

  const runItem = useCallback(
    (item: PaletteItem) => {
      if (item.type === "action") {
        router.push(item.href);
      } else if (item.type === "school") {
        router.push(`/admin/schools?focus=${item.data.id}`);
      } else if (item.type === "teacher") {
        router.push(`/admin/teachers?q=${encodeURIComponent(item.data.email)}`);
      }
      close();
    },
    [router, close]
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[selectedIndex];
      if (item) runItem(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh] backdrop-blur-[1px] animate-in fade-in duration-100"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-[min(560px,92vw)] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-100">
        <div className="relative border-b border-gray-100">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="검색: 학교, 교사, 이메일 / 액션: 새 요청, 정산…"
            className="w-full bg-transparent py-4 pl-11 pr-4 text-sm text-gray-900 outline-none placeholder:text-gray-400"
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-1.5">
          {items.length === 0 && query.trim() && (
            <p className="px-4 py-6 text-center text-xs text-gray-400">검색 결과 없음</p>
          )}

          {items.map((item, index) => {
            const isSelected = index === selectedIndex;
            return (
              <div
                key={item.key}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => runItem(item)}
                className={`mx-1.5 flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                  isSelected ? "bg-blue-50 text-gray-900" : "text-gray-700"
                }`}
              >
                {item.type === "action" && (
                  <>
                    <span className="shrink-0">{item.icon}</span>
                    <span className="flex-1 truncate font-medium">{item.label}</span>
                    <span className="shrink-0 text-[11px] text-gray-400">{item.hint}</span>
                  </>
                )}
                {item.type === "school" && (
                  <>
                    <span className="shrink-0">🏫</span>
                    <span className="flex-1 truncate">
                      <span className="font-medium text-gray-900">{item.data.name}</span>
                      {item.data.nameEn && (
                        <span className="ml-2 text-xs text-gray-400">{item.data.nameEn}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] text-gray-400">이동 ↵</span>
                  </>
                )}
                {item.type === "teacher" && (
                  <>
                    <span className="shrink-0">👩‍🏫</span>
                    <span className="flex-1 truncate">
                      <span className="font-medium text-gray-900">{item.data.name}</span>
                      <span className="text-gray-400"> — {item.data.schoolName}</span>
                      <span className="ml-2 font-mono text-xs text-gray-400">{item.data.email}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-gray-400">이동 ↵</span>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">
          ↑↓ 이동 · ↵ 선택 · esc 닫기 — 어디서든 ⌘K
        </div>
      </div>
    </div>,
    document.body
  );
}

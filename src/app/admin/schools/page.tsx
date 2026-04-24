"use client";

import { useState, useMemo } from "react";
import { useSchoolData } from "@/lib/use-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Teacher {
  id: number;
  name: string;
  email: string;
  subject: string | null;
  status: string;
  createdAt: string;
  schoolId: number;
}

interface School {
  id: number;
  name: string;
  code: string;
  nameEn: string | null;
  domain: string | null;
  region: string | null;
  team: string | null;
  teacherCount: number;
  teachers: Teacher[];
}

const REGIONS = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];

const teamColors: Record<string, string> = {
  "서울1팀": "#3b82f6",
  "서울4팀": "#6366f1",
  "경기2팀": "#10b981",
  "경기3팀": "#22c55e",
  "경기5팀": "#14b8a6",
};

const statusLabel: Record<string, string> = {
  upgraded: "확정",
  individual: "개별",
  sent: "발송",
  pending: "대기",
};

const statusColor: Record<string, string> = {
  upgraded: "text-emerald-600",
  individual: "text-violet-600",
  sent: "text-blue-500",
  pending: "text-amber-500",
};

const statusDot: Record<string, string> = {
  upgraded: "bg-emerald-400",
  individual: "bg-violet-400",
  sent: "bg-blue-400",
  pending: "bg-amber-400",
};

export default function SchoolsPage() {
  const { schools, refresh: load } = useSchoolData();
  const [expandedSchool, setExpandedSchool] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [showSection, setShowSection] = useState<"all" | "teams" | "individual">("all");

  // Add/Edit school form
  const [open, setOpen] = useState(false);
  const [editingSchool, setEditingSchool] = useState<School | null>(null);
  const [fname, setFname] = useState("");
  const [fnameEn, setFnameEn] = useState("");
  const [fcode, setFcode] = useState("");
  const [fdomain, setFdomain] = useState("");
  const [fregion, setFregion] = useState("");
  const [fteam, setFteam] = useState("");
  const [ferror, setFerror] = useState("");
  const [translating, setTranslating] = useState(false);

  // Computed data
  const { teamGroups, individualSchools, totalTeachers, confirmedCount, pendingCount } = useMemo(() => {
    const teamMap = new Map<string, School[]>();
    const indivList: School[] = [];

    for (const s of schools) {
      if (search) {
        const q = search.toLowerCase();
        const match = s.name.toLowerCase().includes(q) || (s.nameEn || "").toLowerCase().includes(q) ||
          s.code.toLowerCase().includes(q) || s.teachers.some(t => t.name.toLowerCase().includes(q) || t.email.toLowerCase().includes(q));
        if (!match) continue;
      }
      if (s.team && !s.team.includes("개별") && s.team !== "미배정") {
        if (!teamMap.has(s.team)) teamMap.set(s.team, []);
        teamMap.get(s.team)!.push(s);
      } else {
        indivList.push(s);
      }
    }

    const groups = Array.from(teamMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, ss]) => ({
        name,
        schools: ss.sort((a, b) => b.teachers.length - a.teachers.length),
        teacherCount: ss.reduce((s, sc) => s + sc.teachers.length, 0),
        confirmedCount: ss.reduce((s, sc) => s + sc.teachers.filter(t => t.status === "upgraded" || t.status === "individual").length, 0),
      }));

    const allTeachers = schools.flatMap(s => s.teachers);
    return {
      teamGroups: groups,
      individualSchools: indivList.sort((a, b) => b.teachers.length - a.teachers.length),
      totalTeachers: allTeachers.length,
      confirmedCount: allTeachers.filter(t => t.status === "upgraded" || t.status === "individual").length,
      pendingCount: allTeachers.filter(t => t.status === "pending").length,
    };
  }, [schools, search]);

  const rate = totalTeachers > 0 ? Math.round((confirmedCount / totalTeachers) * 100) : 0;
  const teamSchoolCount = teamGroups.reduce((s, g) => s + g.schools.length, 0);

  // Functions
  function openEditDialog(school: School) {
    setEditingSchool(school);
    setFname(school.name); setFnameEn(school.nameEn || ""); setFcode(school.code);
    setFdomain(school.domain || ""); setFregion(school.region || ""); setFteam(school.team || ""); setFerror("");
    setOpen(true);
  }
  function openAddDialog() {
    setEditingSchool(null);
    setFname(""); setFnameEn(""); setFcode(""); setFdomain(""); setFregion(""); setFteam(""); setFerror("");
    setOpen(true);
  }
  function closeDialog() {
    setOpen(false); setEditingSchool(null);
    setFname(""); setFnameEn(""); setFcode(""); setFdomain(""); setFregion(""); setFteam(""); setFerror("");
  }
  async function saveSchool() {
    setFerror("");
    if (!fname.trim() || !fcode.trim()) { setFerror("Name and code required"); return; }
    const payload = { name: fname.trim(), nameEn: fnameEn.trim() || null, code: fcode.trim().toUpperCase(), domain: fdomain.trim() || null, region: fregion || null, team: fteam.trim() || null };
    if (editingSchool) {
      const res = await fetch("/api/schools", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editingSchool.id, ...payload }) });
      if (!res.ok) { const d = await res.json(); setFerror(d.error || "Failed"); return; }
    } else {
      const res = await fetch("/api/schools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const d = await res.json(); setFerror(d.error || "Failed"); return; }
    }
    closeDialog(); load();
  }
  async function translateName(korean: string) {
    if (!korean.trim()) return;
    setTranslating(true);
    try {
      const res = await fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: korean.trim() }) });
      const data = await res.json();
      if (data.translated) {
        setFnameEn(data.translated);
        const code = data.translated.replace(/\b(elementary|middle|high|school|university|college)\b/gi, "").trim().split(/\s+/).map((w: string) => w.toUpperCase()).join("").replace(/[^A-Z]/g, "").slice(0, 12);
        if (code && !fcode) setFcode(code);
      }
    } catch {} finally { setTranslating(false); }
  }
  async function deleteSchool(id: number) {
    if (!confirm("이 학교와 소속 교사를 모두 삭제할까요?")) return;
    await fetch(`/api/schools?id=${id}`, { method: "DELETE" }); load();
  }
  function toggleTeacher(id: number) {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function copyEmails(emails: string[], label: string) {
    navigator.clipboard.writeText(emails.join("\n"));
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }
  async function sendTeachers(ids: number[], label?: string) {
    if (ids.length === 0) return;
    setSending(true); setMessage("");
    try {
      const res = await fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teacherIds: ids }) });
      const data = await res.json();
      if (data.success) {
        setMessage(`${label ? label + " " : ""}${ids.length}명 이메일 발송 완료`);
        setSelected(new Set());
        load();
      } else {
        setMessage("발송 실패: " + (data.error || ""));
      }
    } catch { setMessage("연결 오류"); } finally { setSending(false); }
  }
  async function sendSelected() {
    await sendTeachers(Array.from(selected));
  }
  // Pending = not yet upgraded/individual (includes sent so they can be re-sent)
  const pendingIds = (ts: { id: number; status: string }[]) =>
    ts.filter(t => t.status !== "upgraded" && t.status !== "individual").map(t => t.id);
  async function confirmSend(label: string, ids: number[]) {
    if (ids.length === 0) { setMessage(`${label}: 발송할 대기 교사 없음`); return; }
    if (!confirm(`${label}: ${ids.length}명에게 Jon 발송 메일을 보낼까요?`)) return;
    await sendTeachers(ids, label);
  }
  async function markUpgraded() {
    if (selected.size === 0) return;
    await fetch("/api/teachers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selected), status: "upgraded" }) });
    setSelected(new Set()); load();
  }

  // Render school row (reused in teams and individual sections)
  function renderSchoolRow(school: School, indent = false) {
    const isOpen = expandedSchool === school.id;
    const conf = school.teachers.filter(t => t.status === "upgraded" || t.status === "individual").length;
    const pend = school.teachers.filter(t => t.status === "pending" || t.status === "sent").length;

    return (
      <div key={school.id} className={indent ? "" : ""}>
        <div
          className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 cursor-pointer transition-colors group ${isOpen ? "bg-blue-50/60" : "hover:bg-gray-50"}`}
          onClick={() => setExpandedSchool(isOpen ? null : school.id)}
        >
          {/* Status indicator */}
          <div className={`w-2 h-2 rounded-full shrink-0 ${pend > 0 ? "bg-amber-400" : school.teachers.length > 0 ? "bg-emerald-400" : "bg-gray-200"}`} />

          {/* School name */}
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-gray-900">{school.name}</span>
            {school.nameEn && <span className="text-xs text-gray-400 ml-2 hidden sm:inline">{school.nameEn}</span>}
          </div>

          {/* Teacher count + status */}
          <div className="flex items-center gap-2 shrink-0">
            {pend > 0 && <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">{pend}대기</span>}
            <span className="text-xs font-semibold text-gray-600 tabular-nums w-8 text-right">{school.teachers.length}명</span>
            {school.teachers.length > 0 && (
              <div className="w-12 h-1 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${(conf / school.teachers.length) * 100}%` }} />
              </div>
            )}
          </div>

          {/* Actions (visible on hover) */}
          <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
            <button onClick={(e) => { e.stopPropagation(); openEditDialog(school); }}
              className="p-1 rounded text-gray-300 hover:text-blue-600 hover:bg-blue-50" title="수정">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
            </button>
            <button onClick={(e) => { e.stopPropagation(); copyEmails(school.teachers.map(t => t.email), `s-${school.id}`); }}
              className="p-1 rounded text-gray-300 hover:text-blue-600 hover:bg-blue-50" title="이메일 복사">
              {copied === `s-${school.id}` ? (
                <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" /></svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
              )}
            </button>
            {pendingIds(school.teachers).length > 0 && (
              <button onClick={(e) => { e.stopPropagation(); confirmSend(`${school.name}`, pendingIds(school.teachers)); }}
                disabled={sending}
                className="p-1 rounded text-gray-300 hover:text-emerald-600 hover:bg-emerald-50 disabled:opacity-40" title={`${school.name} 대기 ${pendingIds(school.teachers).length}명 Jon 발송`}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.125A59.769 59.769 0 0121.485 12 59.768 59.768 0 013.27 20.875L5.999 12zm0 0h7.5" /></svg>
              </button>
            )}
          </div>

          <svg className={`w-4 h-4 text-gray-300 transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Teacher details */}
        {isOpen && (
          <div className="bg-slate-50 border-t border-b border-slate-100">
            {school.teachers.length === 0 ? (
              <p className="text-center text-gray-400 text-xs py-4">등록된 교사 없음</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {school.teachers.map(t => (
                  <label key={t.id} className={`flex items-center gap-2 px-3 sm:px-4 pl-6 sm:pl-8 py-1.5 text-xs cursor-pointer transition-colors ${selected.has(t.id) ? "bg-blue-50" : "hover:bg-white"}`}>
                    <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleTeacher(t.id)} className="rounded w-3 h-3" />
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[t.status] || "bg-gray-300"}`} />
                    <span className="text-gray-700 w-14 truncate">{t.name}</span>
                    <span className="text-gray-400 font-mono truncate flex-1">{t.email}</span>
                    <span className={`font-medium ${statusColor[t.status] || "text-gray-400"}`}>{statusLabel[t.status] || t.status}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      {/* Compact header bar */}
      <div className="space-y-2">
        {/* Row 1: Title + stats */}
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold text-gray-900 whitespace-nowrap">학교 관리</h1>

          {/* Mini stats */}
          <div className="flex items-center gap-3 text-xs text-gray-500 whitespace-nowrap">
            <span><strong className="text-gray-900 text-sm">{schools.length}</strong> 학교</span>
            <span className="text-gray-200">|</span>
            <span><strong className="text-gray-900 text-sm">{totalTeachers}</strong> 교사</span>
            <span className="text-gray-200">|</span>
            <span className="text-emerald-600 font-medium">{rate}% 확정</span>
            {pendingCount > 0 && (
              <>
                <span className="text-gray-200">|</span>
                <span className="text-amber-600 font-medium">{pendingCount} 대기</span>
              </>
            )}
          </div>
        </div>

        {/* Row 2: Search + filter + add */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative shrink-0">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
            <Input placeholder="학교·교사 검색" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 w-48 text-xs" />
          </div>

          {/* Section filter */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5 shrink-0">
            {([["all", "전체"], ["teams", "공동구매"], ["individual", "개별"]] as const).map(([val, label]) => (
              <button key={val} onClick={() => setShowSection(val)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${showSection === val ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* 전체 대기 → Jon 발송 */}
          {(() => {
            const allPending = pendingIds(schools.flatMap(s => s.teachers));
            if (allPending.length === 0) return null;
            return (
              <Button size="sm" variant="outline" disabled={sending} onClick={() => confirmSend("전체 대기", allPending)}
                className="h-8 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.125A59.769 59.769 0 0121.485 12 59.768 59.768 0 013.27 20.875L5.999 12zm0 0h7.5" /></svg>
                전체 Jon 발송 ({allPending.length})
              </Button>
            );
          })()}

          {/* Add school */}
          <Dialog open={open} onOpenChange={(v) => { if (!v) closeDialog(); else setOpen(true); }}>
            <DialogTrigger render={
              <Button size="sm" className="h-8 text-xs" onClick={openAddDialog}>
                <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" /></svg>
                학교 추가
              </Button>
            } />
          <DialogContent>
            <DialogHeader><DialogTitle>{editingSchool ? "학교 수정" : "학교 추가"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>학교명 (한국어) *</Label>
                  <Input placeholder="예: 효명고등학교" value={fname} onChange={(e) => setFname(e.target.value)} onBlur={() => { if (fname && !fnameEn) translateName(fname); }} />
                </div>
                <div className="space-y-1">
                  <Label>영문명 {translating && <span className="text-xs text-blue-500">(번역 중...)</span>}</Label>
                  <Input placeholder="자동 번역됨" value={fnameEn} onChange={(e) => setFnameEn(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>코드 *</Label>
                  <Input placeholder="HYOMYEONG" value={fcode} onChange={(e) => setFcode(e.target.value.toUpperCase())} className="font-mono" />
                </div>
                <div className="space-y-1">
                  <Label>지역</Label>
                  <Select value={fregion} onValueChange={(v) => setFregion(v ?? "")}>
                    <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                    <SelectContent>{REGIONS.map((r) => (<SelectItem key={r} value={r}>{r}</SelectItem>))}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>팀</Label>
                  <Input placeholder="서울1팀" value={fteam} onChange={(e) => setFteam(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>도메인 (선택)</Label>
                <Input placeholder="hmh.or.kr" value={fdomain} onChange={(e) => setFdomain(e.target.value)} />
              </div>
              {ferror && <p className="text-sm text-red-600">{ferror}</p>}
              <div className="flex gap-2">
                <Button onClick={saveSchool} className="flex-1">{editingSchool ? "저장" : "추가"}</Button>
                {editingSchool && (
                  <Button variant="outline" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => { closeDialog(); deleteSchool(editingSchool.id); }}>
                    삭제
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Toast message (visible when no selection bar shown) */}
      {message && selected.size === 0 && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-lg bg-gray-900 text-white text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2">
          {message}
          <button onClick={() => setMessage("")} className="ml-3 text-gray-400 hover:text-white">×</button>
        </div>
      )}

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 bg-blue-600 text-white rounded-xl sticky top-16 z-10 shadow-lg flex-wrap">
          <span className="font-bold">{selected.size}</span>
          <span className="text-blue-200 text-[11px] sm:text-sm">명 선택됨</span>
          <div className="h-5 w-px bg-blue-400" />
          <Button size="sm" onClick={sendSelected} disabled={sending} className="bg-white text-blue-700 hover:bg-blue-50 shadow-none h-7 text-[11px] sm:text-xs">
            {sending ? "발송 중..." : "Jon에게 발송"}
          </Button>
          <Button size="sm" onClick={markUpgraded} className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-none h-7 text-[11px] sm:text-xs">
            확정 처리
          </Button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-blue-200 hover:text-white text-[11px] sm:text-sm">취소</button>
          {message && <span className="text-sm text-green-300">{message}</span>}
        </div>
      )}

      {/* Main content: two-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">

        {/* Left: 공동구매팀 (8 cols) */}
        {(showSection === "all" || showSection === "teams") && (
          <div className={showSection === "teams" ? "col-span-1 md:col-span-12" : "col-span-1 md:col-span-8"}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-5 rounded-full bg-blue-500" />
              <h2 className="text-sm font-bold text-gray-900">공동구매팀</h2>
              <span className="text-xs text-gray-400">{teamGroups.length}팀 · {teamSchoolCount}교</span>
            </div>

            <div className={showSection === "teams" ? "grid grid-cols-1 lg:grid-cols-2 gap-3" : "space-y-3"}>
              {teamGroups.map(group => {
                const color = teamColors[group.name] || "#6b7280";
                const allConfirmed = group.teacherCount > 0 && group.confirmedCount === group.teacherCount;
                const groupRate = group.teacherCount > 0 ? Math.round((group.confirmedCount / group.teacherCount) * 100) : 0;

                return (
                  <div key={group.name} className="bg-white rounded-xl border overflow-hidden">
                    {/* Team header - always visible */}
                    <div className="px-3 sm:px-4 py-3 flex items-center gap-3" style={{ borderLeft: `3px solid ${color}` }}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-gray-900">{group.name}</h3>
                          {allConfirmed ? (
                            <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">완성</span>
                          ) : (
                            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">진행중</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-gray-400">{group.schools.length}교 · {group.confirmedCount}/{group.teacherCount}명</span>
                          <div className="w-16 h-1 rounded-full bg-gray-100 overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${groupRate}%`, backgroundColor: color }} />
                          </div>
                          <span className="text-[10px] text-gray-400">{groupRate}%</span>
                        </div>
                      </div>

                      {/* Quick actions */}
                      <div className="flex items-center gap-1">
                        <button onClick={() => copyEmails(group.schools.flatMap(s => s.teachers.map(t => t.email)), group.name)}
                          className="text-[10px] text-gray-400 hover:text-blue-600 bg-gray-50 hover:bg-blue-50 px-2 py-1 rounded transition-colors">
                          {copied === group.name ? "복사됨!" : "이메일"}
                        </button>
                        {(() => {
                          const ids = pendingIds(group.schools.flatMap(s => s.teachers));
                          if (ids.length === 0) return null;
                          return (
                            <button onClick={() => confirmSend(group.name, ids)} disabled={sending}
                              className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded transition-colors disabled:opacity-40">
                              Jon {ids.length}
                            </button>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Schools list - always expanded */}
                    <div className="border-t divide-y divide-gray-50">
                      {group.schools.map(school => renderSchoolRow(school, true))}
                    </div>
                  </div>
                );
              })}
            </div>

            {teamGroups.length === 0 && (
              <p className="text-center text-gray-400 text-sm py-8">검색 결과 없음</p>
            )}
          </div>
        )}

        {/* Right: 개별 학교 (4 cols) */}
        {(showSection === "all" || showSection === "individual") && (
          <div className={showSection === "individual" ? "col-span-1 md:col-span-12" : "col-span-1 md:col-span-4"}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-5 rounded-full bg-gray-400" />
              <h2 className="text-sm font-bold text-gray-900">개별 학교</h2>
              <span className="text-xs text-gray-400">{individualSchools.length}교</span>
            </div>

            <div className="bg-white rounded-xl border overflow-hidden">
                <div className={`divide-y divide-gray-50 ${showSection === "all" ? "max-h-[calc(100vh-200px)] overflow-y-auto" : ""}`}>
                {individualSchools.map(school => renderSchoolRow(school))}
              </div>

              {individualSchools.length === 0 && (
                <p className="text-center text-gray-400 text-xs py-6">검색 결과 없음</p>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

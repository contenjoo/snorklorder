"use client";

import { useState, useMemo } from "react";
import { useSchoolData } from "@/lib/use-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

const teamColorMap: Record<string, { bg: string; text: string; dot: string }> = {
  "서울1팀": { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
  "서울4팀": { bg: "bg-blue-50", text: "text-blue-600", dot: "bg-blue-400" },
  "서울 (개별)": { bg: "bg-sky-50", text: "text-sky-700", dot: "bg-sky-500" },
  "경기2팀": { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  "경기3팀": { bg: "bg-green-50", text: "text-green-700", dot: "bg-green-500" },
  "경기5팀": { bg: "bg-teal-50", text: "text-teal-700", dot: "bg-teal-500" },
  "경기 (개별)": { bg: "bg-lime-50", text: "text-lime-700", dot: "bg-lime-500" },
  "인천 (개별)": { bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500" },
  "대전 (개별)": { bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-500" },
  "부산 (개별)": { bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-500" },
  "울산 (개별)": { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  "경남 (개별)": { bg: "bg-teal-50", text: "text-teal-700", dot: "bg-teal-500" },
};

type ViewMode = "grid" | "table";

export default function SchoolsPage() {
  const { schools, refresh: load } = useSchoolData();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filterRegion, setFilterRegion] = useState("all");
  const [filterTeam, setFilterTeam] = useState("all");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortBy, setSortBy] = useState<"name" | "teachers" | "recent">("teachers");

  // Add school form
  const [open, setOpen] = useState(false);
  const [fname, setFname] = useState("");
  const [fnameEn, setFnameEn] = useState("");
  const [fcode, setFcode] = useState("");
  const [fdomain, setFdomain] = useState("");
  const [fregion, setFregion] = useState("");
  const [fteam, setFteam] = useState("");
  const [ferror, setFerror] = useState("");
  const [translating, setTranslating] = useState(false);

  const filtered = useMemo(() => {
    let result = schools.filter((s) => {
      if (filterRegion !== "all" && s.region !== filterRegion) return false;
      if (filterTeam !== "all") {
        if (filterTeam === "none" && s.team) return false;
        if (filterTeam !== "none" && s.team !== filterTeam) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const matchSchool = s.name.toLowerCase().includes(q) || (s.nameEn || "").toLowerCase().includes(q) || s.code.toLowerCase().includes(q);
        const matchTeacher = s.teachers.some((t) => t.name.toLowerCase().includes(q) || t.email.toLowerCase().includes(q));
        if (!matchSchool && !matchTeacher) return false;
      }
      return true;
    });
    if (sortBy === "teachers") result.sort((a, b) => b.teachers.length - a.teachers.length);
    else if (sortBy === "recent") result.sort((a, b) => {
      const aMax = Math.max(...a.teachers.map(t => new Date(t.createdAt).getTime()), 0);
      const bMax = Math.max(...b.teachers.map(t => new Date(t.createdAt).getTime()), 0);
      return bMax - aMax;
    });
    else result.sort((a, b) => (a.nameEn || a.name).localeCompare(b.nameEn || b.name));
    return result;
  }, [schools, filterRegion, filterTeam, search, sortBy]);

  const allTeams = useMemo(() => {
    const t = new Set<string>();
    schools.forEach((s) => { if (s.team) t.add(s.team); });
    return Array.from(t).sort();
  }, [schools]);

  const totalTeachers = filtered.reduce((s, sc) => s + sc.teachers.length, 0);
  const regionStats = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach(s => {
      const r = s.region || "기타";
      map.set(r, (map.get(r) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleTeacher(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSchoolTeachers(school: School) {
    const ids = school.teachers.map((t) => t.id);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }
  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  }
  async function sendSelected() {
    if (selected.size === 0) return;
    setSending(true); setMessage("");
    try {
      const res = await fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teacherIds: Array.from(selected) }) });
      const data = await res.json();
      if (data.success) { setMessage(`${selected.size}명 이메일 발송 완료`); setSelected(new Set()); load(); }
      else setMessage("발송 실패: " + (data.error || ""));
    } catch { setMessage("연결 오류"); } finally { setSending(false); }
  }
  async function markUpgraded() {
    if (selected.size === 0) return;
    await fetch("/api/teachers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selected), status: "upgraded" }) });
    setSelected(new Set()); load();
  }
  async function addSchool() {
    setFerror("");
    if (!fname.trim() || !fcode.trim()) { setFerror("Name and code required"); return; }
    const res = await fetch("/api/schools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: fname.trim(), nameEn: fnameEn.trim() || null, code: fcode.trim().toUpperCase(), domain: fdomain.trim() || null, region: fregion || null, team: fteam.trim() || null }) });
    if (!res.ok) { const d = await res.json(); setFerror(d.error || "Failed"); return; }
    setFname(""); setFnameEn(""); setFcode(""); setFdomain(""); setFregion(""); setFteam("");
    setOpen(false); load();
  }
  async function translateName(korean: string) {
    if (!korean.trim()) return;
    setTranslating(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: korean.trim() }),
      });
      const data = await res.json();
      if (data.translated) {
        setFnameEn(data.translated);
        // Auto-generate code from English name
        const code = data.translated
          .replace(/\b(elementary|middle|high|school|university|college)\b/gi, "")
          .trim()
          .split(/\s+/)
          .map((w: string) => w.toUpperCase())
          .join("")
          .replace(/[^A-Z]/g, "")
          .slice(0, 12);
        if (code && !fcode) setFcode(code);
      }
    } catch {} finally { setTranslating(false); }
  }

  async function deleteSchool(id: number) {
    if (!confirm("이 학교와 소속 교사를 모두 삭제할까요?")) return;
    await fetch(`/api/schools?id=${id}`, { method: "DELETE" }); load();
  }

  return (
    <div className="space-y-5">
      {/* Header with stats ribbon */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">학교 관리</h1>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-sm text-gray-500"><b className="text-gray-900">{filtered.length}</b>교</span>
            <span className="w-1 h-1 rounded-full bg-gray-300" />
            <span className="text-sm text-gray-500"><b className="text-gray-900">{totalTeachers}</b>명</span>
            {regionStats.length > 0 && (
              <>
                <span className="w-1 h-1 rounded-full bg-gray-300" />
                <div className="flex gap-1.5">
                  {regionStats.slice(0, 5).map(([r, c]) => (
                    <button key={r} onClick={() => setFilterRegion(filterRegion === r ? "all" : r)}
                      className={`text-xs px-2 py-0.5 rounded-full transition-all ${filterRegion === r ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                      {r} {c}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={
            <Button className="shadow-sm">
              <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" /></svg>
              학교 추가
            </Button>
          } />
          <DialogContent>
            <DialogHeader><DialogTitle>학교 추가</DialogTitle></DialogHeader>
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
              <Button onClick={addSchool} className="w-full">추가</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
          <Input placeholder="학교명, 코드, 교사 검색..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterTeam} onValueChange={(v) => setFilterTeam(v ?? "all")}>
          <SelectTrigger className="w-36"><SelectValue placeholder="전체 팀" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 팀</SelectItem>
            {allTeams.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            <SelectItem value="none">미배정</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center rounded-lg border bg-white p-0.5 gap-0.5 ml-auto">
          {(["teachers", "name", "recent"] as const).map(s => (
            <button key={s} onClick={() => setSortBy(s)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${sortBy === s ? "bg-gray-100 text-gray-900" : "text-gray-400 hover:text-gray-700"}`}>
              {s === "teachers" ? "교사수순" : s === "name" ? "가나다순" : "최근순"}
            </button>
          ))}
        </div>
        <div className="flex items-center rounded-lg border bg-white p-0.5 gap-0.5">
          <button onClick={() => setViewMode("grid")} className={`p-1.5 rounded-md transition-all ${viewMode === "grid" ? "bg-gray-100" : "hover:bg-gray-50"}`}>
            <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>
          </button>
          <button onClick={() => setViewMode("table")} className={`p-1.5 rounded-md transition-all ${viewMode === "table" ? "bg-gray-100" : "hover:bg-gray-50"}`}>
            <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" /></svg>
          </button>
        </div>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-blue-600 text-white rounded-xl sticky top-16 z-10 shadow-lg">
          <span className="font-bold">{selected.size}</span>
          <span className="text-blue-200 text-sm">명 선택됨</span>
          <div className="h-5 w-px bg-blue-400" />
          <Button size="sm" onClick={sendSelected} disabled={sending} className="bg-white text-blue-700 hover:bg-blue-50 shadow-none">
            {sending ? "발송 중..." : "Jon에게 발송"}
          </Button>
          <Button size="sm" onClick={markUpgraded} className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-none">
            업그레이드 처리
          </Button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-blue-200 hover:text-white text-sm">취소</button>
          {message && <span className="text-sm text-green-300">{message}</span>}
        </div>
      )}

      {/* Grid View */}
      {viewMode === "grid" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((school) => {
            const isOpen = expanded.has(school.id);
            const tc = teamColorMap[school.team || ""] || { bg: "bg-gray-50", text: "text-gray-600", dot: "bg-gray-400" };
            const pendingC = school.teachers.filter(t => t.status === "pending").length;
            const upgC = school.teachers.filter(t => t.status === "upgraded").length;
            const allChecked = school.teachers.length > 0 && school.teachers.every(t => selected.has(t.id));

            return (
              <div key={school.id} className={`bg-white rounded-xl border transition-all ${isOpen ? "ring-2 ring-blue-200 shadow-md" : "hover:shadow-md"}`}>
                {/* Card header */}
                <div className="p-4 cursor-pointer" onClick={() => toggleExpand(school.id)}>
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900 truncate">{school.nameEn || school.name}</h3>
                        {pendingC > 0 && <span className="shrink-0 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
                      </div>
                      {school.nameEn && <p className="text-xs text-gray-400 mt-0.5 truncate">{school.name}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <span className="text-lg font-bold text-gray-900">{school.teachers.length}</span>
                      <span className="text-xs text-gray-400">명</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={(e) => { e.stopPropagation(); copyCode(school.code); }}
                      className="font-mono text-xs bg-gray-100 px-2 py-1 rounded-md hover:bg-gray-200 transition-colors">
                      {school.code}
                      {copied === school.code && <span className="ml-1 text-green-600">copied</span>}
                    </button>
                    {school.region && <span className="text-xs text-gray-400">{school.region}</span>}
                    {school.team && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${tc.bg} ${tc.text}`}>{school.team}</span>
                    )}
                    <div className="flex-1" />
                    {/* Mini progress bar */}
                    {school.teachers.length > 0 && (
                      <div className="flex h-1.5 w-16 rounded-full overflow-hidden bg-gray-100">
                        {upgC > 0 && <div className="bg-emerald-400" style={{ width: `${(upgC / school.teachers.length) * 100}%` }} />}
                        {pendingC > 0 && <div className="bg-amber-400" style={{ width: `${(pendingC / school.teachers.length) * 100}%` }} />}
                      </div>
                    )}
                  </div>
                </div>

                {/* Expanded teacher list */}
                {isOpen && (
                  <div className="border-t">
                    {school.teachers.length === 0 ? (
                      <p className="text-center text-gray-400 text-sm py-6">등록된 교사 없음</p>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50/80">
                          <input type="checkbox" checked={allChecked} onChange={() => toggleSchoolTeachers(school)} className="rounded" />
                          <span className="text-xs text-gray-500">전체 선택 ({school.teachers.length}명)</span>
                        </div>
                        <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                          {school.teachers.map((t) => (
                            <label key={t.id} className={`flex items-center gap-2.5 px-4 py-2 cursor-pointer hover:bg-blue-50/40 transition-colors ${selected.has(t.id) ? "bg-blue-50/60" : ""}`}>
                              <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleTeacher(t.id)} className="rounded" />
                              <span className={`w-2 h-2 rounded-full shrink-0 ${t.status === "upgraded" ? "bg-emerald-400" : t.status === "pending" ? "bg-amber-400" : t.status === "sent" ? "bg-blue-400" : t.status === "individual" ? "bg-purple-400" : "bg-gray-300"}`} />
                              <span className="text-sm text-gray-700 w-20 truncate">{t.name}</span>
                              <span className="text-xs text-gray-500 font-mono truncate flex-1">{t.email}</span>
                              <span className={`text-[10px] uppercase tracking-wider font-medium ${t.status === "upgraded" ? "text-emerald-500" : t.status === "pending" ? "text-amber-600" : t.status === "individual" ? "text-purple-500" : "text-gray-400"}`}>
                                {t.status}
                              </span>
                            </label>
                          ))}
                        </div>
                        <div className="flex items-center justify-between px-4 py-2 bg-gray-50/80 border-t">
                          <button onClick={() => copyCode(school.code)} className="text-xs text-blue-600 hover:underline">코드 복사</button>
                          <button onClick={() => deleteSchool(school.id)} className="text-xs text-red-400 hover:text-red-600">학교 삭제</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Table View */}
      {viewMode === "table" && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3 font-medium">학교</th>
                <th className="px-4 py-3 font-medium">코드</th>
                <th className="px-4 py-3 font-medium">지역</th>
                <th className="px-4 py-3 font-medium">팀</th>
                <th className="px-4 py-3 font-medium text-right">교사수</th>
                <th className="px-4 py-3 font-medium text-right">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((school) => {
                const tc = teamColorMap[school.team || ""] || { bg: "bg-gray-50", text: "text-gray-600", dot: "bg-gray-400" };
                const pendingC = school.teachers.filter(t => t.status === "pending" || t.status === "sent").length;
                return (
                  <tr key={school.id} className="hover:bg-gray-50/80 cursor-pointer transition-colors" onClick={() => toggleExpand(school.id)}>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-gray-900">{school.nameEn || school.name}</p>
                        {school.nameEn && <p className="text-xs text-gray-400">{school.name}</p>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={(e) => { e.stopPropagation(); copyCode(school.code); }}
                        className="font-mono text-xs bg-gray-100 px-2 py-1 rounded hover:bg-gray-200">
                        {school.code}{copied === school.code && " ✓"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{school.region || "-"}</td>
                    <td className="px-4 py-3">
                      {school.team ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${tc.bg} ${tc.text}`}>{school.team}</span>
                      ) : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{school.teachers.length}</td>
                    <td className="px-4 py-3 text-right">
                      {pendingC > 0 ? (
                        <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">{pendingC} 대기</span>
                      ) : school.teachers.length > 0 ? (
                        <span className="text-xs text-emerald-500">완료</span>
                      ) : (
                        <span className="text-xs text-gray-300">교사 없음</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length === 0 && <p className="text-center text-gray-400 py-16 text-sm">검색 결과 없음</p>}
    </div>
  );
}

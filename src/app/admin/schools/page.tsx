"use client";

import { useState, useMemo } from "react";
import { useSchoolData } from "@/lib/use-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
  "서울1팀": "bg-blue-100 text-blue-800",
  "서울4팀": "bg-blue-50 text-blue-700",
  "서울 (개별)": "bg-sky-50 text-sky-700",
  "경기2팀": "bg-green-100 text-green-800",
  "경기3팀": "bg-green-50 text-green-700",
  "경기5팀": "bg-emerald-100 text-emerald-800",
  "경기 (개별)": "bg-lime-50 text-lime-700",
  "인천 (개별)": "bg-violet-100 text-violet-800",
  "대전 (개별)": "bg-orange-100 text-orange-800",
  "부산 (개별)": "bg-rose-50 text-rose-700",
  "울산 (개별)": "bg-amber-50 text-amber-700",
  "경남 (개별)": "bg-teal-50 text-teal-700",
};

const statusDot: Record<string, string> = {
  pending: "bg-yellow-400",
  sent: "bg-blue-400",
  upgraded: "bg-green-400",
};

export default function SchoolsPage() {
  const { schools, refresh: load } = useSchoolData();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set()); // teacher ids
  const [filterRegion, setFilterRegion] = useState("all");
  const [filterTeam, setFilterTeam] = useState("all");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  // Add school form
  const [open, setOpen] = useState(false);
  const [fname, setFname] = useState("");
  const [fnameEn, setFnameEn] = useState("");
  const [fcode, setFcode] = useState("");
  const [fdomain, setFdomain] = useState("");
  const [fregion, setFregion] = useState("");
  const [fteam, setFteam] = useState("");
  const [ferror, setFerror] = useState("");

  // Filter
  const filtered = useMemo(() => {
    return schools.filter((s) => {
      if (filterRegion !== "all" && s.region !== filterRegion) return false;
      if (filterTeam !== "all") {
        if (filterTeam === "none" && s.team) return false;
        if (filterTeam !== "none" && s.team !== filterTeam) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const matchSchool = s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q);
        const matchTeacher = s.teachers.some(
          (t) => t.name.toLowerCase().includes(q) || t.email.toLowerCase().includes(q)
        );
        if (!matchSchool && !matchTeacher) return false;
      }
      return true;
    });
  }, [schools, filterRegion, filterTeam, search]);

  // Group by team
  const grouped = useMemo(() => {
    const groups = new Map<string, School[]>();
    for (const s of filtered) {
      const key = s.team || "미배정";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    return Array.from(groups.entries()).sort(([a], [b]) =>
      a === "미배정" ? 1 : b === "미배정" ? -1 : a.localeCompare(b)
    );
  }, [filtered]);

  // All unique teams for filter
  const allTeams = useMemo(() => {
    const t = new Set<string>();
    schools.forEach((s) => { if (s.team) t.add(s.team); });
    return Array.from(t).sort();
  }, [schools]);

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTeacher(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSchoolTeachers(school: School) {
    const ids = school.teachers.map((t) => t.id);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
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
    setSending(true);
    setMessage("");
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherIds: Array.from(selected) }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`${selected.size}명 이메일 발송 완료`);
        setSelected(new Set());
        load();
      } else {
        setMessage("발송 실패: " + (data.error || ""));
      }
    } catch {
      setMessage("연결 오류");
    } finally {
      setSending(false);
    }
  }

  async function markUpgraded() {
    if (selected.size === 0) return;
    await fetch("/api/teachers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected), status: "upgraded" }),
    });
    setSelected(new Set());
    load();
  }

  async function addSchool() {
    setFerror("");
    if (!fname.trim() || !fcode.trim()) { setFerror("Name and code required"); return; }
    const res = await fetch("/api/schools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: fname.trim(), nameEn: fnameEn.trim() || null, code: fcode.trim().toUpperCase(), domain: fdomain.trim() || null, region: fregion || null, team: fteam.trim() || null }),
    });
    if (!res.ok) { const d = await res.json(); setFerror(d.error || "Failed"); return; }
    setFname(""); setFnameEn(""); setFcode(""); setFdomain(""); setFregion(""); setFteam("");
    setOpen(false);
    load();
  }

  async function deleteSchool(id: number) {
    if (!confirm("이 학교와 소속 교사를 모두 삭제할까요?")) return;
    await fetch(`/api/schools?id=${id}`, { method: "DELETE" });
    load();
  }

  const totalFiltered = filtered.reduce((s, sc) => s + sc.teachers.length, 0);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold">학교 관리 <span className="text-gray-400 font-normal text-sm ml-2">{filtered.length}교 {totalFiltered}명</span></h2>
        <div className="flex gap-2 flex-wrap">
          <Input
            placeholder="학교/교사 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48"
          />
          <Select value={filterRegion} onValueChange={(v) => setFilterRegion(v ?? "all")}>
            <SelectTrigger className="w-28"><SelectValue placeholder="지역" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 지역</SelectItem>
              {REGIONS.filter((r) => schools.some((s) => s.region === r)).map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterTeam} onValueChange={(v) => setFilterTeam(v ?? "all")}>
            <SelectTrigger className="w-32"><SelectValue placeholder="팀" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 팀</SelectItem>
              {allTeams.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
              <SelectItem value="none">미배정</SelectItem>
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 h-9 px-4 py-2 cursor-pointer">
              + 학교 추가
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>학교 추가</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>학교명 (한국어) *</Label>
                  <Input placeholder="예: 효명고등학교" value={fname} onChange={(e) => setFname(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>School Name (English)</Label>
                  <Input placeholder="e.g. Hyo-Myeong High School" value={fnameEn} onChange={(e) => setFnameEn(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>코드 *</Label>
                  <Input placeholder="예: HYOMYEONG" value={fcode} onChange={(e) => setFcode(e.target.value.toUpperCase())} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>지역</Label>
                    <Select value={fregion} onValueChange={(v) => setFregion(v ?? "")}>
                      <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                      <SelectContent>{REGIONS.map((r) => (<SelectItem key={r} value={r}>{r}</SelectItem>))}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>팀</Label>
                    <Input placeholder="예: 서울1팀" value={fteam} onChange={(e) => setFteam(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>도메인 (선택)</Label>
                  <Input placeholder="예: hmh.or.kr" value={fdomain} onChange={(e) => setFdomain(e.target.value)} />
                </div>
                {ferror && <p className="text-sm text-red-600">{ferror}</p>}
                <Button onClick={addSchool} className="w-full">추가</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border border-blue-200 sticky top-16 z-10">
          <span className="text-sm font-semibold text-blue-800">{selected.size}명 선택</span>
          <Button size="sm" onClick={sendSelected} disabled={sending}>
            {sending ? "발송 중..." : "Jon에게 보내기"}
          </Button>
          <Button size="sm" variant="outline" onClick={markUpgraded}>Upgraded 처리</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>취소</Button>
          {message && <span className={`text-xs ml-2 ${message.includes("완료") ? "text-green-600" : "text-red-600"}`}>{message}</span>}
        </div>
      )}

      {/* Grouped cards */}
      {grouped.map(([teamName, teamSchools]) => {
        const teamTeacherCount = teamSchools.reduce((s, sc) => s + sc.teachers.length, 0);
        return (
          <div key={teamName} className="space-y-3">
            {/* Team header */}
            <div className="flex items-center gap-2 pt-2">
              <Badge className={`${teamColors[teamName] || "bg-gray-100 text-gray-700"} text-xs`}>
                {teamName}
              </Badge>
              <span className="text-xs text-gray-500">{teamSchools.length}교 {teamTeacherCount}명</span>
              <div className="flex-1 border-t border-gray-200" />
            </div>

            {/* School cards */}
            <div className="grid gap-3 md:grid-cols-2">
              {teamSchools.map((school) => {
                const isOpen = expanded.has(school.id);
                const pendingC = school.teachers.filter((t) => t.status === "pending").length;
                const sentC = school.teachers.filter((t) => t.status === "sent").length;
                const upgC = school.teachers.filter((t) => t.status === "upgraded").length;
                const allChecked = school.teachers.length > 0 && school.teachers.every((t) => selected.has(t.id));

                return (
                  <Card key={school.id} className={`overflow-hidden transition-shadow hover:shadow-md ${isOpen ? "ring-1 ring-blue-200" : ""}`}>
                    {/* Card header - always visible */}
                    <div
                      className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
                      onClick={() => toggleExpand(school.id)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-gray-400 text-xs">{isOpen ? "▼" : "▶"}</span>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{school.name}</p>
                          {school.nameEn && <p className="text-[11px] text-gray-400 truncate">{school.nameEn}</p>}
                          <div className="flex items-center gap-2 mt-0.5">
                            <button
                              onClick={(e) => { e.stopPropagation(); copyCode(school.code); }}
                              className="font-mono text-[11px] bg-gray-100 px-1.5 py-0.5 rounded hover:bg-gray-200"
                            >
                              {school.code}
                              {copied === school.code && <span className="ml-1 text-green-600">✓</span>}
                            </button>
                            {school.region && <span className="text-[11px] text-gray-400">{school.region}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {pendingC > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700">{pendingC}</span>}
                        {sentC > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">{sentC}</span>}
                        {upgC > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">{upgC}</span>}
                        <span className="text-xs text-gray-500 ml-1">{school.teachers.length}명</span>
                      </div>
                    </div>

                    {/* Expanded: teacher list */}
                    {isOpen && (
                      <div className="border-t bg-gray-50/50">
                        {school.teachers.length === 0 ? (
                          <p className="text-center text-gray-400 text-xs py-4">등록된 교사가 없습니다</p>
                        ) : (
                          <>
                            {/* Select all */}
                            <div className="flex items-center gap-2 px-4 py-2 border-b bg-white">
                              <input
                                type="checkbox"
                                checked={allChecked}
                                onChange={() => toggleSchoolTeachers(school)}
                                className="rounded"
                              />
                              <span className="text-xs text-gray-500">전체 선택 ({school.teachers.length}명)</span>
                            </div>
                            {/* Teachers */}
                            <div className="divide-y max-h-64 overflow-y-auto">
                              {school.teachers.map((t) => (
                                <div key={t.id} className="flex items-center gap-2 px-4 py-1.5 hover:bg-gray-100/50">
                                  <input
                                    type="checkbox"
                                    checked={selected.has(t.id)}
                                    onChange={() => toggleTeacher(t.id)}
                                    className="rounded"
                                  />
                                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[t.status]}`} />
                                  <span className="text-xs font-medium w-24 truncate">{t.name}</span>
                                  <span className="text-[11px] text-gray-500 font-mono truncate flex-1">{t.email}</span>
                                  {t.subject && <span className="text-[10px] text-gray-400 shrink-0">{t.subject}</span>}
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                        {/* Card footer */}
                        <div className="flex items-center justify-between px-4 py-2 border-t bg-white">
                          <button
                            onClick={() => copyCode(school.code)}
                            className="text-[11px] text-blue-600 hover:underline"
                          >
                            코드 복사
                          </button>
                          <button
                            onClick={() => deleteSchool(school.id)}
                            className="text-[11px] text-red-400 hover:text-red-600"
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <p className="text-center text-gray-400 py-12">검색 결과가 없습니다</p>
      )}
    </div>
  );
}

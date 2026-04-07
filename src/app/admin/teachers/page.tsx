"use client";

import { useState, useMemo } from "react";
import { useSchoolData } from "@/lib/use-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
  nameEn: string | null;
  code: string;
  region: string | null;
  team: string | null;
  teacherCount: number;
  teachers: Teacher[];
}

const statusConfig: Record<string, { label: string; dot: string; bg: string }> = {
  pending: { label: "Pending", dot: "bg-yellow-400", bg: "bg-yellow-50 text-yellow-800" },
  sent: { label: "Sent", dot: "bg-blue-400", bg: "bg-blue-50 text-blue-800" },
  upgraded: { label: "Upgraded", dot: "bg-green-400", bg: "bg-green-50 text-green-800" },
};

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
  "경남 (개별)": "bg-teal-50 text-teal-700",
};

export default function TeachersPage() {
  const { schools, refresh: load } = useSchoolData();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  // Filter schools that have teachers, apply search/status filter
  const filteredSchools = useMemo(() => {
    return schools
      .map((s) => {
        let teachers = s.teachers;
        if (filterStatus !== "all") {
          teachers = teachers.filter((t) => t.status === filterStatus);
        }
        if (search) {
          const q = search.toLowerCase();
          teachers = teachers.filter(
            (t) => t.name.toLowerCase().includes(q) || t.email.toLowerCase().includes(q)
          );
        }
        return { ...s, teachers };
      })
      .filter((s) => s.teachers.length > 0);
  }, [schools, search, filterStatus]);

  const totalTeachers = filteredSchools.reduce((s, sc) => s + sc.teachers.length, 0);

  function toggleTeacher(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSchool(school: School) {
    const ids = school.teachers.map((t) => t.id);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  }

  function selectAll() {
    const allIds = filteredSchools.flatMap((s) => s.teachers.map((t) => t.id));
    const allSelected = allIds.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(allIds));
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
      setMessage(data.success ? `${selected.size}명 이메일 발송 완료!` : "발송 실패");
      if (data.success) { setSelected(new Set()); load(); }
    } catch { setMessage("연결 오류"); }
    finally { setSending(false); }
  }

  async function markStatus(status: string) {
    if (selected.size === 0) return;
    await fetch("/api/teachers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected), status }),
    });
    setSelected(new Set());
    load();
  }

  function downloadCSV() {
    const allTeachers = filteredSchools.flatMap((s) =>
      s.teachers.map((t) => [s.name, s.nameEn || "", t.name, t.email, t.subject || "", t.status].join(","))
    );
    const csv = ["School (KR),School (EN),Name,Email,Subject,Status", ...allTeachers].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `snorkl-teachers-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold">
          교사 전체 <span className="text-gray-400 font-normal text-sm ml-2">{filteredSchools.length}교 {totalTeachers}명</span>
        </h2>
        <div className="flex gap-2 flex-wrap">
          <Input
            placeholder="이름/이메일 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48"
          />
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v ?? "all")}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 상태</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="upgraded">Upgraded</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={selectAll}>
            {filteredSchools.flatMap((s) => s.teachers).every((t) => selected.has(t.id)) && totalTeachers > 0
              ? "전체 해제" : "전체 선택"}
          </Button>
          <Button variant="outline" size="sm" onClick={downloadCSV}>CSV</Button>
        </div>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border border-blue-200 sticky top-16 z-10 flex-wrap">
          <span className="text-sm font-semibold text-blue-800">{selected.size}명 선택</span>
          <div className="h-5 w-px bg-blue-200" />
          <Button size="sm" onClick={sendSelected} disabled={sending}>
            {sending ? "발송 중..." : "📧 Jon에게 보내기"}
          </Button>
          <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => markStatus("upgraded")}>
            ✅ 일괄 업그레이드 완료
          </Button>
          <div className="h-5 w-px bg-blue-200" />
          <Button size="sm" variant="outline" onClick={() => markStatus("sent")}>Sent 처리</Button>
          <Button size="sm" variant="outline" onClick={() => markStatus("pending")}>Pending 처리</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>취소</Button>
          {message && <span className={`text-xs ml-2 ${message.includes("완료") ? "text-green-600" : "text-red-600"}`}>{message}</span>}
        </div>
      )}

      {/* School cards with teachers */}
      <div className="grid gap-4">
        {filteredSchools.map((school) => {
          const allChecked = school.teachers.every((t) => selected.has(t.id));
          const someChecked = school.teachers.some((t) => selected.has(t.id));
          const pendingC = school.teachers.filter((t) => t.status === "pending").length;
          const sentC = school.teachers.filter((t) => t.status === "sent").length;
          const upgC = school.teachers.filter((t) => t.status === "upgraded").length;

          return (
            <Card key={school.id} className="overflow-hidden">
              {/* School header */}
              <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                    onChange={() => toggleSchool(school)}
                    className="rounded"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{school.name}</span>
                      {school.team && (
                        <Badge className={`text-[10px] px-1.5 py-0 ${teamColors[school.team] || "bg-gray-100 text-gray-600"}`}>
                          {school.team}
                        </Badge>
                      )}
                    </div>
                    {school.nameEn && (
                      <span className="text-xs text-gray-400">{school.nameEn}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {pendingC > 0 && <Badge className="bg-yellow-50 text-yellow-700 text-[10px]">{pendingC} pending</Badge>}
                  {sentC > 0 && <Badge className="bg-blue-50 text-blue-700 text-[10px]">{sentC} sent</Badge>}
                  {upgC > 0 && <Badge className="bg-green-50 text-green-700 text-[10px]">{upgC} upgraded</Badge>}
                </div>
              </div>

              {/* Teacher rows */}
              <CardContent className="p-0">
                <div className="divide-y">
                  {school.teachers.map((t, idx) => {
                    const sc = statusConfig[t.status] || statusConfig.pending;
                    return (
                      <div
                        key={t.id}
                        className={`flex items-center gap-3 px-5 py-2 hover:bg-gray-50 transition-colors ${
                          selected.has(t.id) ? "bg-blue-50/50" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(t.id)}
                          onChange={() => toggleTeacher(t.id)}
                          className="rounded"
                        />
                        <span className="text-xs text-gray-300 w-5 text-right">{idx + 1}</span>
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${sc.dot}`} />
                        <span className="text-sm font-medium w-36 truncate">{t.name}</span>
                        <span className="text-sm text-gray-500 font-mono flex-1 truncate">{t.email}</span>
                        <span className="text-xs text-gray-400 w-20 truncate">{t.subject || ""}</span>
                        <Badge className={`text-[10px] px-1.5 py-0 ${sc.bg}`}>{sc.label}</Badge>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredSchools.length === 0 && (
        <p className="text-center text-gray-400 py-12">교사가 등록된 학교가 없습니다</p>
      )}
    </div>
  );
}

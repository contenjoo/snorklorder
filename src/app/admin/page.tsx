"use client";

import Link from "next/link";
import { useSchoolData } from "@/lib/use-data";
import { useState, useMemo } from "react";

const teamColorMap: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  "서울1팀": { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500", border: "border-blue-200" },
  "서울4팀": { bg: "bg-blue-50", text: "text-blue-600", dot: "bg-blue-400", border: "border-blue-200" },
  "경기2팀": { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", border: "border-emerald-200" },
  "경기3팀": { bg: "bg-green-50", text: "text-green-700", dot: "bg-green-500", border: "border-green-200" },
  "경기5팀": { bg: "bg-teal-50", text: "text-teal-700", dot: "bg-teal-500", border: "border-teal-200" },
};

export default function AdminDashboard() {
  const { schools, loading, refresh } = useSchoolData();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

  // Team groups (공동구매팀 only) - must be before conditional return
  const teamGroups = useMemo(() => {
    const map = new Map<string, typeof schools>();
    for (const s of schools) {
      if (s.team && !s.team.includes("개별") && s.team !== "미배정") {
        if (!map.has(s.team)) map.set(s.team, []);
        map.get(s.team)!.push(s);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [schools]);

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
    </div>
  );

  const allTeachers = schools.flatMap((s) => s.teachers);
  const totalSchools = schools.length;
  const totalTeachers = allTeachers.length;
  const upgradedCount = allTeachers.filter((t) => t.status === "upgraded").length;
  const individualCount = allTeachers.filter((t) => t.status === "individual").length;
  const pendingCount = allTeachers.filter((t) => t.status === "pending").length;
  const sentCount = allTeachers.filter((t) => t.status === "sent").length;
  const confirmedTotal = upgradedCount + individualCount;
  const upgradeRate = totalTeachers > 0 ? Math.round((confirmedTotal / totalTeachers) * 100) : 0;

  // Pending upgrade schools
  const upgradeNeeded = schools
    .map((s) => ({
      ...s,
      needTeachers: s.teachers.filter((t) => t.status === "pending" || t.status === "sent"),
    }))
    .filter((s) => s.needTeachers.length > 0)
    .sort((a, b) => b.needTeachers.length - a.needTeachers.length);

  const needUpgrade = pendingCount + sentCount;

  // Recent teachers
  const recentTeachers = [...allTeachers]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  async function sendAllPending() {
    const pendingTeacherIds = upgradeNeeded.flatMap((s) =>
      s.needTeachers.filter((t) => t.status === "pending").map((t) => t.id)
    );
    if (pendingTeacherIds.length === 0) return;
    setSending(true); setMessage("");
    try {
      const res = await fetch("/api/send-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherIds: pendingTeacherIds }),
      });
      const data = await res.json();
      setMessage(data.success ? `${pendingTeacherIds.length}명 Jon에게 발송 완료` : "발송 실패");
      if (data.success) refresh();
    } catch { setMessage("연결 오류"); } finally { setSending(false); }
  }

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      {/* Top stat strip */}
      <div className="grid grid-cols-2 gap-3 md:flex md:items-center md:gap-6 bg-white rounded-2xl border p-4 md:p-5">
        <div className="flex items-center gap-3 md:pr-6 md:border-r">
          <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342" /></svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{totalSchools}</p>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">학교</p>
          </div>
        </div>
        <div className="flex items-center gap-3 md:pr-6 md:border-r">
          <div className="w-10 h-10 rounded-xl bg-indigo-500 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{totalTeachers}</p>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">교사</p>
          </div>
        </div>
        <div className="flex items-center gap-3 md:pr-6 md:border-r">
          <div className="relative w-12 h-12">
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
              <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e5e7eb" strokeWidth="3" />
              <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#10b981" strokeWidth="3" strokeDasharray={`${upgradeRate}, 100`} strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-900">{upgradeRate}%</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">확정률</p>
            <p className="text-[10px] text-gray-400">{confirmedTotal} / {totalTeachers}</p>
          </div>
        </div>
        {needUpgrade > 0 ? (
          <div className="col-span-2 md:col-span-1 flex items-center gap-3 bg-amber-50 rounded-xl px-4 py-2.5 border border-amber-200">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /></svg>
            </div>
            <div>
              <p className="text-sm font-bold text-amber-900">{needUpgrade}명 처리 필요</p>
              <p className="text-[10px] text-amber-700">{pendingCount} 대기 · {sentCount} 발송됨</p>
            </div>
          </div>
        ) : (
          <div className="col-span-2 md:col-span-1 flex items-center gap-3 bg-emerald-50 rounded-xl px-4 py-2.5 border border-emerald-200">
            <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span className="text-sm font-semibold text-emerald-700">전원 확정 완료</span>
          </div>
        )}
        <div className="col-span-2 md:col-span-1 md:ml-auto flex gap-2">
          <Link href="/admin/schools" className="text-xs text-gray-500 hover:text-gray-900 border rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors">학교 관리</Link>
          <Link href="/admin/teachers" className="text-xs text-gray-500 hover:text-gray-900 border rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors">교사 관리</Link>
        </div>
      </div>

      {/* Main content: 2 columns */}
      <div className="grid lg:grid-cols-5 gap-6">
        {/* Left: Teams (3/5) */}
        <div className="lg:col-span-3 space-y-4">
          {/* 공동구매팀 */}
          <div className="bg-white rounded-2xl border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div className="flex items-center gap-3">
                <h2 className="font-bold text-gray-900">공동구매팀</h2>
                <span className="text-xs text-gray-400">{teamGroups.length}팀</span>
              </div>
              <Link href="/admin/schools" className="text-xs text-blue-600 hover:underline">전체 보기</Link>
            </div>
            <div className="divide-y">
              {teamGroups.map(([team, teamSchools]) => {
                const tc = teamColorMap[team] || { bg: "bg-gray-50", text: "text-gray-600", dot: "bg-gray-400", border: "border-gray-200" };
                const tCount = teamSchools.reduce((s, sc) => s + sc.teachers.length, 0);
                const tUpgraded = teamSchools.reduce((s, sc) => s + sc.teachers.filter(t => t.status === "upgraded" || t.status === "individual").length, 0);
                const rate = tCount > 0 ? Math.round((tUpgraded / tCount) * 100) : 0;
                const isOpen = expandedTeam === team;

                return (
                  <div key={team}>
                    <div className="flex flex-wrap md:flex-nowrap items-center gap-2 md:gap-4 px-4 md:px-5 py-3 md:py-3.5 cursor-pointer hover:bg-gray-50/80 transition-colors"
                      onClick={() => setExpandedTeam(isOpen ? null : team)}>
                      {/* Line 1 on mobile: dot + name + badge + chevron */}
                      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${tc.dot}`} />
                      <span className="font-semibold text-sm text-gray-900 w-20 shrink-0">{team}</span>
                      <div className="hidden md:flex items-center gap-1.5 flex-1 flex-wrap overflow-hidden">
                        {teamSchools.map(s => (
                          <span key={s.id} className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded truncate max-w-[100px]">{s.name}</span>
                        ))}
                      </div>
                      <span className="text-[10px] text-gray-400 md:hidden">{teamSchools.length}교</span>
                      <div className="ml-auto flex items-center gap-2 md:gap-2">
                        {rate === 100 ? (
                          <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">완성</span>
                        ) : (
                          <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">{rate}%</span>
                        )}
                        <svg className={`w-4 h-4 text-gray-300 transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                      {/* Line 2 on mobile: count + progress bar */}
                      <div className="flex md:hidden items-center gap-2 w-full pl-[22px]">
                        <span className="text-xs font-mono text-gray-500">{tUpgraded}/{tCount}</span>
                        <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${rate}%` }} />
                        </div>
                      </div>
                      {/* Desktop-only: count + progress (inline) */}
                      <span className="hidden md:inline text-xs font-mono text-gray-500">{tUpgraded}/{tCount}</span>
                      <div className="hidden md:block h-1.5 w-16 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${rate}%` }} />
                      </div>
                    </div>
                    {isOpen && (
                      <div className="bg-gray-50/60 border-t px-5 py-2 divide-y divide-gray-100">
                        {teamSchools.map(s => {
                          const sUpg = s.teachers.filter(t => t.status === "upgraded" || t.status === "individual").length;
                          return (
                            <div key={s.id} className="py-2">
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${sUpg === s.teachers.length && s.teachers.length > 0 ? "bg-emerald-400" : s.teachers.length > 0 ? "bg-amber-400" : "bg-gray-300"}`} />
                                <span className="text-xs font-medium text-gray-800">{s.name}</span>
                                <span className="text-[10px] text-gray-400">{s.nameEn}</span>
                                <span className="text-[10px] font-mono text-gray-400 ml-auto">{s.teachers.length}명</span>
                              </div>
                              {s.teachers.length > 0 && (
                                <div className="flex flex-wrap gap-1 ml-3.5">
                                  {s.teachers.map(t => (
                                    <span key={t.id} className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                      t.status === "upgraded" || t.status === "individual"
                                        ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                                        : t.status === "sent" ? "bg-blue-50 text-blue-600 border border-blue-200"
                                        : "bg-amber-50 text-amber-600 border border-amber-200"
                                    }`}>{t.email.split("@")[0]}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pending upgrades */}
          {needUpgrade > 0 && (
            <div className="bg-white rounded-2xl border overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 md:px-5 py-3 md:py-4 border-b">
                <div className="flex items-center gap-3">
                  <h2 className="font-bold text-gray-900">업그레이드 대기</h2>
                  <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">{needUpgrade}명</span>
                </div>
                <div className="flex items-center gap-2">
                  {pendingCount > 0 && (
                    <button onClick={sendAllPending} disabled={sending}
                      className="text-xs font-semibold bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors w-full sm:w-auto">
                      {sending ? "발송 중..." : `${pendingCount}명 Jon에게 발송`}
                    </button>
                  )}
                </div>
              </div>
              <div className="divide-y max-h-[400px] overflow-y-auto">
                {upgradeNeeded.map((school) => {
                  const tc = teamColorMap[school.team || ""] || { bg: "bg-gray-50", text: "text-gray-600", dot: "bg-gray-400", border: "border-gray-200" };
                  return (
                    <div key={school.id} className="px-4 md:px-5 py-3">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-2">
                        <span className="text-sm font-semibold text-gray-900">{school.nameEn || school.name}</span>
                        {school.nameEn && <span className="text-[10px] text-gray-400">{school.name}</span>}
                        {school.team && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${tc.bg} ${tc.text} border ${tc.border}`}>{school.team}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {school.needTeachers.map((t) => (
                          <span key={t.id}
                            className={`text-[10px] font-mono px-2 py-0.5 rounded-lg truncate max-w-[180px] sm:max-w-none ${
                              t.status === "pending" ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-blue-50 text-blue-700 border border-blue-200"
                            }`}
                            title={t.email}>
                            {t.email}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {message && (
                <div className={`px-5 py-2.5 text-sm font-medium border-t ${message.includes("완료") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                  {message}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Activity (2/5) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Quick summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-xl border p-4">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">공동구매</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{teamGroups.reduce((s, [, ts]) => s + ts.reduce((ss, sc) => ss + sc.teachers.length, 0), 0)}</p>
              <p className="text-[10px] text-gray-400 mt-1">{teamGroups.length}팀 · {teamGroups.reduce((s, [, ts]) => s + ts.length, 0)}교</p>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">개별구매</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{individualCount}</p>
              <p className="text-[10px] text-gray-400 mt-1">개별 계정 구매</p>
            </div>
          </div>

          {/* Recent activity */}
          <div className="bg-white rounded-2xl border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="font-bold text-gray-900">최근 등록</h2>
              <Link href="/admin/teachers" className="text-xs text-blue-600 hover:underline">전체 보기</Link>
            </div>
            <div className="divide-y">
              {recentTeachers.map((t) => {
                const school = schools.find((s) => s.id === t.schoolId);
                const sc: Record<string, string> = { upgraded: "bg-emerald-400", pending: "bg-amber-400", sent: "bg-blue-400", individual: "bg-purple-400" };
                return (
                  <div key={t.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-4 md:px-5 py-3 hover:bg-gray-50/80 transition-colors">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${sc[t.status] || "bg-gray-300"}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-gray-800 truncate">{t.name}</p>
                        <p className="text-[10px] text-gray-400 font-mono truncate">{t.email}</p>
                      </div>
                      <span className="sm:hidden text-[10px] text-gray-300 shrink-0">
                        {new Date(t.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pl-4 sm:pl-0 sm:block sm:text-right shrink-0">
                      <p className="text-[10px] text-gray-400 truncate max-w-[160px] sm:max-w-[120px]">{school?.name}</p>
                      <p className="hidden sm:block text-[10px] text-gray-300">
                        {new Date(t.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Region breakdown */}
          <div className="bg-white rounded-2xl border overflow-hidden">
            <div className="px-5 py-4 border-b">
              <h2 className="font-bold text-gray-900">지역별</h2>
            </div>
            <div className="px-5 py-3">
              {(() => {
                const regions = new Map<string, { schools: number; teachers: number }>();
                schools.forEach(s => {
                  const r = s.region || "기타";
                  if (!regions.has(r)) regions.set(r, { schools: 0, teachers: 0 });
                  const d = regions.get(r)!;
                  d.schools++;
                  d.teachers += s.teachers.length;
                });
                const entries = Array.from(regions.entries()).sort((a, b) => b[1].teachers - a[1].teachers);
                const maxTeachers = Math.max(...entries.map(([, d]) => d.teachers));
                return (
                  <div className="space-y-2">
                    {entries.slice(0, 6).map(([region, data]) => (
                      <div key={region} className="flex items-center gap-3">
                        <span className="text-xs text-gray-600 w-8">{region}</span>
                        <div className="flex-1 h-4 rounded-full bg-gray-50 overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-blue-100 to-blue-200 rounded-full flex items-center justify-end pr-2 transition-all"
                            style={{ width: `${(data.teachers / maxTeachers) * 100}%`, minWidth: '40px' }}>
                            <span className="text-[9px] font-medium text-blue-700">{data.teachers}</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-gray-400 w-8 text-right">{data.schools}교</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useSchoolData } from "@/lib/use-data";
import { useState } from "react";

const teamColorMap: Record<string, { bg: string; text: string }> = {
  "서울1팀": { bg: "bg-blue-50", text: "text-blue-700" },
  "서울4팀": { bg: "bg-blue-50", text: "text-blue-600" },
  "서울 (개별)": { bg: "bg-sky-50", text: "text-sky-700" },
  "경기2팀": { bg: "bg-emerald-50", text: "text-emerald-700" },
  "경기3팀": { bg: "bg-green-50", text: "text-green-700" },
  "경기5팀": { bg: "bg-teal-50", text: "text-teal-700" },
  "경기 (개별)": { bg: "bg-lime-50", text: "text-lime-700" },
  "인천 (개별)": { bg: "bg-violet-50", text: "text-violet-700" },
  "대전 (개별)": { bg: "bg-orange-50", text: "text-orange-700" },
  "대구 (개별)": { bg: "bg-red-50", text: "text-red-700" },
  "부산 (개별)": { bg: "bg-rose-50", text: "text-rose-700" },
  "울산 (개별)": { bg: "bg-amber-50", text: "text-amber-700" },
  "경남 (개별)": { bg: "bg-teal-50", text: "text-teal-700" },
};

export default function AdminDashboard() {
  const { schools, loading, refresh } = useSchoolData();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
    </div>
  );

  const allTeachers = schools.flatMap((s) => s.teachers);
  const totalSchools = schools.length;
  const totalTeachers = allTeachers.length;
  const pendingCount = allTeachers.filter((t) => t.status === "pending").length;
  const sentCount = allTeachers.filter((t) => t.status === "sent").length;
  const upgradedCount = allTeachers.filter((t) => t.status === "upgraded").length;
  const individualCount = allTeachers.filter((t) => t.status === "individual").length;
  const needUpgrade = pendingCount + sentCount;
  const upgradeRate = totalTeachers > 0 ? Math.round(((upgradedCount + individualCount) / totalTeachers) * 100) : 0;

  // Upgrade needed schools
  const upgradeNeeded = schools
    .map((s) => ({
      ...s,
      needTeachers: s.teachers.filter((t) => t.status === "pending" || t.status === "sent"),
    }))
    .filter((s) => s.needTeachers.length > 0)
    .sort((a, b) => b.needTeachers.length - a.needTeachers.length);

  // Team summary
  const teams = new Map<string, { schools: number; teachers: number; upgraded: number }>();
  for (const s of schools) {
    const key = s.team || "Unassigned";
    if (!teams.has(key)) teams.set(key, { schools: 0, teachers: 0, upgraded: 0 });
    const t = teams.get(key)!;
    t.schools++;
    t.teachers += s.teachers.length;
    t.upgraded += s.teachers.filter(t => t.status === "upgraded" || t.status === "individual").length;
  }

  // Recent teachers
  const recentTeachers = [...allTeachers]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);

  // Missing English names
  const missingEnglish = schools.filter((s) => !s.nameEn);

  // Region breakdown
  const regions = new Map<string, number>();
  schools.forEach(s => {
    const r = s.region || "Other";
    regions.set(r, (regions.get(r) || 0) + 1);
  });
  const regionEntries = Array.from(regions.entries()).sort((a, b) => b[1] - a[1]);

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
    <div className="space-y-6">
      {/* Hero stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">학교</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{totalSchools}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342" /></svg>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            {regionEntries.slice(0, 3).map(([r, c]) => (
              <span key={r} className="text-[10px] text-gray-400">{r} {c}</span>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">교사</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{totalTeachers}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[10px] text-emerald-600 font-medium">{upgradedCount} 업그레이드</span>
            <span className="text-[10px] text-purple-600 font-medium">{individualCount} 개별구매</span>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">업그레이드율</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{upgradeRate}%</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" /></svg>
            </div>
          </div>
          <div className="mt-3">
            <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${upgradeRate}%` }} />
            </div>
          </div>
        </div>

        <div className={`rounded-xl border p-5 ${needUpgrade > 0 ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">처리 필요</p>
              <p className={`text-3xl font-bold mt-1 ${needUpgrade > 0 ? "text-amber-900" : "text-emerald-900"}`}>{needUpgrade}</p>
            </div>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${needUpgrade > 0 ? "bg-amber-100" : "bg-emerald-100"}`}>
              {needUpgrade > 0 ? (
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
              ) : (
                <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              )}
            </div>
          </div>
          {needUpgrade > 0 && (
            <div className="mt-3 flex items-center gap-2 text-[10px]">
              <span className="text-amber-700">{pendingCount} 대기중</span>
              <span className="text-blue-700">{sentCount} 발송됨</span>
            </div>
          )}
        </div>
      </div>

      {/* Action section - pending upgrades */}
      {needUpgrade > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b bg-gray-50/80">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold text-gray-900">업그레이드 대기</h2>
              <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full">{needUpgrade}명</span>
            </div>
            <div className="flex items-center gap-2">
              {pendingCount > 0 && (
                <button onClick={sendAllPending} disabled={sending}
                  className="text-xs font-semibold bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {sending ? "발송 중..." : `${pendingCount}명 Jon에게 발송`}
                </button>
              )}
              <Link href="/admin/teachers"
                className="text-xs text-gray-500 hover:text-gray-900 px-3 py-2 rounded-lg border hover:bg-gray-50 transition-colors">
                전체 보기
              </Link>
            </div>
          </div>

          <div className="divide-y">
            {upgradeNeeded.slice(0, 8).map((school) => {
              const tc = teamColorMap[school.team || ""] || { bg: "bg-gray-50", text: "text-gray-600" };
              return (
                <div key={school.id} className="px-5 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-sm text-gray-900">{school.nameEn || school.name}</span>
                    {school.nameEn && <span className="text-xs text-gray-400">{school.name}</span>}
                    {school.team && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${tc.bg} ${tc.text}`}>{school.team}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {school.needTeachers.map((t) => (
                      <span key={t.id}
                        className={`text-xs font-mono px-2.5 py-1 rounded-lg ${
                          t.status === "pending" ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-blue-50 text-blue-700 border border-blue-200"
                        }`}>
                        {t.email}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            {upgradeNeeded.length > 8 && (
              <div className="px-5 py-3 text-center">
                <Link href="/admin/teachers" className="text-xs text-blue-600 hover:underline">
                  +{upgradeNeeded.length - 8} more schools...
                </Link>
              </div>
            )}
          </div>

          {message && (
            <div className={`px-5 py-2.5 text-sm font-medium ${message.includes("완료") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              {message}
            </div>
          )}
        </div>
      )}

      {/* All good banner */}
      {needUpgrade === 0 && totalTeachers > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div>
            <p className="font-semibold text-emerald-900">전체 교사 업그레이드 완료</p>
            <p className="text-sm text-emerald-700">{upgradedCount + individualCount}명 프리미엄 계정 활성화</p>
          </div>
        </div>
      )}

      {/* Bottom grid: Teams + Recent */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Teams */}
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="px-5 py-3 border-b bg-gray-50/80">
            <h2 className="font-semibold text-gray-900">팀별 현황</h2>
          </div>
          <div className="divide-y">
            {Array.from(teams.entries())
              .sort(([, a], [, b]) => b.teachers - a.teachers)
              .map(([team, data]) => {
                const tc = teamColorMap[team] || { bg: "bg-gray-50", text: "text-gray-600" };
                const rate = data.teachers > 0 ? Math.round((data.upgraded / data.teachers) * 100) : 0;
                return (
                  <Link href="/admin/schools" key={team} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50/80 transition-colors">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${tc.bg} ${tc.text}`}>{team}</span>
                    <div className="flex-1" />
                    <span className="text-xs text-gray-400">{data.schools}교</span>
                    <span className="text-sm font-semibold text-gray-900 w-8 text-right">{data.teachers}</span>
                    <div className="h-1.5 w-12 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${rate}%` }} />
                    </div>
                  </Link>
                );
              })}
          </div>
        </div>

        {/* Recent teachers */}
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b bg-gray-50/80">
            <h2 className="font-semibold text-gray-900">최근 등록 교사</h2>
            <Link href="/admin/teachers" className="text-xs text-blue-600 hover:underline">전체 보기</Link>
          </div>
          <div className="divide-y">
            {recentTeachers.map((t) => {
              const school = schools.find((s) => s.id === t.schoolId);
              const sc = { upgraded: "bg-emerald-400", pending: "bg-amber-400", sent: "bg-blue-400", individual: "bg-purple-400" };
              return (
                <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${sc[t.status as keyof typeof sc] || "bg-gray-300"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-mono text-gray-700 truncate">{t.email}</p>
                    <p className="text-xs text-gray-400 truncate">{school?.nameEn || school?.name}</p>
                  </div>
                  <span className="text-[10px] text-gray-400">
                    {new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Missing English names warning */}
      {missingEnglish.length > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b bg-gray-50/80">
            <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
            <h2 className="font-semibold text-gray-900">영문명 미등록</h2>
            <span className="text-xs text-amber-600 font-medium">{missingEnglish.length}교</span>
          </div>
          <div className="px-5 py-3 flex flex-wrap gap-1.5">
            {missingEnglish.map((s) => (
              <span key={s.id} className="text-xs bg-amber-50 text-amber-700 px-2.5 py-1 rounded-lg border border-amber-200">{s.name}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

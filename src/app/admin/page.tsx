"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSchoolData, type School } from "@/lib/use-data";

const teamColors: Record<string, string> = {
  "서울1팀": "bg-blue-100 text-blue-800 border-blue-200",
  "서울4팀": "bg-blue-50 text-blue-700 border-blue-100",
  "서울 (개별)": "bg-sky-50 text-sky-700 border-sky-200",
  "경기2팀": "bg-green-100 text-green-800 border-green-200",
  "경기3팀": "bg-green-50 text-green-700 border-green-100",
  "경기5팀": "bg-emerald-100 text-emerald-800 border-emerald-200",
  "경기 (개별)": "bg-lime-50 text-lime-700 border-lime-200",
  "인천 (개별)": "bg-violet-100 text-violet-800 border-violet-200",
  "대전 (개별)": "bg-orange-100 text-orange-800 border-orange-200",
  "부산 (개별)": "bg-rose-50 text-rose-700 border-rose-200",
  "울산 (개별)": "bg-amber-50 text-amber-700 border-amber-200",
  "경남 (개별)": "bg-teal-50 text-teal-700 border-teal-200",
};

const statusColors: Record<string, string> = {
  pending: "bg-yellow-500",
  sent: "bg-blue-500",
  upgraded: "bg-green-500",
};

export default function AdminDashboard() {
  const { schools, loading } = useSchoolData();

  if (loading) return <div className="p-8 text-center text-gray-400">Loading...</div>;

  const allTeachers = schools.flatMap((s) => s.teachers);
  const totalSchools = schools.length;
  const totalTeachers = allTeachers.length;
  const pendingCount = allTeachers.filter((t) => t.status === "pending").length;
  const sentCount = allTeachers.filter((t) => t.status === "sent").length;
  const upgradedCount = allTeachers.filter((t) => t.status === "upgraded").length;

  // Team summary
  const teams = new Map<string, { schools: number; teachers: number }>();
  for (const s of schools) {
    const key = s.team || "미배정";
    if (!teams.has(key)) teams.set(key, { schools: 0, teachers: 0 });
    const t = teams.get(key)!;
    t.schools++;
    t.teachers += s.teachers.length;
  }

  // Recent teachers
  const recentTeachers = [...allTeachers]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  const stats = [
    { label: "학교", value: totalSchools, color: "text-blue-700", bg: "bg-blue-50" },
    { label: "교사", value: totalTeachers, color: "text-indigo-700", bg: "bg-indigo-50" },
    { label: "Pending", value: pendingCount, color: "text-yellow-700", bg: "bg-yellow-50" },
    { label: "Sent", value: sentCount, color: "text-sky-700", bg: "bg-sky-50" },
    { label: "Upgraded", value: upgradedCount, color: "text-green-700", bg: "bg-green-50" },
  ];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {stats.map((s) => (
          <Card key={s.label} className={`${s.bg} border-0`}>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs font-medium text-gray-500">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Teams */}
      <div>
        <h3 className="text-sm font-semibold text-gray-500 mb-3">팀별 현황</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from(teams.entries())
            .sort(([a], [b]) => (a === "미배정" ? 1 : b === "미배정" ? -1 : a.localeCompare(b)))
            .map(([team, data]) => (
              <Link href="/admin/schools" key={team}>
                <Card className={`hover:shadow-md transition-shadow cursor-pointer border ${
                  team !== "미배정" ? teamColors[team] || "bg-gray-50 border-gray-200" : "bg-gray-50 border-gray-200"
                }`}>
                  <CardContent className="py-3 px-4">
                    <p className="font-semibold text-sm">{team}</p>
                    <div className="flex gap-3 mt-1 text-xs text-gray-600">
                      <span>{data.schools}교</span>
                      <span>{data.teachers}명</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
        </div>
      </div>

      {/* Recent */}
      <div>
        <h3 className="text-sm font-semibold text-gray-500 mb-3">최근 등록 교사</h3>
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {recentTeachers.map((t) => {
                const school = schools.find((s) => s.id === t.schoolId);
                return (
                  <div key={t.id} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${statusColors[t.status]}`} />
                      <div>
                        <span className="font-medium text-sm">{t.name}</span>
                        <span className="text-gray-400 text-xs ml-2">{t.email}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">{school?.name}</span>
                      {school?.team && (
                        <Badge className={`text-[10px] px-1.5 py-0 ${teamColors[school.team] || "bg-gray-100 text-gray-600"}`}>
                          {school.team}
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

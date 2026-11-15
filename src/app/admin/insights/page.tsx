"use client";

import { useEffect, useState } from "react";
import { PageHeader, StatDivider, Card, CardTitle, EmptyState, Spinner } from "@/components/admin/ui";
import { levelBadgeCls } from "@/lib/school-level";

interface LevelRow { level: "초" | "중" | "고"; teachers: number; schools: number }
interface SubjectRow { name: string; count: number; byLevel: Record<string, number> }
interface Insights {
  totals: {
    teachers: number; schools: number; schoolsRegistered: number;
    avgPerSchool: number; medianPerSchool: number;
    top10Share: number; top20Share: number; singleTeacherSchools: number;
  };
  levels: LevelRow[];
  unclassified: { teachers: number; schools: number };
  subjects: SubjectRow[];
  topSchools: { name: string; nameEn: string | null; level: string; team: string | null; count: number }[];
  subjectCoverage: { filled: number; total: number };
  monthlyTeachers: { month: string; count: number }[];
  monthlyRequests: { month: string; requests: number; seats: number }[];
}

// 학교급 3색 — dataviz 기본 팔레트 slot 1·2·3 (all-pairs 검증 통과)
const LEVEL_FILL: Record<string, string> = { 초: "var(--viz-1)", 중: "var(--viz-2)", 고: "var(--viz-3)" };

function pct(n: number, total: number) {
  return total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
}
function monthLabel(m: string) {
  const [y, mm] = m.split("-");
  return `${y.slice(2)}.${mm}`;
}

export default function InsightsPage() {
  const [data, setData] = useState<Insights | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/admin/insights")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <EmptyState icon="⚠️" title="인사이트를 불러오지 못했습니다" hint="새로고침하거나 잠시 후 다시 시도하세요." />;
  if (!data) return <Spinner />;

  const { totals, levels, unclassified, subjects, topSchools, subjectCoverage, monthlyTeachers, monthlyRequests } = data;
  const levelTotal = levels.reduce((s, l) => s + l.teachers, 0);
  const maxMonthly = Math.max(1, ...monthlyTeachers.map((m) => m.count));
  const maxRequests = Math.max(1, ...monthlyRequests.map((m) => m.requests));
  const maxSubject = Math.max(1, ...subjects.map((s) => s.count));
  const maxSchool = Math.max(1, ...topSchools.map((s) => s.count));
  const coverage = pct(subjectCoverage.filled, subjectCoverage.total);

  return (
    <div className="space-y-4 pb-20 md:pb-0 viz-root">
      {/* dataviz 팔레트: 라이트/다크 각각 검증된 스텝 */}
      <style>{`
        .viz-root {
          --viz-1: #2a78d6; --viz-2: #eb6834; --viz-3: #1baf7a;
          --viz-seq: #2a78d6; --viz-grid: #e6e6e3;
        }
        @media (prefers-color-scheme: dark) {
          :root:where(:not([data-theme="light"])) .viz-root {
            --viz-1: #3987e5; --viz-2: #d95926; --viz-3: #199e70;
            --viz-seq: #3987e5; --viz-grid: #33332f;
          }
        }
        :root[data-theme="dark"] .viz-root {
          --viz-1: #3987e5; --viz-2: #d95926; --viz-3: #199e70;
          --viz-seq: #3987e5; --viz-grid: #33332f;
        }
      `}</style>

      <PageHeader title="인사이트">
        <span><strong className="text-slate-900 text-sm">{totals.teachers.toLocaleString()}</strong> 업그레이드 완료 교사</span>
        <StatDivider />
        <span><strong className="text-slate-900 text-sm">{totals.schools}</strong> 개교</span>
        <StatDivider />
        <span>학교당 평균 {totals.avgPerSchool}명 · 중앙값 {totals.medianPerSchool}명</span>
      </PageHeader>

      <p className="text-xs text-slate-500">
        취소 학교를 제외하고, 승인 및 업그레이드가 완료된 교사 등록 건을 집계합니다.
        학교 수는 해당 교사가 1명 이상인 학교 기준이며, 결제 완료 인원이나 고유 이메일 수와는 다릅니다.
      </p>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {/* ── 학교급 ─────────────────────────────────────── */}
        <Card>
          <CardTitle title="학교급 분포" badge={<span className="text-xs text-slate-400">교사 {levelTotal.toLocaleString()}명</span>} />
          <div className="p-4 md:p-5 space-y-4">
            {/* 100% 스택 바 — 세그먼트 사이 2px 서피스 갭 */}
            <div className="flex h-7 w-full gap-[2px] rounded-md overflow-hidden">
              {levels.map((l) => (
                <div key={l.level} className="flex items-center justify-center min-w-0"
                  style={{ background: LEVEL_FILL[l.level], width: `${pct(l.teachers, levelTotal)}%` }}
                  title={`${l.level} ${l.teachers}명`}>
                  <span className="text-[11px] font-semibold text-white px-1 truncate">
                    {pct(l.teachers, levelTotal) >= 8 ? `${l.level} ${pct(l.teachers, levelTotal)}%` : ""}
                  </span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {levels.map((l) => (
                <div key={l.level} className="rounded-lg border p-3">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: LEVEL_FILL[l.level] }} />
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${levelBadgeCls[l.level]}`}>{l.level}</span>
                  </div>
                  <p className="text-xl font-extrabold tabular-nums text-slate-900 mt-1.5 leading-none">
                    {l.teachers.toLocaleString()}<span className="text-xs font-semibold text-slate-400 ml-0.5">명</span>
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">{pct(l.teachers, levelTotal)}% · {l.schools}개교</p>
                </div>
              ))}
            </div>

            {unclassified.teachers > 0 && (
              <p className="text-[11px] text-slate-400">
                미분류 {unclassified.teachers}명 ({unclassified.schools}개교) — 학교 이름에 급 정보가 없어 초·중·고 어디에도 넣지 않음
              </p>
            )}
          </div>
        </Card>

        {/* ── 과목 ──────────────────────────────────────── */}
        <Card>
          <CardTitle title="담당 과목" badge={<span className="text-xs text-slate-400">기입 {subjectCoverage.filled.toLocaleString()}명 ({coverage}%)</span>} />
          <div className="p-4 md:p-5 space-y-2">
            {subjects.length === 0 ? (
              <EmptyState icon="📚" title="과목 데이터 없음" />
            ) : (
              <>
                {subjects.slice(0, 10).map((s) => (
                  <div key={s.name} className="flex items-center gap-3">
                    <span className="text-xs text-slate-600 w-28 shrink-0 truncate" title={s.name}>{s.name}</span>
                    <div className="flex-1 min-w-0 h-4 flex items-center">
                      <div className="h-2 rounded-r-[4px]" style={{ background: "var(--viz-seq)", width: `${(s.count / maxSubject) * 100}%`, minWidth: 2 }} />
                    </div>
                    <span className="text-xs font-semibold tabular-nums text-slate-700 w-12 text-right shrink-0">
                      {pct(s.count, subjectCoverage.filled)}%
                    </span>
                    <span className="text-[11px] tabular-nums text-slate-400 w-10 text-right shrink-0">{s.count}</span>
                  </div>
                ))}
                <p className="text-[11px] text-slate-400 pt-1">
                  과목을 기입한 {subjectCoverage.filled.toLocaleString()}명(전체의 {coverage}%) 기준 비율.
                  2026-04 이전 가입자는 폼에 과목 항목이 없어 비어 있음.
                </p>
              </>
            )}
          </div>
        </Card>

        {/* ── 완료 교사의 등록 월별 분포 ─────────────────────────── */}
        <Card>
          <CardTitle title="완료 교사의 등록 월별 분포" badge={<span className="text-xs text-slate-400">한국 시간 · 등록일 기준</span>} />
          <div className="p-4 md:p-5">
            <div className="flex items-end gap-1.5 h-40">
              {monthlyTeachers.map((m) => {
                const h = (m.count / maxMonthly) * 100;
                const isMax = m.count === maxMonthly;
                return (
                  <div key={m.month} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full group">
                    <span className={`text-[10px] tabular-nums mb-1 ${isMax ? "font-bold text-slate-900" : "text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"}`}>
                      {m.count}
                    </span>
                    <div className="w-full rounded-t-[4px] transition-opacity hover:opacity-80"
                      style={{ background: "var(--viz-seq)", height: `${Math.max(h, 1)}%` }}
                      title={`${m.month} — ${m.count}명`} />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1.5 mt-1.5 border-t pt-1.5" style={{ borderColor: "var(--viz-grid)" }}>
              {monthlyTeachers.map((m) => (
                <span key={m.month} className="flex-1 min-w-0 text-center text-[9px] text-slate-400 tabular-nums truncate">
                  {monthLabel(m.month)}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-2.5">
              현재 완료 상태인 교사의 등록일 기준입니다. 업그레이드 완료 월이나 신규 유입을 뜻하지 않으며, 일괄 등록분을 포함할 수 있습니다.
            </p>
          </div>
        </Card>

        {/* ── 월별 계정 요청 ─────────────────────────────── */}
        <Card>
          <CardTitle title="월별 계정 요청" badge={<span className="text-xs text-slate-400">한국 시간 · 요청 생성일 기준</span>} />
          <div className="p-4 md:p-5">
            <div className="flex items-end gap-1.5 h-40">
              {monthlyRequests.map((m) => {
                const h = (m.requests / maxRequests) * 100;
                const isMax = m.requests === maxRequests;
                return (
                  <div key={m.month} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full group">
                    <span className={`text-[10px] tabular-nums mb-1 ${isMax ? "font-bold text-slate-900" : "text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"}`}>
                      {m.requests}
                    </span>
                    <div className="w-full rounded-t-[4px] transition-opacity hover:opacity-80"
                      style={{ background: "var(--viz-seq)", height: `${Math.max(h, 1)}%` }}
                      title={`${m.month} — ${m.requests}건 · ${m.seats}석`} />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1.5 mt-1.5 border-t pt-1.5" style={{ borderColor: "var(--viz-grid)" }}>
              {monthlyRequests.map((m) => (
                <span key={m.month} className="flex-1 min-w-0 text-center text-[9px] text-slate-400 tabular-nums truncate">
                  {monthLabel(m.month)}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-2.5">
              보관·Market 취소 대기 및 취소·협력사 취소 요청을 제외합니다. 요청 생성일 기준이며 결제 건수나 결제 시점을 뜻하지 않습니다.
            </p>
          </div>
        </Card>
      </div>

      {/* ── 집중도 ───────────────────────────────────────── */}
      <Card>
        <CardTitle title="학교 집중도" />
        <div className="p-4 md:p-5 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "상위 10개교 비중", value: `${totals.top10Share}%`, hint: "전체 교사 중" },
            { label: "상위 20개교 비중", value: `${totals.top20Share}%`, hint: "전체 교사 중" },
            { label: "학교당 중앙값", value: `${totals.medianPerSchool}명`, hint: `평균 ${totals.avgPerSchool}명` },
            { label: "1명뿐인 학교", value: `${totals.singleTeacherSchools}개교`, hint: "확산 여지" },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{s.label}</p>
              <p className="text-xl font-extrabold tabular-nums text-slate-900 mt-1 leading-none">{s.value}</p>
              <p className="text-[11px] text-slate-500 mt-1">{s.hint}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* ── 상위 학교 ────────────────────────────────────── */}
      <Card>
        <CardTitle title="교사 수 상위 10개교" />
        <div className="p-4 md:p-5 space-y-2">
          {topSchools.map((s, i) => (
            <div key={`${s.name}-${i}`} className="flex items-center gap-3">
              <span className="text-[10px] tabular-nums text-slate-300 w-4 shrink-0 text-right">{i + 1}</span>
              <span className="text-xs text-slate-700 w-36 shrink-0 truncate" title={s.nameEn ?? s.name}>{s.name}</span>
              {s.level !== "미분류" && (
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${levelBadgeCls[s.level as "초" | "중" | "고"]}`}>{s.level}</span>
              )}
              <div className="flex-1 min-w-0 h-4 flex items-center">
                <div className="h-2 rounded-r-[4px]" style={{ background: "var(--viz-seq)", width: `${(s.count / maxSchool) * 100}%`, minWidth: 2 }} />
              </div>
              <span className="text-xs font-semibold tabular-nums text-slate-700 w-12 text-right shrink-0">{s.count}명</span>
            </div>
          ))}
          <p className="text-[11px] text-slate-400 pt-1">
            이 10개교가 전체 완료 교사의 {totals.top10Share}%를 차지합니다.
          </p>
        </div>
      </Card>
    </div>
  );
}

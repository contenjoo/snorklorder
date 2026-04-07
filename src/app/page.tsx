"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Step = "choose" | "schoolForm" | "batchForm" | "individualForm" | "success" | "batchSuccess" | "request" | "requestSent";
type FindMode = "search" | "code";

interface SchoolResult { id: number; name: string; nameEn: string | null; code: string; }

export default function TeacherRegistration() {
  const [step, setStep] = useState<Step>("choose");
  const [findMode, setFindMode] = useState<FindMode>("search");
  const [schoolCode, setSchoolCode] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [schoolNameEn, setSchoolNameEn] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SchoolResult[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [schoolInput, setSchoolInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchTimer, setSearchTimer] = useState<NodeJS.Timeout | null>(null);
  const [reqName, setReqName] = useState("");
  const [reqNameEn, setReqNameEn] = useState("");
  const [reqRegion, setReqRegion] = useState("");
  const [reqContactName, setReqContactName] = useState("");
  const [reqContactEmail, setReqContactEmail] = useState("");
  const [batchEmails, setBatchEmails] = useState("");
  const [batchResult, setBatchResult] = useState<{ registered: number; duplicates: number } | null>(null);

  useEffect(() => {
    if (searchQuery.length < 1) { setSearchResults([]); return; }
    if (searchTimer) clearTimeout(searchTimer);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/schools/search?q=${encodeURIComponent(searchQuery)}`);
        setSearchResults(await res.json());
      } catch { /* ignore */ }
    }, 300);
    setSearchTimer(t);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  function selectSchool(s: SchoolResult) {
    setSchoolCode(s.code); setSchoolName(s.name); setSchoolNameEn(s.nameEn || "");
    setSearchQuery(""); setSearchResults([]); setError(""); setStep("schoolForm");
  }

  async function lookupCode() {
    if (!schoolCode.trim()) return;
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/schools/lookup?code=${encodeURIComponent(schoolCode.trim())}`);
      if (!res.ok) { setError("학교 코드를 찾을 수 없습니다."); return; }
      const data = await res.json();
      setSchoolName(data.name); setStep("schoolForm");
    } catch { setError("연결 오류입니다."); } finally { setLoading(false); }
  }

  async function submitSchoolTeacher() {
    if (!name.trim() || !email.trim()) { setError("이름과 이메일은 필수입니다."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolCode: schoolCode.trim(), name: name.trim(), email: email.trim(), subject: subject.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error?.includes("already registered") ? "이미 등록된 이메일입니다." : (data.error || "등록 실패")); return; }
      setStep("success");
    } catch { setError("연결 오류입니다."); } finally { setLoading(false); }
  }

  async function submitIndividual() {
    if (!name.trim() || !email.trim() || !schoolInput.trim()) { setError("이름, 이메일, 소속학교는 필수입니다."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/account-requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", type: "upgrade", schoolName: schoolInput.trim(), emails: email.trim(), accountType: "teacher", quantity: 1, notes: `개인 등록 | 이름: ${name.trim()} | 과목: ${subject.trim() || "N/A"}` }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "등록 실패"); return; }
      setStep("success");
    } catch { setError("연결 오류입니다."); } finally { setLoading(false); }
  }

  async function submitBatch() {
    const emails = batchEmails.split(/[\n,;]+/).map((e) => e.trim()).filter((e) => e && e.includes("@"));
    if (emails.length === 0) { setError("유효한 이메일을 입력해주세요."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/register/batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolCode: schoolCode.trim(), emails }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "등록 실패"); return; }
      setBatchResult({ registered: data.registered, duplicates: data.duplicates });
      setStep("batchSuccess");
    } catch { setError("연결 오류입니다."); } finally { setLoading(false); }
  }

  async function submitSchoolRequest() {
    if (!reqName.trim() || !reqContactName.trim() || !reqContactEmail.trim()) { setError("학교명, 담당자 이름, 이메일은 필수입니다."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/school-requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: reqName.trim(), nameEn: reqNameEn.trim() || null, region: reqRegion || null, contactName: reqContactName.trim(), contactEmail: reqContactEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "요청 실패"); return; }
      setStep("requestSent");
    } catch { setError("연결 오류입니다."); } finally { setLoading(false); }
  }

  function reset() {
    setStep("choose"); setSchoolCode(""); setSchoolName(""); setSchoolNameEn("");
    setSearchQuery(""); setSearchResults([]); setName(""); setEmail("");
    setSubject(""); setSchoolInput(""); setError(""); setBatchEmails(""); setBatchResult(null);
  }

  // Shared input class
  const inputCls = "bg-white border-2 border-gray-200 text-gray-900 placeholder:text-gray-400 text-base h-12 rounded-xl focus:border-blue-500 focus:ring-blue-500";
  const labelCls = "text-gray-700 font-semibold text-sm";

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-white rounded-full px-4 py-2 shadow-sm border border-gray-100 mb-4">
            <div className="w-6 h-6 bg-blue-600 rounded-md flex items-center justify-center">
              <span className="text-white text-xs font-black">S</span>
            </div>
            <span className="font-bold text-gray-800">Snorkl</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">프리미엄 교사 등록</h1>
          <p className="text-gray-500 mt-1">Snorkl 프리미엄 업그레이드 요청</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">

          {/* ===== 선택 화면 ===== */}
          {step === "choose" && (
            <div className="p-6 space-y-5">
              {/* Snorkl 안내 */}
              <div className="flex items-start gap-3 rounded-xl bg-blue-50 border border-blue-100 p-4">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-blue-600 text-sm">💡</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-blue-900">먼저 Snorkl 가입이 필요합니다</p>
                  <p className="text-sm text-blue-700 mt-1">
                    <a href="https://snorkl.app" target="_blank" rel="noopener noreferrer" className="underline font-bold">snorkl.app</a>
                    에서 가입 후, 동일한 이메일로 아래에서 등록해주세요.
                  </p>
                </div>
              </div>

              <p className="text-sm font-bold text-gray-900">등록 유형을 선택하세요</p>

              {/* 학교 소속 */}
              <div className="rounded-2xl border-2 border-gray-100 p-5 space-y-4 hover:border-blue-200 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-2xl">🏫</div>
                  <div>
                    <p className="font-bold text-gray-900">학교 단체 구매</p>
                    <p className="text-sm text-gray-500">학교에서 단체로 구매한 경우</p>
                  </div>
                </div>

                <div className="flex rounded-xl bg-gray-100 p-1">
                  <button
                    onClick={() => { setFindMode("search"); setError(""); }}
                    className={`flex-1 text-sm py-2.5 rounded-lg font-medium transition-all ${findMode === "search" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                  >학교 검색</button>
                  <button
                    onClick={() => { setFindMode("code"); setError(""); }}
                    className={`flex-1 text-sm py-2.5 rounded-lg font-medium transition-all ${findMode === "code" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                  >코드 입력</button>
                </div>

                {findMode === "search" ? (
                  <div className="space-y-2">
                    <Input placeholder="학교 이름을 입력하세요" value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)} className={inputCls} />
                    {searchResults.length > 0 && (
                      <div className="rounded-xl border-2 border-gray-100 divide-y divide-gray-100 max-h-48 overflow-y-auto">
                        {searchResults.map((s) => (
                          <button key={s.id} onClick={() => selectSchool(s)} className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors">
                            <p className="font-semibold text-gray-900">{s.name}</p>
                            {s.nameEn && <p className="text-xs text-gray-400">{s.nameEn}</p>}
                          </button>
                        ))}
                      </div>
                    )}
                    {searchQuery.length >= 2 && searchResults.length === 0 && (
                      <div className="text-center py-4 bg-gray-50 rounded-xl">
                        <p className="text-sm text-gray-500 font-medium">검색 결과가 없습니다</p>
                        <button onClick={() => { setReqName(searchQuery); setStep("request"); setError(""); }}
                          className="text-sm text-blue-600 font-bold underline mt-1">학교 등록 요청하기 →</button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Input placeholder="예: HYOMYEONG" value={schoolCode}
                      onChange={(e) => setSchoolCode(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && lookupCode()}
                      className={inputCls + " font-mono tracking-widest"} />
                    {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
                    <Button onClick={lookupCode} disabled={loading} className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-base font-bold rounded-xl">
                      {loading ? "확인 중..." : "다음 →"}
                    </Button>
                  </div>
                )}
              </div>

              {/* 개인 교사 */}
              <button
                onClick={() => { setStep("individualForm"); setError(""); }}
                className="w-full rounded-2xl border-2 border-gray-100 p-5 text-left hover:border-violet-200 hover:bg-violet-50/30 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-violet-50 flex items-center justify-center text-2xl group-hover:scale-105 transition-transform">👤</div>
                  <div className="flex-1">
                    <p className="font-bold text-gray-900">개인 구매</p>
                    <p className="text-sm text-gray-500">개인적으로 프리미엄을 구매한 경우</p>
                  </div>
                  <svg className="w-5 h-5 text-gray-300 group-hover:text-violet-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            </div>
          )}

          {/* ===== 학교 소속 교사 폼 (1명) ===== */}
          {step === "schoolForm" && (
            <div className="p-6 space-y-5">
              <div className="text-center rounded-xl bg-blue-50 border border-blue-100 p-5">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-2xl mx-auto mb-2">🏫</div>
                <p className="text-xl font-bold text-gray-900">{schoolName}</p>
                {schoolNameEn && <p className="text-sm text-blue-600">{schoolNameEn}</p>}
                <div className="flex items-center justify-center gap-3 mt-2">
                  <button onClick={reset} className="text-sm text-blue-600 font-semibold underline">학교 변경</button>
                  <span className="text-gray-300">|</span>
                  <button onClick={() => { setStep("batchForm"); setError(""); }} className="text-sm text-blue-600 font-semibold underline">일괄 등록으로 전환</button>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3">
                <span className="text-base">⚡</span>
                <p className="text-sm text-amber-800 font-medium">
                  <a href="https://snorkl.app" target="_blank" rel="noopener noreferrer" className="underline font-bold">snorkl.app</a>
                  에서 가입한 이메일과 동일한 이메일을 입력해주세요.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className={labelCls}>이름 *</Label>
                <Input placeholder="홍길동" value={name} onChange={(e) => setName(e.target.value)} autoFocus className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>이메일 * <span className="text-gray-400 font-normal">(Snorkl 가입 이메일)</span></Label>
                <Input type="email" placeholder="example@school.kr" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>담당 과목 <span className="text-gray-400 font-normal">(선택)</span></Label>
                <Input placeholder="예: 영어, 수학, 과학" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls} />
              </div>
              {error && <p className="text-sm text-red-600 font-medium bg-red-50 p-3 rounded-xl">{error}</p>}
              <Button onClick={submitSchoolTeacher} disabled={loading} className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-base font-bold rounded-xl">
                {loading ? "등록 중..." : "등록하기"}
              </Button>
            </div>
          )}

          {/* ===== 학교 일괄 등록 폼 ===== */}
          {step === "batchForm" && (
            <div className="p-6 space-y-5">
              <div className="text-center rounded-xl bg-blue-50 border border-blue-100 p-5">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-2xl mx-auto mb-2">🏫</div>
                <p className="text-xl font-bold text-gray-900">{schoolName}</p>
                {schoolNameEn && <p className="text-sm text-blue-600">{schoolNameEn}</p>}
                <div className="flex items-center justify-center gap-3 mt-2">
                  <button onClick={reset} className="text-sm text-blue-600 font-semibold underline">학교 변경</button>
                  <span className="text-gray-300">|</span>
                  <button onClick={() => { setStep("schoolForm"); setError(""); }} className="text-sm text-blue-600 font-semibold underline">1명 등록으로 전환</button>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-xl bg-green-50 border border-green-200 p-3">
                <span className="text-base">📋</span>
                <p className="text-sm text-green-800 font-medium">
                  여러 선생님의 이메일을 한번에 등록합니다. <b>Snorkl 가입 이메일</b>을 입력해주세요.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className={labelCls}>이메일 목록 *</Label>
                <textarea
                  placeholder={"teacher1@school.kr\nteacher2@school.kr\nteacher3@school.kr"}
                  value={batchEmails}
                  onChange={(e) => setBatchEmails(e.target.value)}
                  rows={8}
                  autoFocus
                  className="w-full bg-white border-2 border-gray-200 text-gray-900 placeholder:text-gray-400 text-sm font-mono rounded-xl p-4 focus:border-blue-500 focus:ring-blue-500 outline-none resize-y"
                />
                <p className="text-xs text-gray-400">한 줄에 하나씩, 또는 쉼표(,)로 구분해서 입력하세요</p>
              </div>

              {batchEmails.trim() && (
                <div className="text-sm text-gray-600 bg-gray-50 rounded-xl p-3">
                  인식된 이메일: <span className="font-bold text-blue-600">
                    {batchEmails.split(/[\n,;]+/).map((e) => e.trim()).filter((e) => e && e.includes("@")).length}개
                  </span>
                </div>
              )}

              {error && <p className="text-sm text-red-600 font-medium bg-red-50 p-3 rounded-xl">{error}</p>}
              <Button onClick={submitBatch} disabled={loading} className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-base font-bold rounded-xl">
                {loading ? "등록 중..." : "일괄 등록하기"}
              </Button>
              <button onClick={reset} className="w-full text-sm text-gray-400 font-medium hover:text-gray-600 transition-colors py-1">← 돌아가기</button>
            </div>
          )}

          {/* ===== 일괄 등록 완료 ===== */}
          {step === "batchSuccess" && batchResult && (
            <div className="p-8 text-center space-y-5">
              <div className="mx-auto w-20 h-20 rounded-2xl bg-green-50 border-2 border-green-200 flex items-center justify-center">
                <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="text-2xl font-bold text-gray-900">일괄 등록 완료!</h3>
                <div className="mt-4 space-y-2">
                  <div className="inline-flex items-center gap-2 bg-green-50 rounded-lg px-4 py-2">
                    <span className="text-green-600 font-bold text-lg">{batchResult.registered}명</span>
                    <span className="text-green-700 text-sm">새로 등록</span>
                  </div>
                  {batchResult.duplicates > 0 && (
                    <div className="block">
                      <span className="text-sm text-gray-500">이미 등록됨: {batchResult.duplicates}명 (건너뜀)</span>
                    </div>
                  )}
                </div>
                <p className="text-base text-gray-500 mt-3">
                  프리미엄 업그레이드 요청이 접수되었습니다.
                  <br /><span className="font-semibold text-gray-700">처리까지 1~2 영업일</span> 소요됩니다.
                </p>
              </div>
              <Button variant="outline" onClick={reset} className="border-2 border-gray-200 text-gray-700 font-semibold h-11 rounded-xl hover:bg-gray-50">
                처음으로
              </Button>
            </div>
          )}

          {/* ===== 개인 교사 폼 ===== */}
          {step === "individualForm" && (
            <div className="p-6 space-y-5">
              <div className="flex items-center gap-3 rounded-xl bg-violet-50 border border-violet-100 p-4">
                <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center text-xl">👤</div>
                <div>
                  <p className="font-bold text-gray-900">개인 교사 등록</p>
                  <p className="text-sm text-violet-600">프리미엄 업그레이드 요청이 관리자에게 전달됩니다</p>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3">
                <span className="text-base">⚡</span>
                <p className="text-sm text-amber-800 font-medium">
                  <a href="https://snorkl.app" target="_blank" rel="noopener noreferrer" className="underline font-bold">snorkl.app</a>
                  에서 가입한 이메일과 동일한 이메일을 입력해주세요.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className={labelCls}>소속 학교 *</Label>
                <Input placeholder="예: 서울 OO고등학교" value={schoolInput} onChange={(e) => setSchoolInput(e.target.value)} autoFocus className={inputCls} />
                <p className="text-xs text-gray-400">같은 학교 동료가 있으면 동일하게 입력해주세요</p>
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>이름 *</Label>
                <Input placeholder="홍길동" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>이메일 * <span className="text-gray-400 font-normal">(Snorkl 가입 이메일)</span></Label>
                <Input type="email" placeholder="example@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>담당 과목 <span className="text-gray-400 font-normal">(선택)</span></Label>
                <Input placeholder="예: 영어, 수학, 과학" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls} />
              </div>
              {error && <p className="text-sm text-red-600 font-medium bg-red-50 p-3 rounded-xl">{error}</p>}
              <Button onClick={submitIndividual} disabled={loading} className="w-full h-12 bg-violet-600 hover:bg-violet-700 text-base font-bold rounded-xl">
                {loading ? "등록 중..." : "등록하기"}
              </Button>
              <button onClick={reset} className="w-full text-sm text-gray-400 font-medium hover:text-gray-600 transition-colors py-1">← 돌아가기</button>
            </div>
          )}

          {/* ===== 완료 ===== */}
          {step === "success" && (
            <div className="p-8 text-center space-y-5">
              <div className="mx-auto w-20 h-20 rounded-2xl bg-green-50 border-2 border-green-200 flex items-center justify-center">
                <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="text-2xl font-bold text-gray-900">등록 완료!</h3>
                <p className="text-base text-gray-500 mt-2">
                  Snorkl 프리미엄 업그레이드 요청이 접수되었습니다.
                  <br /><span className="font-semibold text-gray-700">처리까지 1~2 영업일</span> 소요됩니다.
                </p>
              </div>
              <Button variant="outline" onClick={reset} className="border-2 border-gray-200 text-gray-700 font-semibold h-11 rounded-xl hover:bg-gray-50">
                다른 교사 등록하기
              </Button>
            </div>
          )}

          {/* ===== 학교 등록 요청 ===== */}
          {step === "request" && (
            <div className="p-6 space-y-5">
              <div className="flex items-center gap-3 rounded-xl bg-blue-50 border border-blue-100 p-4">
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-xl">🏫</div>
                <div>
                  <p className="font-bold text-gray-900">학교 등록 요청</p>
                  <p className="text-sm text-blue-600">관리자 확인 후 학교 코드가 이메일로 발송됩니다</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>학교명 (한국어) *</Label>
                <Input placeholder="예: 효명고등학교" value={reqName} onChange={(e) => setReqName(e.target.value)} autoFocus className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>School Name (English)</Label>
                <Input placeholder="e.g. Hyo-Myeong High School" value={reqNameEn} onChange={(e) => setReqNameEn(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>지역</Label>
                <select value={reqRegion} onChange={(e) => setReqRegion(e.target.value)}
                  className="w-full rounded-xl bg-white border-2 border-gray-200 text-gray-900 px-4 py-3 text-base focus:border-blue-500 outline-none">
                  <option value="">선택하세요</option>
                  {["서울","부산","대구","인천","광주","대전","울산","세종","경기","강원","충북","충남","전북","전남","경북","경남","제주"].map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>담당자 이름 *</Label>
                <Input placeholder="홍길동" value={reqContactName} onChange={(e) => setReqContactName(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>담당자 이메일 *</Label>
                <Input type="email" placeholder="example@school.kr" value={reqContactEmail} onChange={(e) => setReqContactEmail(e.target.value)} className={inputCls} />
              </div>
              {error && <p className="text-sm text-red-600 font-medium bg-red-50 p-3 rounded-xl">{error}</p>}
              <Button onClick={submitSchoolRequest} disabled={loading} className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-base font-bold rounded-xl">
                {loading ? "요청 중..." : "등록 요청하기"}
              </Button>
              <button onClick={reset} className="w-full text-sm text-gray-400 font-medium hover:text-gray-600 transition-colors py-1">← 돌아가기</button>
            </div>
          )}

          {/* ===== 학교 요청 완료 ===== */}
          {step === "requestSent" && (
            <div className="p-8 text-center space-y-5">
              <div className="mx-auto w-20 h-20 rounded-2xl bg-blue-50 border-2 border-blue-200 flex items-center justify-center">
                <svg className="w-10 h-10 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h3 className="text-2xl font-bold text-gray-900">요청이 접수되었습니다!</h3>
                <p className="text-base text-gray-500 mt-2">
                  관리자 확인 후 학교 코드가 이메일로 발송됩니다.
                  <br />코드를 받으신 후 동료 선생님들에게 공유해주세요.
                </p>
              </div>
              <Button variant="outline" onClick={reset} className="border-2 border-gray-200 text-gray-700 font-semibold h-11 rounded-xl hover:bg-gray-50">처음으로</Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6">
          Powered by <span className="font-semibold">LearnToday</span> · <a href="https://snorkl.app" className="hover:text-gray-600">snorkl.app</a>
        </p>
      </div>
    </div>
  );
}

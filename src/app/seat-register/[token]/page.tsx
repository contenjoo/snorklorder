"use client";

import { use, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface OrderInfo {
  schoolName: string;
  schoolNameEn: string | null;
  quantity: number;
  status: string;
  submitted: boolean;
  emails: string | null;
}

interface TeacherRow {
  name: string;
  email: string;
  subject: string;
}

const inputCls = "bg-white border-2 border-gray-200 text-gray-900 placeholder:text-gray-400 text-base h-12 rounded-xl focus:border-blue-500 focus:ring-blue-500";
const labelCls = "text-gray-700 font-semibold text-sm";

export default function SeatRegisterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<OrderInfo | null>(null);
  const [rows, setRows] = useState<TeacherRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/seat-register/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else {
          setInfo(data);
          setRows(Array.from({ length: data.quantity }, () => ({ name: "", email: "", subject: "" })));
        }
      })
      .catch(() => setError("연결 오류입니다."))
      .finally(() => setLoading(false));
  }, [token]);

  function updateRow(i: number, key: keyof TeacherRow, value: string) {
    setRows((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [key]: value };
      return next;
    });
  }

  async function submit() {
    setError("");
    const filled = rows.filter((r) => r.name.trim() || r.email.trim());
    if (filled.length === 0) {
      setError("최소 1명 이상 입력해주세요.");
      return;
    }
    for (const r of filled) {
      if (!r.name.trim() || !r.email.trim()) {
        setError("이름과 이메일을 모두 입력해주세요.");
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/seat-register/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teachers: filled.map((r) => ({
            name: r.name.trim(),
            email: r.email.trim(),
            subject: r.subject.trim() || null,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "등록에 실패했습니다.");
        return;
      }
      setDone(true);
    } catch {
      setError("연결 오류입니다.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-400">Loading...</div>;
  if (error && !info) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border p-6 text-center">
          <p className="text-red-600 font-medium">{error}</p>
        </div>
      </div>
    );
  }
  if (!info) return null;

  const displayName = info.schoolNameEn || info.schoolName;

  if (done || info.submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border p-8 text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-green-50 border-2 border-green-200 flex items-center justify-center">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900">{done ? "등록이 완료되었습니다!" : "이미 등록 완료된 링크입니다"}</h2>
          <p className="text-sm text-gray-500">
            관리자 검토 후 1~2 영업일 내에 처리됩니다.
            <br />문의: jon@snorkl.app
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 py-8 px-4">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 bg-white rounded-full px-4 py-2 shadow-sm border border-gray-100 mb-4">
            <div className="w-6 h-6 bg-blue-600 rounded-md flex items-center justify-center">
              <span className="text-white text-xs font-black">S</span>
            </div>
            <span className="font-bold text-gray-800">Snorkl</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">교사 정보 등록</h1>
          <p className="text-gray-500 mt-1">{displayName} · {info.quantity}인 좌석</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 space-y-5">
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3">
            <span className="text-base">⚡</span>
            <p className="text-sm text-amber-800 font-medium">
              <a href="https://snorkl.app" target="_blank" rel="noopener noreferrer" className="underline font-bold">snorkl.app</a>
              에서 가입한 이메일과 동일한 이메일을 입력해주세요. 좌석 수보다 적게 입력해도 됩니다.
            </p>
          </div>

          {rows.map((r, i) => (
            <div key={i} className="rounded-2xl border-2 border-gray-100 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center text-sm font-bold text-blue-600">{i + 1}</div>
                <span className="text-sm font-semibold text-gray-700">교사 {i + 1}</span>
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>이름 *</Label>
                <Input value={r.name} placeholder="홍길동" onChange={(e) => updateRow(i, "name", e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>이메일 * <span className="text-gray-400 font-normal">(Snorkl 가입 이메일)</span></Label>
                <Input type="email" value={r.email} placeholder="example@school.kr" onChange={(e) => updateRow(i, "email", e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>담당 과목 <span className="text-gray-400 font-normal">(선택)</span></Label>
                <Input value={r.subject} placeholder="예: 영어, 수학" onChange={(e) => updateRow(i, "subject", e.target.value)} className={inputCls} />
              </div>
            </div>
          ))}

          {error && <p className="text-sm text-red-600 font-medium bg-red-50 p-3 rounded-xl">{error}</p>}

          <Button onClick={submit} disabled={submitting} className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-base font-bold rounded-xl">
            {submitting ? "등록 중..." : "등록 완료하기"}
          </Button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Powered by <span className="font-semibold">LearnToday</span>
        </p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatDivider, StatusChip, StatusDot, EmptyState } from "@/components/admin/ui";

interface SchoolRequest {
  id: number;
  name: string;
  nameEn: string | null;
  region: string | null;
  domain: string | null;
  contactName: string;
  contactEmail: string;
  status: string;
  rejectReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
}



export default function RequestsPage() {
  const [requests, setRequests] = useState<SchoolRequest[]>([]);
  const [processing, setProcessing] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    const res = await fetch("/api/school-requests");
    const data = await res.json();
    if (!res.ok) {
      setRequests([]);
      setMessage(data.error || "목록을 불러오지 못했습니다.");
      return;
    }
    setRequests(Array.isArray(data) ? data : []);
  }

  useEffect(() => { load(); }, []);

  async function handleAction(id: number, action: "approve" | "reject") {
    setProcessing(id);
    setMessage("");
    try {
      const res = await fetch("/api/school-requests/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(action === "approve"
          ? `승인 완료! 코드 ${data.school?.code}가 담당자에게 이메일로 전송되었습니다.`
          : "거절되었습니다."
        );
        load();
      } else {
        setMessage(data.error || "처리에 실패했습니다.");
      }
    } catch {
      setMessage("오류 발생");
    } finally {
      setProcessing(null);
    }
  }

  const pending = requests.filter((r) => r.status === "pending");
  const processed = requests.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      {/* Header */}
      <PageHeader title="학교 등록 요청">
        <span><strong className="text-slate-900 text-sm">{requests.length}</strong> 건</span>
        {pending.length > 0 && (
          <>
            <StatDivider />
            <span className="text-amber-600 font-medium">{pending.length} 대기</span>
          </>
        )}
      </PageHeader>

      {/* Status message */}
      {message && (
        <div className={`px-4 py-2.5 rounded-xl text-sm ${message.includes("완료") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {message}
        </div>
      )}

      {/* Pending requests */}
      {pending.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-5 rounded-full bg-amber-400" />
            <h2 className="text-sm font-bold text-slate-900">승인 대기</h2>
            <span className="text-xs text-slate-400">{pending.length}건</span>
          </div>
          <div className="space-y-2">
            {pending.map((r) => (
              <div key={r.id} className="bg-white rounded-xl border border-amber-200/60 overflow-hidden">
                <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                      <span className="font-medium text-slate-900">{r.name}</span>
                      {r.nameEn && <span className="text-xs text-slate-400">{r.nameEn}</span>}
                      {r.region && <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{r.region}</span>}
                      {r.domain && <span className="text-[10px] font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">@{r.domain}</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500 ml-4">
                      <span>{r.contactName}</span>
                      <span className="font-mono text-slate-400">{r.contactEmail}</span>
                      <span className="text-slate-300">
                        {new Date(r.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4 sm:ml-0">
                    <Button
                      size="sm"
                      onClick={() => handleAction(r.id, "approve")}
                      disabled={processing === r.id}
                      className="h-7 text-xs bg-slate-900 hover:bg-slate-800"
                    >
                      {processing === r.id ? "처리중..." : "승인"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => handleAction(r.id, "reject")}
                      disabled={processing === r.id}
                    >
                      거절
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pending.length === 0 && (
        <EmptyState icon="✅" title="대기 중인 요청이 없습니다" hint="새 학교 등록 요청이 오면 여기에 표시됩니다." />
      )}

      {/* Processed requests */}
      {processed.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-5 rounded-full bg-slate-300" />
            <h2 className="text-sm font-bold text-slate-900">처리 완료</h2>
            <span className="text-xs text-slate-400">{processed.length}건</span>
          </div>
          <div className="bg-white rounded-xl border overflow-hidden divide-y divide-slate-50">
            {processed.map((r) => (
              <div key={r.id} className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5">
                <StatusDot status={r.status} />
                <StatusChip status={r.status} className="shrink-0" />
                <span className="text-sm font-medium text-slate-900 truncate">{r.name}</span>
                <span className="text-xs text-slate-400 truncate hidden sm:inline">{r.contactEmail}</span>
                <span className="text-[10px] text-slate-300 ml-auto shrink-0">
                  {r.reviewedAt && new Date(r.reviewedAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

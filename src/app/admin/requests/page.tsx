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
  accountRequestId: number | null;
  billingRequestCreatedAt: string | null;
  createdAt: string;
  reviewedAt: string | null;
}



export default function RequestsPage() {
  const [requests, setRequests] = useState<SchoolRequest[]>([]);
  const [processing, setProcessing] = useState<number | null>(null);
  const [billingProcessing, setBillingProcessing] = useState<number | null>(null);
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

  async function createBillingRequest(id: number) {
    setBillingProcessing(id);
    setMessage("");
    try {
      const res = await fetch("/api/school-requests/account-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "계정·청구 요청 생성에 실패했습니다.");
        return;
      }
      setMessage(data.created
        ? `생성 완료: 계정·청구 요청 #${data.accountRequestId}. Jon 발송 후 통합 청구에 편입됩니다.`
        : `연결 완료: 이미 계정·청구 요청 #${data.accountRequestId}과 연결되어 있습니다.`);
      await load();
    } catch {
      setMessage("계정·청구 요청 생성 중 오류가 발생했습니다.");
    } finally {
      setBillingProcessing(null);
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

      <section className="rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3">
        <h2 className="text-sm font-bold text-blue-950">학교 청구 진행 순서</h2>
        <div className="mt-2 grid gap-2 text-xs text-blue-900 sm:grid-cols-3">
          <p><strong>1. 학교 승인</strong><br />학교 코드를 생성하고 담당자에게 발송합니다.</p>
          <p><strong>2. 청구 요청 생성</strong><br />승인된 학교의 버튼을 눌러 학교 계정 1건을 생성합니다.</p>
          <p><strong>3. Jon에게 발송</strong><br />계정 요청 화면에서 검토·발송하면 통합 청구에 편입됩니다.</p>
        </div>
      </section>

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
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-slate-500 ml-4">
                      <span>{r.contactName}</span>
                      <span className="font-mono text-slate-400 break-all">{r.contactEmail}</span>
                      <span className="text-slate-300">
                        {new Date(r.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  </div>
                  <div className="flex w-full items-center gap-2 pl-4 sm:w-auto sm:shrink-0 sm:pl-0">
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
          <div className="bg-white rounded-xl border overflow-hidden divide-y divide-slate-100">
            {processed.map((r) => (
              <article
                key={r.id}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-3 px-4 py-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center"
              >
                <div className="pt-1 lg:pt-0"><StatusDot status={r.status} /></div>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <StatusChip status={r.status} className="shrink-0" />
                    <span className="min-w-0 truncate text-sm font-medium text-slate-900">{r.name}</span>
                  </div>
                  <div className="mt-1 flex min-w-0 flex-col gap-0.5 text-xs text-slate-400 sm:flex-row sm:items-center sm:gap-3">
                    <span className="break-all font-mono">{r.contactEmail}</span>
                    <span className="shrink-0 text-[10px] text-slate-300">
                      {r.reviewedAt && new Date(r.reviewedAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                </div>
                {r.status === "approved" && (
                  <div className="col-span-2 flex min-w-0 justify-end lg:col-span-1 lg:min-w-44">
                    {r.accountRequestId ? (
                      <a
                        href={`/admin/accounts?focus=${r.accountRequestId}`}
                        className="inline-flex h-8 w-full items-center justify-center whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-100 lg:w-auto"
                      >
                        계정·청구 #{r.accountRequestId} 열기
                      </a>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 w-full whitespace-nowrap border-blue-200 text-xs text-blue-700 hover:bg-blue-50 lg:w-auto"
                        onClick={() => createBillingRequest(r.id)}
                        disabled={billingProcessing === r.id}
                      >
                        {billingProcessing === r.id ? "생성 중..." : "학교 계정·청구 요청 생성"}
                      </Button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

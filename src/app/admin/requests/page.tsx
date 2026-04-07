"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface SchoolRequest {
  id: number;
  name: string;
  nameEn: string | null;
  region: string | null;
  contactName: string;
  contactEmail: string;
  status: string;
  rejectReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

const statusBadge: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

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
    <div className="space-y-6">
      <h2 className="text-xl font-bold">
        학교 등록 요청
        {pending.length > 0 && (
          <Badge className="ml-2 bg-yellow-100 text-yellow-800">{pending.length} 대기</Badge>
        )}
      </h2>

      {message && (
        <div className={`p-3 rounded-lg text-sm ${message.includes("완료") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {message}
        </div>
      )}

      {/* Pending */}
      {pending.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-500">승인 대기</h3>
          {pending.map((r) => (
            <Card key={r.id} className="border-yellow-200 bg-yellow-50/30">
              <CardContent className="py-4 px-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{r.name}</p>
                    {r.nameEn && <p className="text-xs text-gray-400">{r.nameEn}</p>}
                    <div className="flex gap-3 mt-2 text-sm text-gray-600">
                      <span>지역: {r.region || "-"}</span>
                      <span>담당자: {r.contactName}</span>
                      <span>{r.contactEmail}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(r.createdAt).toLocaleString("ko-KR")}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => handleAction(r.id, "approve")}
                      disabled={processing === r.id}
                    >
                      {processing === r.id ? "처리 중..." : "승인"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600"
                      onClick={() => handleAction(r.id, "reject")}
                      disabled={processing === r.id}
                    >
                      거절
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {pending.length === 0 && (
        <p className="text-center text-gray-400 py-8">대기 중인 요청이 없습니다</p>
      )}

      {/* Processed */}
      {processed.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-500">처리 완료 ({processed.length})</h3>
          <div className="space-y-2">
            {processed.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-2 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <Badge className={statusBadge[r.status]}>{r.status}</Badge>
                  <span className="text-sm font-medium">{r.name}</span>
                  <span className="text-xs text-gray-400">{r.contactEmail}</span>
                </div>
                <span className="text-xs text-gray-400">
                  {r.reviewedAt && new Date(r.reviewedAt).toLocaleDateString("ko-KR")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

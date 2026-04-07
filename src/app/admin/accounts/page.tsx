"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface AccountRequest {
  id: number;
  type: string;
  schoolName: string;
  emails: string;
  accountType: string;
  quantity: number;
  oldEmail: string | null;
  fromType: string | null;
  extensionDate: string | null;
  notes: string | null;
  status: string;
  invoiceNumber: string | null;
  invoiceAmount: string | null;
  invoiceDueDate: string | null;
  paymentLink: string | null;
  paymentDate: string | null;
  paymentMethod: string | null;
  createdAt: string;
  updatedAt: string;
}

const TYPES = [
  { value: "upgrade", label: "업그레이드", icon: "⬆️" },
  { value: "email_change", label: "이메일 변경", icon: "✉️" },
  { value: "type_change", label: "타입 변경", icon: "🔄" },
  { value: "extension", label: "연장", icon: "📅" },
];

const STATUSES = [
  { value: "draft", label: "Draft", color: "bg-gray-100 text-gray-700" },
  { value: "sent", label: "Sent", color: "bg-amber-100 text-amber-800" },
  { value: "processed", label: "Processed", color: "bg-green-100 text-green-800" },
  { value: "invoiced", label: "Invoiced", color: "bg-blue-100 text-blue-800" },
  { value: "paid", label: "Paid", color: "bg-purple-100 text-purple-800" },
];

export default function AccountsPage() {
  const [requests, setRequests] = useState<AccountRequest[]>([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRequest | null>(null);

  // Form state
  const [fType, setFType] = useState("upgrade");
  const [fSchool, setFSchool] = useState("");
  const [fEmails, setFEmails] = useState("");
  const [fAccType, setFAccType] = useState("teacher");
  const [fQty, setFQty] = useState(1);
  const [fOldEmail, setFOldEmail] = useState("");
  const [fFromType, setFFromType] = useState("");
  const [fExtDate, setFExtDate] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [fInvNum, setFInvNum] = useState("");
  const [fInvAmt, setFInvAmt] = useState("");
  const [fInvDue, setFInvDue] = useState("");
  const [fPayLink, setFPayLink] = useState("");
  const [fPayDate, setFPayDate] = useState("");
  const [fPayMethod, setFPayMethod] = useState("");

  async function load() {
    const res = await fetch("/api/account-requests");
    setRequests(await res.json());
  }

  useEffect(() => { load(); }, []);

  function resetForm() {
    setFType("upgrade"); setFSchool(""); setFEmails(""); setFAccType("teacher");
    setFQty(1); setFOldEmail(""); setFFromType(""); setFExtDate("");
    setFNotes(""); setFInvNum(""); setFInvAmt(""); setFInvDue("");
    setFPayLink(""); setFPayDate(""); setFPayMethod("");
    setEditing(null);
  }

  function openEdit(r: AccountRequest) {
    setEditing(r);
    setFType(r.type); setFSchool(r.schoolName); setFEmails(r.emails);
    setFAccType(r.accountType); setFQty(r.quantity);
    setFOldEmail(r.oldEmail || ""); setFFromType(r.fromType || "");
    setFExtDate(r.extensionDate || ""); setFNotes(r.notes || "");
    setFInvNum(r.invoiceNumber || ""); setFInvAmt(r.invoiceAmount || "");
    setFInvDue(r.invoiceDueDate || ""); setFPayLink(r.paymentLink || "");
    setFPayDate(r.paymentDate || ""); setFPayMethod(r.paymentMethod || "");
    setOpen(true);
  }

  async function save() {
    const data = {
      type: fType, schoolName: fSchool, emails: fEmails, accountType: fAccType,
      quantity: fQty, oldEmail: fOldEmail || null, fromType: fFromType || null,
      extensionDate: fExtDate || null, notes: fNotes || null,
      invoiceNumber: fInvNum || null, invoiceAmount: fInvAmt || null,
      invoiceDueDate: fInvDue || null, paymentLink: fPayLink || null,
      paymentDate: fPayDate || null, paymentMethod: fPayMethod || null,
    };

    await fetch("/api/account-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing
        ? { action: "update", id: editing.id, ...data }
        : { action: "create", ...data }
      ),
    });
    resetForm();
    setOpen(false);
    load();
  }

  async function updateStatus(id: number, status: string) {
    await fetch("/api/account-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", id, status }),
    });
    load();
  }

  async function deleteRequest(id: number) {
    if (!confirm("삭제할까요?")) return;
    await fetch("/api/account-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    load();
  }

  const filtered = requests.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.schoolName.toLowerCase().includes(q) && !r.emails.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const statusCounts = STATUSES.map((s) => ({
    ...s,
    count: requests.filter((r) => r.status === s.value).length,
  }));

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filter === "all" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
        >
          전체 {requests.length}
        </button>
        {statusCounts.map((s) => (
          <button
            key={s.value}
            onClick={() => setFilter(filter === s.value ? "all" : s.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filter === s.value ? "bg-gray-900 text-white" : s.color + " hover:opacity-80"}`}
          >
            {s.label} {s.count}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold">계정 요청</h2>
        <div className="flex gap-2">
          <Input
            placeholder="학교/이메일 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48"
          />
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
            <DialogTrigger className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 h-9 px-4 py-2 cursor-pointer">
              + 새 요청
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editing ? "요청 수정" : "새 요청"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                {/* Type selector */}
                <div className="grid grid-cols-4 gap-1">
                  {TYPES.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => setFType(t.value)}
                      className={`p-2 rounded-lg text-xs text-center transition-colors ${fType === t.value ? "bg-blue-100 ring-1 ring-blue-400 font-semibold" : "bg-gray-50 hover:bg-gray-100"}`}
                    >
                      {t.icon}<br />{t.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-1">
                  <Label>학교명 *</Label>
                  <Input value={fSchool} onChange={(e) => setFSchool(e.target.value)} placeholder="학교명" />
                </div>
                <div className="space-y-1">
                  <Label>이메일 *</Label>
                  <Textarea value={fEmails} onChange={(e) => setFEmails(e.target.value)} placeholder="이메일 (여러 개는 쉼표로 구분)" rows={2} />
                </div>

                {fType === "upgrade" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>계정 타입</Label>
                      <Select value={fAccType} onValueChange={(v) => setFAccType(v ?? "teacher")}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="teacher">교사</SelectItem>
                          <SelectItem value="student">학생</SelectItem>
                          <SelectItem value="school">학교</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>수량</Label>
                      <Input type="number" value={fQty} onChange={(e) => setFQty(parseInt(e.target.value) || 1)} min={1} />
                    </div>
                  </div>
                )}

                {fType === "email_change" && (
                  <div className="space-y-1">
                    <Label>기존 이메일</Label>
                    <Input value={fOldEmail} onChange={(e) => setFOldEmail(e.target.value)} placeholder="변경 전 이메일" />
                  </div>
                )}

                {fType === "type_change" && (
                  <div className="space-y-1">
                    <Label>변경 방향</Label>
                    <div className="flex gap-2">
                      {["teacher", "student"].map((t) => (
                        <button
                          key={t}
                          onClick={() => setFFromType(t)}
                          className={`flex-1 py-2 rounded text-sm ${fFromType === t ? "bg-blue-100 ring-1 ring-blue-400" : "bg-gray-50"}`}
                        >
                          {t === "teacher" ? "교사 → 학생" : "학생 → 교사"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {fType === "extension" && (
                  <div className="space-y-1">
                    <Label>만료일</Label>
                    <Input type="date" value={fExtDate} onChange={(e) => setFExtDate(e.target.value)} />
                  </div>
                )}

                <div className="space-y-1">
                  <Label>메모</Label>
                  <Textarea value={fNotes} onChange={(e) => setFNotes(e.target.value)} rows={2} placeholder="추가 메모" />
                </div>

                {/* Invoice section (only for editing) */}
                {editing && (
                  <details className="border rounded-lg p-3">
                    <summary className="text-sm font-medium cursor-pointer">인보이스/결제 정보</summary>
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <div className="space-y-1">
                        <Label className="text-xs">인보이스 번호</Label>
                        <Input value={fInvNum} onChange={(e) => setFInvNum(e.target.value)} className="text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">금액</Label>
                        <Input value={fInvAmt} onChange={(e) => setFInvAmt(e.target.value)} className="text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">결제 기한</Label>
                        <Input type="date" value={fInvDue} onChange={(e) => setFInvDue(e.target.value)} className="text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">결제 링크</Label>
                        <Input value={fPayLink} onChange={(e) => setFPayLink(e.target.value)} className="text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">결제일</Label>
                        <Input type="date" value={fPayDate} onChange={(e) => setFPayDate(e.target.value)} className="text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">결제 방법</Label>
                        <Input value={fPayMethod} onChange={(e) => setFPayMethod(e.target.value)} className="text-xs" />
                      </div>
                    </div>
                  </details>
                )}

                <Button onClick={save} className="w-full">
                  {editing ? "수정" : "생성"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Request list */}
      <div className="space-y-2">
        {filtered.map((r) => {
          const typeInfo = TYPES.find((t) => t.value === r.type);
          const statusInfo = STATUSES.find((s) => s.value === r.status);
          return (
            <Card key={r.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg">{typeInfo?.icon}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{r.schoolName}</span>
                        <Badge className={`text-[10px] px-1.5 py-0 ${statusInfo?.color}`}>
                          {statusInfo?.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500 font-mono truncate">{r.emails}</p>
                      {r.notes && <p className="text-xs text-gray-400 truncate mt-0.5">{r.notes}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Quick status buttons */}
                    {STATUSES.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => updateStatus(r.id, s.value)}
                        className={`w-6 h-6 rounded-full text-[9px] flex items-center justify-center transition-all ${
                          r.status === s.value
                            ? "ring-2 ring-offset-1 ring-gray-400 " + s.color
                            : "bg-gray-50 text-gray-300 hover:bg-gray-100"
                        }`}
                        title={s.label}
                      >
                        {s.label[0]}
                      </button>
                    ))}
                    <button onClick={() => openEdit(r)} className="ml-2 text-gray-400 hover:text-gray-600 text-sm">✎</button>
                    <button onClick={() => deleteRequest(r.id)} className="text-red-300 hover:text-red-500 text-sm">✕</button>
                  </div>
                </div>
                {/* Invoice info */}
                {(r.invoiceNumber || r.invoiceAmount) && (
                  <div className="mt-2 flex gap-3 text-xs text-gray-500">
                    {r.invoiceNumber && <span>Invoice: {r.invoiceNumber}</span>}
                    {r.invoiceAmount && <span>{r.invoiceAmount}</span>}
                    {r.paymentDate && <span className="text-green-600">Paid: {r.paymentDate}</span>}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-gray-400 py-12">
          {requests.length === 0 ? "계정 요청이 없습니다. '+ 새 요청'을 클릭하세요." : "검색 결과가 없습니다."}
        </p>
      )}
    </div>
  );
}

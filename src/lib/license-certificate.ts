export interface LicensePeriod { start: string; end: string }
export interface LicenseRow { productName: string; planText: string; quantityText: string }

export interface LicenseRequestSource {
  id: number;
  schoolName: string;
  accountType: string | null;
  quantity: number | null;
  type: string;
  fromType: string | null;
  extensionDate: string | null;
}

export interface LicenseDraft {
  schoolName: string;
  contactName: string;
  row: LicenseRow;
  period: LicensePeriod;
  issuedAt: string;
  note: string;
  showAmount: boolean;
  amount: string;
}

export function sanitizeDateInput(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
}

export function formatLicenseDate(value: string): string {
  return sanitizeDateInput(value) ? `${value.split("-").join(". ")}.` : "-";
}

export function formatLicenseDateKorean(value: string): string {
  if (!sanitizeDateInput(value)) return "-";
  const [y, m, d] = value.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

export function buildLicenseDraft(request: LicenseRequestSource, now = new Date()): LicenseDraft {
  const type = request.type === "type_change" && request.fromType
    ? request.fromType === "teacher" ? "student" : "teacher"
    : request.accountType;
  const plan = ({ teacher: "Teacher", student: "Student", school: "School" } as Record<string, string>)[type || ""] || type || "";
  const quantity = Number.isInteger(request.quantity) && Number(request.quantity) > 0
    ? `${request.quantity}${type === "school" ? "개교" : "계정"}` : "";
  return {
    schoolName: request.schoolName,
    contactName: "",
    row: { productName: "Snorkl", planText: plan, quantityText: quantity },
    // 요청일/결제일/본사 확인일은 실제 이용 개시일이 아니다.
    period: { start: "", end: sanitizeDateInput(request.extensionDate) },
    issuedAt: new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10),
    note: "",
    showAmount: false,
    amount: "",
  };
}

export function validateLicenseDraft(draft: LicenseDraft): string | null {
  if (!draft.schoolName.trim()) return "사용기관을 입력해 주세요.";
  if (!draft.row.productName.trim() || !draft.row.planText.trim() || !draft.row.quantityText.trim()) return "제품명·라이선스 종류·수량을 입력해 주세요.";
  if (!sanitizeDateInput(draft.period.start) || !sanitizeDateInput(draft.period.end)) return "실제 사용 시작일과 종료일을 입력해 주세요.";
  if (draft.period.start > draft.period.end) return "종료일은 시작일보다 빠를 수 없어요.";
  if (!sanitizeDateInput(draft.issuedAt)) return "발급일을 입력해 주세요.";
  if (draft.showAmount && (!/^\d+$/.test(draft.amount) || !Number.isSafeInteger(Number(draft.amount)))) return "공급금액을 원 단위의 0 이상 정수로 입력해 주세요.";
  return null;
}

export function licenseFilename(schoolName: string): string {
  return `라이선스확인서_${schoolName.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 80) || "Snorkl"}.pdf`;
}

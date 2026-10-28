/** Shared by the admin form and the create/edit/HQ publication boundaries. */
export function extensionRequestError(input: {
  type?: unknown;
  accountType?: unknown;
  applicantType?: unknown;
  quantity?: unknown;
  extensionDate?: unknown;
}): string | null {
  if (input.type !== "extension") return null;

  const date = input.extensionDate;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return "연장 후 종료일을 YYYY-MM-DD 형식으로 입력해 주세요.";
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return "실제 존재하는 연장 후 종료일을 입력해 주세요.";
  }

  if (input.accountType === "school") {
    if (input.applicantType !== "school") {
      return "학교 단체 연장은 신청 대상을 학교로 선택해 주세요.";
    }
    if (input.quantity !== 1) {
      return "학교 단체 연장은 교사 인원수와 관계없이 수량 1교로 신청해 주세요.";
    }
  } else if (typeof input.quantity !== "number" || !Number.isInteger(input.quantity) || input.quantity < 1) {
    return "연장할 계정 수량은 1 이상의 정수로 입력해 주세요.";
  }
  return null;
}

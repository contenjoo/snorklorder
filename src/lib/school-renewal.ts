interface RenewalSchool {
  name: string;
  nameEn: string | null;
}

interface PreviousSchoolRequest {
  id: number;
  schoolName: string;
  schoolNameEn: string | null;
  accountType: string | null;
  applicantType: string;
  type: string;
  channel: string;
  emails: string;
  status: string;
  archivedAt?: unknown;
  marketVoidState?: string;
  partnerLifecycleState?: string;
}

/** Copy identity only. Each renewal gets its own expiry, confirmation and billing history. */
export function schoolRenewalDraft(school: RenewalSchool, requests: PreviousSchoolRequest[]) {
  const previous = requests.filter((r) =>
    r.accountType === "school" && r.applicantType === "school"
    && (r.type === "upgrade" || r.type === "extension")
    && r.status !== "draft" && !r.archivedAt
    && r.marketVoidState !== "prepared" && r.marketVoidState !== "voided"
    && r.partnerLifecycleState !== "cancelled"
    // Account requests have no school FK. Require both names before reusing an email.
    && r.schoolName.trim() === school.name.trim()
    && Boolean(school.nameEn && r.schoolNameEn?.trim() === school.nameEn.trim()),
  ).sort((a, b) => b.id - a.id)[0];

  return {
    type: "extension",
    applicantType: "school",
    accountType: "school",
    quantity: 1,
    schoolName: school.name,
    schoolNameEn: school.nameEn || previous?.schoolNameEn || "",
    emails: previous?.emails || "",
    channel: previous?.channel === "school_store" ? "school_store" : "company",
    extensionDate: "",
    termYears: 1,
    needsInvoice: true,
  };
}

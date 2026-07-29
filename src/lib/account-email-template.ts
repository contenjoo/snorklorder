export interface AccountEmailInput {
  type: string;
  applicantType?: string;
  schoolName: string;
  schoolNameEn?: string | null;
  emails: string[] | string;
  accountType?: string | null;
  quantity?: number | null;
  oldEmail?: string | null;
  fromType?: string | null;
  extensionDate?: string | null;
  notes?: string | null;
}

export function generateAccountEmail(r: AccountEmailInput): { subject: string; body: string } {
  const accLabel = r.accountType === "teacher" ? "teacher" : r.accountType === "student" ? "student" : "school";
  const school = r.schoolNameEn || r.schoolName;
  const emailStr = Array.isArray(r.emails) ? r.emails.join(", ") : r.emails;
  let subject = "";
  let body = "";

  if (r.type === "upgrade") {
    const isSchool = r.accountType === "school";
    subject = isSchool
      ? `School Upgrade Request – ${school}`
      : `Teacher Upgrade Request – ${school} (${r.quantity || 1} ${accLabel})`;
    const emailList = emailStr.split(/[,;\n]+/).map((e) => e.trim()).filter(Boolean).map((e) => `- Email: ${e}`).join("\n");
    body = isSchool
      ? `Hi Cailie,\n\nI'd like to request a school-wide upgrade for ${school}.\n\n${emailList}${r.notes ? `\n\nNote: ${r.notes}` : ""}\n\nPlease let me know once it's done. Thank you.\n\nBanghyun`
      : `Hi Cailie,\n\nI'd like to request an upgrade for ${r.quantity || 1} ${accLabel} account${(r.quantity || 1) > 1 ? "s" : ""} for ${school}.\n\n${emailList}${r.notes ? `\n\nNote: ${r.notes}` : ""}\n\nPlease let me know once it's done. Thank you.\n\nBanghyun`;
  } else if (r.type === "email_change") {
    subject = `Account Email Change Request – ${school}`;
    body = `Hi Cailie,\n\nCould you please update the email for the account at ${school}?\n\n- Old email: ${r.oldEmail || ""}\n- New email: ${emailStr || ""}${r.notes ? `\n\nNote: ${r.notes}` : ""}\n\nThank you.\n\nBanghyun`;
  } else if (r.type === "type_change") {
    subject = `Account Type Change Request - ${emailStr}`;
    body = `Hi Cailie,\n\nThe account ${emailStr || ""} was registered as a ${r.fromType === "teacher" ? "teacher" : "student"}, but this user is a ${r.fromType === "teacher" ? "student" : "teacher"}. Could you please change the account type?${r.notes ? `\n\nNote: ${r.notes}` : ""}\n\nThank you.\n\nBanghyun`;
  } else if (r.type === "extension") {
    subject = `Account Extension Request – ${school}`;
    body = `Hi Cailie,\n\nCould you extend the ${emailStr || ""} account through ${r.extensionDate || "[DATE]"}?\n\nPlease send me an invoice for that too.${r.notes ? `\n\nNote: ${r.notes}` : ""}\n\nThanks,\n\nBanghyun`;
  } else {
    subject = `Snorkl Request – ${school}`;
    body = `Hi Cailie,\n\n${r.notes || ""}\n\nBanghyun`;
  }
  return { subject, body };
}

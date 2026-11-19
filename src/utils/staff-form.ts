import { isValidTurkishPhoneInput } from './phone';
export type StaffDraft = { role: '' | 'teacher' | 'security'; fullName: string; branch: string; phone: string; email: string };
export function validateStaffForm(draft: StaffDraft) {
  const errors: Partial<Record<keyof StaffDraft, string>> = {};
  if (!draft.role) errors.role = 'Görev seçin.';
  const names = draft.fullName.trim().split(/\s+/);
  if (names.length < 2 || draft.fullName.trim().length > 150 || names.some((name) => name.length > 100)) errors.fullName = 'Geçerli bir ad ve soyad girin.';
  if (!isValidTurkishPhoneInput(draft.phone)) errors.phone = 'Telefonu 0XXX XXX XX XX biçiminde girin.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()) || draft.email.trim().length > 150) errors.email = 'Geçerli bir e-posta adresi girin.';
  if (draft.role === 'teacher' && (!draft.branch.trim() || draft.branch.trim().length > 100)) errors.branch = 'Branş girin.';
  return errors;
}

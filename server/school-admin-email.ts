import { sendEmail } from './email';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function schoolAdminEmail(
  schoolName: string,
  schoolCode: string,
  fullName: string,
  code: string,
  reset = false
): { subject: string; html: string } {
  const codeLabel = reset ? 'Parola Sıfırlama Kodu' : 'Aktivasyon Kodu';
  const instructions = reset
    ? 'Veli Randevu giriş ekranında “Şifremi unuttum” seçeneğini, ardından “Okul yöneticisi” seçimini kullanın.'
    : 'Veli Randevu giriş ekranındaki “Okul Yöneticisi İlk Giriş” butonuna basın. Okul kodunuzu, telefon numaranızı ve 6 haneli aktivasyon kodunu girerek kendi şifrenizi oluşturun.';
  return {
    subject: `Veli Randevu Okul Yönetimi ${reset ? 'Parola Sıfırlama' : 'İlk Giriş'}`,
    html: `<p>Merhaba ${escapeHtml(fullName)},</p><p>${escapeHtml(schoolName)} için ${reset ? 'parola sıfırlama' : 'ilk hesap aktivasyonu'} bilgileri aşağıdadır.</p><p style="margin-bottom:4px;font-weight:600">Okul Kodu</p><p style="font-size:26px;font-weight:bold;letter-spacing:3px;margin-top:0">${escapeHtml(schoolCode.toUpperCase())}</p><p style="margin-bottom:4px;font-weight:600">${codeLabel}</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px;margin-top:0">${escapeHtml(code)}</p><p>${instructions}</p><p>Kod ${reset ? '15 dakika' : '24 saat'} içinde sona erer ve tek kullanımlıdır.</p><p>Veli Randevu</p>`,
  };
}

export async function deliverSchoolAdminCode(
  to: string,
  schoolName: string,
  schoolCode: string,
  fullName: string,
  code: string,
  reset = false
): Promise<boolean> {
  try {
    await sendEmail({ to, ...schoolAdminEmail(schoolName, schoolCode, fullName, code, reset) });
    return true;
  } catch {
    return false;
  }
}

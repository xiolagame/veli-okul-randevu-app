import { sendEmail } from './email';
import { renderBrandedEmail } from './email-template';

export function schoolAdminEmail(
  schoolName: string,
  schoolCode: string,
  fullName: string,
  code: string,
  reset = false,
  licenseCode?: string
): { subject: string; html: string; text: string } {
  const codeLabel = reset ? 'Parola Sıfırlama Kodu' : 'Aktivasyon Kodu';
  const instructions = reset
    ? 'Veli Randevu giriş ekranında “Şifremi unuttum” seçeneğini, ardından “Okul yöneticisi” seçimini kullanın.'
    : `Veli Randevu giriş ekranındaki “Okul Yöneticisi İlk Giriş” bölümünü açın. Okul kodunuz, telefon numaranız${licenseCode ? ', lisans kodunuz' : ''} ve aktivasyon kodunuz ile hesabınızı etkinleştirin. Ardından kendi şifrenizi oluşturabilirsiniz.`;
  const rendered = renderBrandedEmail({
    subtitle: `Okul Yönetimi ${reset ? 'Parola Sıfırlama' : 'Hesabınız Hazır'}`,
    greeting: fullName,
    intro: [`${schoolName} için ${reset ? 'parola sıfırlama' : 'ilk hesap aktivasyonu'} bilgileri aşağıdadır.`, instructions],
    infoCards: [
      { label: 'Okul Kodu', value: schoolCode.toUpperCase() },
      ...(licenseCode ? [{ label: 'Lisans Kodunuz', textLabel: 'Lisans Kodu', value: licenseCode.toUpperCase() }] : []),
      { label: codeLabel, value: code, tone: 'accent' as const },
    ],
    notice: `Kod ${reset ? '15 dakika' : '24 saat'} içinde sona erer ve tek kullanımlıdır.`,
  });
  return {
    subject: `Veli Randevu Okul Yönetimi ${reset ? 'Parola Sıfırlama' : 'İlk Giriş'}`,
    ...rendered,
  };
}

export async function deliverSchoolAdminCode(
  to: string,
  schoolName: string,
  schoolCode: string,
  fullName: string,
  code: string,
  reset = false,
  licenseCode?: string
): Promise<boolean> {
  try {
    await sendEmail({ to, ...schoolAdminEmail(schoolName, schoolCode, fullName, code, reset, licenseCode) });
    return true;
  } catch {
    return false;
  }
}

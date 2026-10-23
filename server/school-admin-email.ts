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
    notice: reset
      ? 'Kod 15 dakika içinde sona erer. Bu kod tek kullanımlıktır.'
      : 'Kod 24 saat içinde sona erer ve tek kullanımlıdır.',
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

export async function deliverUnifiedAdminActivationEmail(
  to: string,
  schoolName: string,
  schoolCode: string,
  fullName: string,
  emailCode: string,
  licenseCode?: string,
): Promise<boolean> {
  try {
    const content = renderBrandedEmail({
      subtitle: 'Okul Yönetimi — E-posta Doğrulaması',
      greeting: fullName,
      intro: [
        `${schoolName} için WhatsApp telefon doğrulamanız tamamlandı.`,
        'Okul ve lisans kodunuz bilgilendirme amaçlıdır; bu kodlar giriş parolası değildir.',
        'Veli Randevu giriş ekranındaki e-posta doğrulama alanına aşağıdaki 6 haneli kodu girin.',
      ],
      infoCards: [
        { label: 'Okul Kodu', value: schoolCode.toUpperCase() },
        ...(licenseCode ? [{ label: 'Lisans Kodu', value: licenseCode.toUpperCase() }] : []),
        { label: 'E-posta Doğrulama Kodu', value: emailCode, tone: 'accent' },
      ],
      notice: 'Doğrulama kodu 10 dakika geçerli ve yalnızca bir kez kullanılabilir.',
    });
    await sendEmail({ to, subject: 'Veli Randevu — Okul Yönetimi E-posta Doğrulaması', ...content });
    return true;
  } catch {
    return false;
  }
}

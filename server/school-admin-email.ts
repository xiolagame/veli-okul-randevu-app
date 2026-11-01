import { sendEmail } from './email';
import { renderBrandedEmail, verificationEmailSubject } from './email-template';

export function schoolAdminEmail(
  schoolName: string,
  schoolCode: string,
  fullName: string,
  code: string,
  reset = false,
  licenseCode?: string
): { subject: string; html: string; text: string } {
  const codeLabel = reset ? 'Parola Sıfırlama Kodu' : 'E-posta Doğrulama Kodu';
  const instructions = reset
    ? 'Veli Randevu giriş ekranında “Şifremi unuttum” seçeneğini, ardından “Okul yöneticisi” seçimini kullanın.'
    : `Okul yöneticisi hesabınızı etkinleştirmek için yukarıdaki e-posta doğrulama kodunu kullanın. Bu ilk davet kodu “Okul Yöneticisi İlk Giriş” akışına aittir. WhatsApp ile giriş yapıyorsanız bu kodu kullanmayın; telefon doğrulamasından sonra gönderilen yeni e-postadaki güncel kodu girin. Eski ilk giriş akışında okul kodunuz, telefon numaranız${licenseCode ? ', lisans kodunuz' : ''} ve bu davet kodu kullanılır.`;
  const rendered = renderBrandedEmail({
    subtitle: `Okul Yönetimi ${reset ? 'Parola Sıfırlama' : 'Hesabınız Hazır'}`,
    greeting: fullName,
    verificationCode: { label: codeLabel, value: code, tone: 'accent' },
    intro: [`${schoolName} için ${reset ? 'parola sıfırlama' : 'ilk hesap aktivasyonu'} bilgileri aşağıdadır.`, instructions],
    infoCards: [
      { label: 'Okul Kodu', value: schoolCode.toUpperCase() },
      ...(licenseCode ? [{ label: 'Lisans Kodunuz', textLabel: 'Lisans Kodu', value: licenseCode.toUpperCase() }] : []),
    ],
    notice: reset
      ? 'Kod 15 dakika içinde sona erer. Bu kod tek kullanımlıktır.'
      : 'Kod 24 saat içinde sona erer ve tek kullanımlıdır.',
  });
  return {
    subject: verificationEmailSubject(code),
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
      verificationCode: { label: 'E-posta Doğrulama Kodu', value: emailCode, tone: 'accent' },
      intro: [
        `${schoolName} için WhatsApp telefon doğrulamanız tamamlandı.`,
        'Okul yöneticisi hesabınızı etkinleştirmek için yukarıdaki e-posta doğrulama kodunu kullanın.',
        'Giriş ekranındaki e-posta doğrulama alanına bu güncel 6 haneli kodu ve istendiğinde okul kodunuzu girin. İlk davet e-postasındaki kodu kullanmayın.',
        'Lisans kodunuz bilgilendirme amaçlıdır; giriş parolası değildir.',
      ],
      infoCards: [
        { label: 'Okul Kodu', value: schoolCode.toUpperCase() },
        ...(licenseCode ? [{ label: 'Lisans Kodu', value: licenseCode.toUpperCase() }] : []),
      ],
      notice: 'Doğrulama kodu 10 dakika geçerli ve yalnızca bir kez kullanılabilir.',
    });
    await sendEmail({ to, subject: verificationEmailSubject(emailCode), ...content });
    return true;
  } catch {
    return false;
  }
}

export async function deliverPlatformLoginEmail(to: string, fullName: string, emailCode: string): Promise<boolean> {
  try {
    const content = renderBrandedEmail({
      subtitle: 'Platform Yönetimi — İkinci Doğrulama',
      greeting: fullName,
      verificationCode: { label: 'E-posta Doğrulama Kodu', value: emailCode, tone: 'accent' },
      intro: [
        'WhatsApp telefon doğrulamanız tamamlandı.',
        'Platform Yönetimi oturumunu açmak için yukarıdaki bağımsız e-posta kodunu giriş ekranına yazın.',
      ],
      notice: 'Kod 10 dakika geçerli, tek kullanımlıdır ve WhatsApp kodundan farklıdır.',
    });
    await sendEmail({ to, subject: verificationEmailSubject(emailCode), ...content });
    return true;
  } catch {
    return false;
  }
}

export async function deliverPlatformPhoneBindingEmail(to: string, fullName: string, emailCode: string): Promise<boolean> {
  try {
    const content = renderBrandedEmail({
      subtitle: 'Platform Yönetimi — Telefon Bağlama',
      greeting: fullName,
      verificationCode: { label: 'E-posta Doğrulama Kodu', value: emailCode, tone: 'accent' },
      intro: [
        'Platform hesabınıza yeni bir WhatsApp telefonu bağlama işlemi başlatıldı.',
        'İşlemi siz başlattıysanız yukarıdaki e-posta kodunu Platform Yönetimi ekranına yazın. Ardından yeni telefon ayrıca WhatsApp koduyla doğrulanacaktır.',
      ],
      notice: 'Kod 10 dakika geçerli ve tek kullanımlıdır. Bu kod telefon doğrulama kodundan farklıdır.',
    });
    await sendEmail({ to, subject: verificationEmailSubject(emailCode), ...content });
    return true;
  } catch {
    return false;
  }
}

export async function deliverPlatformInitialEmailVerification(to: string, fullName: string, emailCode: string): Promise<boolean> {
  try {
    const content = renderBrandedEmail({
      subtitle: 'Platform Yönetimi — İlk E-posta Doğrulaması',
      greeting: fullName,
      verificationCode: { label: 'E-posta Doğrulama Kodu', value: emailCode, tone: 'accent' },
      intro: [
        'Platform hesabınız için ilk e-posta tanımlama işlemi başlatıldı.',
        'E-posta adresinin size ait olduğunu doğrulamak için yukarıdaki tek kullanımlık kodu Platform Yönetimi ekranına yazın.',
      ],
      notice: 'Kod 10 dakika geçerli ve tek kullanımlıdır. İşlemi siz başlatmadıysanız kodu paylaşmayın.',
    });
    await sendEmail({ to, subject: verificationEmailSubject(emailCode), ...content });
    return true;
  } catch {
    return false;
  }
}

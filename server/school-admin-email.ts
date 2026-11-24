import { sendEmail } from './email';
import { renderBrandedEmail, verificationEmailSubject } from './email-template';

// Okul yöneticisi eklendiğinde giden bilgilendirme e-postası. Kod, okul kodu veya parola içermez:
// yönetici telefon numarasıyla girer ve WhatsApp koduyla doğrulanır. E-posta adresi yalnız lisans hatırlatmaları içindir.
export function schoolAdminInvitationEmail(
  schoolName: string,
  fullName: string,
): { subject: string; html: string; text: string } {
  const rendered = renderBrandedEmail({
    subtitle: 'Okul Yönetimi — Hesabınız Hazır',
    greeting: fullName,
    intro: [
      `${schoolName} için okul yöneticisi hesabınız oluşturuldu.`,
      'Veli Randevu uygulamasını açın, bu bilgilendirmenin gönderildiği telefon numaranızı yazın ve WhatsApp ile gelen 6 haneli kodu girin. Parola, okul kodu veya lisans kodu gerekmez.',
      'Bu e-posta adresi yalnızca lisans hatırlatmaları ve bilgilendirmeler için kullanılır.',
    ],
    notice: 'Hesabınız 7 gün içinde ilk girişinizle etkinleşir.',
  });
  return { subject: 'Okul yöneticisi hesabınız hazır', ...rendered };
}

export async function deliverSchoolAdminInvitation(to: string, schoolName: string, fullName: string): Promise<boolean> {
  try {
    await sendEmail({ to, ...schoolAdminInvitationEmail(schoolName, fullName) });
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

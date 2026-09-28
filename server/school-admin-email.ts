import { sendEmail } from './email';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

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
  const safeName = escapeHtml(fullName);
  const safeSchool = escapeHtml(schoolName);
  const safeSchoolCode = escapeHtml(schoolCode.toUpperCase());
  const safeLicenseCode = licenseCode ? escapeHtml(licenseCode.toUpperCase()) : '';
  const safeCode = escapeHtml(code);
  const licenseCard = licenseCode ? `<tr><td style="padding:0 32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:16px"><tr><td style="padding:18px;text-align:center"><div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:1.4px;color:#047857">LİSANS KODUNUZ</div><div style="margin-top:6px;font-size:26px;line-height:34px;font-weight:800;letter-spacing:2px;color:#064e3b">${safeLicenseCode}</div></td></tr></table></td></tr>` : '';
  const text = `VELİ RANDEVU\n\nMerhaba ${fullName},\n\n${schoolName} için ${reset ? 'parola sıfırlama' : 'okul yönetimi hesabı'} bilgileriniz hazır.\nOkul Kodu: ${schoolCode.toUpperCase()}${licenseCode ? `\nLisans Kodu: ${licenseCode.toUpperCase()}` : ''}\n${codeLabel}: ${code}\n\n${instructions}\n\nKod ${reset ? '15 dakika' : '24 saat'} içinde sona erer ve tek kullanımlıdır.`;
  return {
    subject: `Veli Randevu Okul Yönetimi ${reset ? 'Parola Sıfırlama' : 'İlk Giriş'}`,
    text,
    html: `<!doctype html><html><body style="margin:0;padding:0;background:#e8eef0;font-family:Arial,sans-serif;color:#17332b"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#e8eef0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 12px 34px rgba(15,64,52,.14)"><tr><td style="padding:28px 32px;background:#064e3b;text-align:center"><img src="https://velirokulrandevu.netlify.app/branding/veli-randevu-logo.png" width="72" height="72" alt="Veli Randevu" style="display:block;margin:0 auto 12px;max-width:72px;height:auto"><div style="font-size:24px;line-height:30px;font-weight:800;color:#ffffff">VELİ RANDEVU</div><div style="margin-top:5px;font-size:14px;line-height:20px;color:#d1fae5">Okul Yönetimi ${reset ? 'Parola Sıfırlama' : 'Hesabınız Hazır'}</div></td></tr><tr><td style="padding:30px 32px 18px"><p style="margin:0 0 14px;font-size:16px;line-height:24px">Merhaba <strong>${safeName}</strong>,</p><p style="margin:0;font-size:15px;line-height:24px;color:#475569"><strong>${safeSchool}</strong> için ${reset ? 'parola sıfırlama' : 'ilk hesap aktivasyonu'} bilgileri aşağıdadır.</p></td></tr><tr><td style="padding:0 32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px"><tr><td style="padding:18px;text-align:center"><div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:1.4px;color:#64748b">OKUL KODU</div><div style="margin-top:6px;font-size:26px;line-height:34px;font-weight:800;letter-spacing:3px;color:#0f172a">${safeSchoolCode}</div></td></tr></table></td></tr>${licenseCard}<tr><td style="padding:0 32px 18px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:16px"><tr><td style="padding:18px;text-align:center"><div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:1.4px;color:#c2410c">${codeLabel.toUpperCase()}</div><div style="margin-top:6px;font-size:28px;line-height:36px;font-weight:800;letter-spacing:4px;color:#7c2d12">${safeCode}</div></td></tr></table></td></tr><tr><td style="padding:0 32px 30px"><p style="margin:0 0 12px;font-size:15px;line-height:24px;color:#334155">${instructions}</p><p style="margin:0;font-size:13px;line-height:20px;color:#64748b">Kod ${reset ? '15 dakika' : '24 saat'} içinde sona erer ve tek kullanımlıdır.</p></td></tr><tr><td style="padding:18px 32px;background:#f8fafc;text-align:center;font-size:12px;line-height:18px;color:#64748b">Veli Randevu · Okul Veli Randevu Sistemi</td></tr></table></td></tr></table></body></html>`,
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

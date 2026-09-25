const events: Record<string, [string, string]> = {
  'Öğretmen Aktivasyonu': ['Öğretmen hesabı aktifleştirildi.', 'success'],
  'Güvenlik Aktivasyonu': ['Güvenlik hesabı aktifleştirildi.', 'success'],
  'Hesap Aktivasyonu': ['Hesap aktifleştirildi.', 'success'],
  'Parola Sıfırlama': ['Parola sıfırlandı.', 'info'],
  'Veli Kaydı (Onboarding)': ['Veli okul kaydı tamamlandı.', 'success'],
  'Okuldan Çıkış Yapıldı': ['Ziyaretçinin çıkışı kaydedildi.', 'teal'],
  'Aktivasyon Kodu Oluşturuldu': ['Aktivasyon kodu oluşturuldu.', 'info'],
  'Parola Sıfırlama Kodu Oluşturuldu': ['Parola sıfırlama kodu oluşturuldu.', 'info'],
  'parent.removed': ['Veli okuldan kaldırıldı.', 'rose'],
  'teacher_deleted': ['Öğretmen sistemden kaldırıldı.', 'rose'],
  'teacher.removed': ['Öğretmen erişimi kaldırıldı.', 'rose'],
  'security.removed': ['Güvenlik personeli okuldan kaldırıldı.', 'rose'],
  'admin_staff_created': ['Personel eklendi.', 'success'],
  'teacher.created': ['Öğretmen eklendi.', 'success'],
  'staff_activation_email_sent': ['Aktivasyon e-postası gönderildi.', 'success'],
  'staff_activation_email_resent': ['Aktivasyon e-postası yeniden gönderildi.', 'info'],
  'staff_password_reset_email_sent': ['Parola sıfırlama e-postası gönderildi.', 'info'],
  'staff_activation_completed': ['Personel hesabı aktifleştirildi.', 'success'],
  'staff_password_reset_completed': ['Personel parolası sıfırlandı.', 'info'],
  'parent_self_registration_completed': ['Veli hesabı oluşturuldu.', 'success'],
  'parent_password_reset_completed': ['Veli parolası sıfırlandı.', 'info'],
  'roster.bulk_imported': ['Toplu öğrenci/veli kaydı eklendi.', 'success'],
  'Kütük Yükleme (CSV/Excel)': ['Toplu öğrenci/veli kaydı eklendi.', 'success'],
  'Randevu Talebi': ['Randevu talebi oluşturuldu.', 'warning'],
  'Randevu Onayı': ['Randevu onaylandı.', 'success'],
  'Randevu Reddi': ['Randevu reddedildi.', 'danger'],
  'Randevu İptali': ['Randevu iptal edildi.', 'rose'],
  'QR Giriş Doğrulandı': ['Ziyaretçi girişi doğrulandı.', 'teal'],
  'appointment.expired': ['Randevunun süresi doldu.', 'neutral'],
  'teacher.updated': ['Öğretmen bilgileri güncellendi.', 'info'],
  'parent.updated': ['Veli bilgileri güncellendi.', 'info'],
  'student.updated': ['Öğrenci bilgileri güncellendi.', 'info'],
  'security.updated': ['Personel bilgileri güncellendi.', 'info'],
  'roster.updated': ['Kütük kaydı güncellendi.', 'info'],
  'school.created': ['Okul oluşturuldu.', 'success'],
  'school.disabled': ['Okul devre dışı bırakıldı.', 'warning'],
  'school.enabled': ['Okul etkinleştirildi.', 'success'],
};

export function auditDisplay(action: string, details: string) {
  const [label, tone] = Object.prototype.hasOwnProperty.call(events, action) ? events[action] : ['Sistem işlemi gerçekleştirildi.', 'neutral'];
  let summary = '';
  try {
    const data: unknown = JSON.parse(details);
    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      const count = action === 'teacher_deleted' ? record.deletedAppointments : action === 'roster.bulk_imported' ? record.addedCount : undefined;
      if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) summary = (action === 'teacher_deleted' ? 'Silinen randevu: ' : 'Eklenen kayıt: ') + count;
    }
  } catch {}
  return { label, tone, summary };
}

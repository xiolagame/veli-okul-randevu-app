# PRD — VELİ (Okul Randevu Sistemi)

## Original Problem Statement
Bir okulda öğretmenim; okulumuzda öğrencisi olan veliler için bir randevu sistemi istiyorum. Öğretmenler velilere haftanın belirli gün/saatlerinde randevular verecek ve bunları yönetecek. Okul güvenliği de bu sistemi kullanarak o saatte randevusu olan veliyi okula alacak.

## Güncel Direktifler (son mass-update)
- **SADECE telefon + şifre ile giriş** — e-posta bağımlılığı tamamen kaldırıldı (backend + frontend).
- **Bottom Tabs menü** — Veli: Ana Sayfa, Öğretmenler, Randevularım, Bildirimler, Profil. Öğretmen: Ana Sayfa, Randevular, Bildirimler, Profil.
- Uygulama yalnızca randevu odaklı kalır; ek özellik eklenmez.
- Giriş ekranında yüklenen okul hero fotoğrafı kullanılır.
- Randevu çakışmaları, öğretmen onayı (onaysız QR yok) ve geçmiş/gelecek kısıtları korunur.

## User Personas
1. **Veli**: Çocuğuyla ilgili görüşmek için öğretmenlerden uygun saatlerde randevu alır; onaylanınca QR'lı giriş belgesini gösterir.
2. **Öğretmen**: Haftalık müsaitlik programını tanımlar, gelen talepleri onaylar/reddeder, randevu listesini görür.
3. **Güvenlik**: Kapıda 6 haneli kod/QR sorgulayıp bugüne ait randevuya giriş-çıkış kaydeder.

## Mimari
- **Backend**: FastAPI (`/app/backend/server.py`, `/api/*` prefix) + MongoDB (`test_database`). JWT (Bearer, 7 gün), bcrypt. Pydantic modeller; `_id` asla döndürülmez (soft-delete deseni: `active`, `deleted_at`, `disabled`).
- **Frontend**: Expo (SDK 57) + expo-router dosya tabanlı yönlendirme, React Query, expo-image, react-native-qrcode-svg, expo-camera (güvenlik), expo-notifications (Firebase push).
- **Kimlik**: `users.phone` (kanonik `+905XXXXXXXXX`, unique partial index). Normalizasyon frontend (`src/lib/phone.ts`) + backend (`normalize_phone`) aynı kuralda.
- **Tab mimarisi**: `(tabs)` route grupları; iOS 26+ `NativeTabs` (Liquid Glass), diğer platformlar klasik `Tabs`. Stack ekranları: veli için `teacher/[id]`, `pass/[id]`; öğretmen için `availability`.

## Key Endpoints
- Auth: `POST /api/auth/register|login|forgot-password/verify|forgot-password`, `GET /api/auth/me`
- Profil: `PATCH /api/profile` (telefon, branş), `POST/DELETE /api/profile/students[/{id}]`
- Öğretmen: `GET/POST/DELETE /api/teacher/availability*`, `GET /api/teacher/appointments`, `POST /api/teacher/appointments/{id}/approve|cancel`
- Veli: `GET /api/teachers`, `GET /api/slots?teacher_id&date`, `POST/GET /api/parent/appointments[/{id}]`, `POST /api/parent/appointments/{id}/cancel`
- Bildirim: `GET /api/notifications`, `POST /api/notifications/read-all`, `POST /api/register-push`
- Güvenlik: `GET /api/security/today`, `GET /api/security/verify/{code}`, `POST /api/security/checkin|checkout/{id}`

## Durum Akışı (Randevu)
`pending` →(öğretmen onayı + 6 haneli entry_code)→ `booked` →(güvenlik giriş)→ `checked_in` →(çıkış)→ `checked_out`; `pending` reddedilir → `rejected`; aktif randevu iptal → `cancelled`. Geçmiş onaylı randevular görüntüde `completed`.

## Yapılanlar (2026 itibarıyla)
- 2026-06: Telefon+şifre auth'a tam geçiş (backend migrate + normalize + unique index).
- 2026-06: Rol bazlı Bottom Tabs (veli 5, öğretmen 4 sekme) + öğretmen müsaitlik ekranı, doğrudan URL auth guard'ı, login hero fotoğrafı.
- 2026-06: Güvenlik sorusu tabanlı şifre kurtarma (bcrypt hashli cevap, 3 adım, 5 hatada 15 dk kilit). Kayıt/profilde güvenlik sorusu; profilde mevcut şifre ile değiştirme.
- 2026-06: Gizli Admin paneli (login logoya 7 dokunuş → /admin), backend secret erişim kodu, ayrı kısa ömürlü admin JWT, require_admin (403), Dashboard/Kullanıcılar/Randevular/Ayarlar/Log bölümleri, şifre sıfırlama (geçici şifre), güvenlik sorusu yenileme, soft delete, audit log, çalışma zamanında kod değiştirme.
- 2026-06: Testler — 75/75 pytest (57 randevu + 18 admin/recovery), frontend E2E doğrulandı (iteration_8). (backend migrate + normalize + unique index, 57/57 pytest yeşil).
- 2026-06: Frontend auth ekranları (login hero fotoğraflı, register rol seçici, telefon bazlı şifremi unuttum).
- 2026-06: Veli 5 sekmeli Bottom Tabs + Ana Sayfa hero kartı, öğretmen listesi/arama, Randevularım (Yaklaşan/Geçmiş), Bildirimler (okunmamış rozeti + tümünü oku), Profil (telefon güncelleme, çoklu öğrenci ekleme/silme, çıkış).
- 2026-06: Öğretmen 4 sekmeli panel + müsaitlik programı stack ekranı (gün filtresi, Müsait/Engelli, seans süresi, silme), Randevular sekmesinde Onayla/Reddet.
- 2026-06: Doğrudan URL auth guard'ı (tabs layout'larında login'e yönlendirme).
- 2026-06: Firebase `google-services.json` ile push entegrasyonu, bildirim derin linkleri.
- 2026-06: E2E doğrulama (iteration_7): tüm akışlar + 57/57 backend testi. Test kimlik bilgileri `/app/memory/test_credentials.md`'de güncel.

## Prioritized Backlog
- **P0**: —
- **P1**: Production build sonrası push testleri (Expo Go'da çalışmaz); security tarafı için tab bar (şu an tek ekran, ihtiyaç halinde).
- **P2**: Bildirim sayfalama/okundu-tekil endpoint; öğretmen için randevu notu; veli için randevu hatırlatma görünümü iyileştirmeleri.
- Kapsam dışı (kullanıcı isteği): uygulama randevu dışı özellik eklemiyor.

## Sonraki Adımlar
1. Publish → Android/iOS build alındıktan sonra push bildirimlerinin gerçek cihazda doğrulanması.
2. İstenirse güvenlik rolüne de bottom tab menü.

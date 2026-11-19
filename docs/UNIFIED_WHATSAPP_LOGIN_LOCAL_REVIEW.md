# Veli Randevu — Tek Telefonla Giriş / Yerel İnceleme Adayı

**Durum:** Deneysel geliştirme adayı. Üretime hazır değildir. ZIP içerisindeki kaynak kod, 23 Ekim 2026'da paylaşılan V2 ZIP kopyasından türetilmiştir. Çalışan Windows proje klasörü değiştirilmedi.

## Tasarım

- `WHATSAPP_AUTH_ENABLED=true` ve **ayrıca** `WHATSAPP_UNIFIED_LOGIN_ENABLED=true` olduğunda yeni tek-telefon giriş ekranı görünür. Her iki bayrak varsayılan olarak kapalıdır.
- Veli, öğretmen, güvenlik ve okul yöneticisi telefon numarası üzerinden otomatik olarak değerlendirilir. Rol tespiti yalnız sunucuda yapılır. Kaydı olmayan telefonlara aynı genel yanıt verilir.
- Aktif veli/öğretmen/güvenlik üyelikleri WhatsApp OTP ile mevcut kullanıcı hesabına girer.
- Aynı telefonun tek bir okulda henüz sahiplenilmemiş bir veli kütüğü bulunuyorsa, veli ilk girişte öğrenci doğum tarihi ve okul kodu sormadan otomatik eşleştirilir.
- Henüz etkinleşmemiş tek öğretmen veya güvenlik kaydı varsa WhatsApp OTP ile personel üyeliği oluşturulur.
- Önceden kayıtlı, henüz etkinleşmemiş tek okul yöneticisi daveti varsa WhatsApp OTP başarıyla doğrulandıktan sonra kayıtlı e-postaya 10 dakika geçerli ek bir kod; okul kodu ve lisans kodu **bilgilendirme amacıyla** gönderilir. E-posta kodu da doğrulanmadan yönetici yetkisi verilmez. Lisans kodu giriş parolası değildir.
- Aktif tek okul yöneticisi sonraki girişlerde WhatsApp OTP kullanır. Bu yönetici oturumları `auth_method=whatsapp_admin` ile ayrılır; platform yönetimi yetkisi vermez.
- Platform Admin eski şifre tabanlı, ayrı giriş yolunda kalır.
- İki aşama açıksa eski yönetici ilk aktivasyon endpointleri kapatılır. Bayrak kapalıyken eski akış değiştirilmez.

## Kritik güvenlik kuralları

- Tek numara hem `admin` hem başka aktif role bağlıysa otomatik giriş seçilmez; yetki tahmin edilmez.
- İlk kayıt birden fazla bağımsız okul/kişi/personel kaydıyla eşleşiyorsa otomatik hesap sahiplenilmez; yönetici tarafından kayıt düzeltmesi gerekir.
- Kayıtsız veya kararsız telefon için sahte challengeId döndürülür; gönderim yapılmaz.
- Admin ilk aktivasyonu için aktif davet + WhatsApp + e-posta kanıtı + lisans + okul üyeliği gerekir.
- JWT'nin imzalı `auth_method` alanı kontrolleri korunur. OTP oturumları Platform Admin yetkisi kazanamaz.
- E-posta kodu HMAC hash olarak veritabanında tutulur; e-posta adresine bağlanır ve deneme sınırı uygulanır.
- `WHATSAPP_UNIFIED_LOGIN_ENABLED=false` olduğunda eski üç sekmeli WhatsApp ekranı değişmeden kalır. `WHATSAPP_AUTH_ENABLED=false` olduğunda parola ekranı görünür.

## Değişiklikler

- `server/whatsapp-auth.ts`: Sunucuda otomatik çözümleme, yönetici OTP/e-posta aşamaları ve yeni OTP amaçları.
- `server/whatsapp-cloud.ts`: Ayrı ve varsayılan kapalı birleşik giriş bayrağı.
- `server/api.ts`: Yeni /auto isteği, yönetici e-posta tamamlanması, feature-flag, eski yönetici ilk aktivasyon koruması.
- `server/auth.ts`: `whatsapp_admin` oturum yöntemi ve platform yetki sınırı.
- `server/school-admin-email.ts`: Telefon doğrulamasından sonra okul ve lisans kodu + e-posta OTP içeren yeni e-posta.
- `server/platform-management.ts`, `server/admin-management.ts`: Yeni modda davet oluştururken önceden eski aktivasyon e-postası göndermeme.
- `src/components/UnifiedWhatsAppLoginPanel.tsx`: Tek telefon, WhatsApp kodu ve gerekirse e-posta doğrulama ekranı.
- `src/components/AuthView.tsx`, `src/context/AppContext.tsx`, `src/services/api.ts`: Giriş ve oturum entegrasyonu.
- `server/database/supabase_schema.sql` ve iki migration: Admin OTP amaçları ve CHECK constraint güncellemeleri.

## Uygulama ve test durumu

- Kaynak sözdizimi kontrolü: **PASS** (TypeScript parser, değişen TS/TSX dosyaları).
- Tam TypeScript `npm run lint`: **ÇALIŞTIRILAMADI** (bu ortamda bağımlılıklar kurulamadı; ZIP node_modules içermiyor).
- Test paketleri (`test:whatsapp-auth`, `test:auth`, `test:school-admin-provisioning`, `test:account-deletion`, `test:security-and-tenant-audit`): **HENÜZ ÇALIŞTIRILMADI** (bağımlılık engeli).
- Gerçek Meta / gerçek e-posta / gerçek cihaz testi: **YAPILMADI**.
- Production migration, deploy, push, merge: **YAPILMADI**.

## Önce giderilmesi gerekenler

1. Tam TypeScript lint, mevcut regression testleri ve yönetici ilk/sonraki girişleri için yeni otomatik entegrasyon testleri çalışmalı. Test başarısı görülmeden lokal deneme dışına çıkılmamalı.
2. Birden fazla okulda ilk defa kayıtlı aynı telefonun otomatik aktivasyonu tasarlanmalı; mevcut aday belirsizliği **güvenli biçimde reddeder**. Aktif mevcut hesapların çoklu okul üyelikleri desteklenir.
3. Gerçek mesaj göndermeden yerel deneyim için Node tarafında sahte Meta ve e-posta transportu kullanan kontrollü test düzeneği kurulmalı. Production access token test dosyasına eklenmemeli.
4. Mağazalarda incelenen eski APK/IPA'nın backend sözleşmeleriyle geriye uyumu ve parolasız kullanıcıların rollback durumunda tekrar giriş yolu test edilmeli.
5. Yönetici e-posta doğrulaması bu adayda **6 haneli kodla** tamamlanır; ayrıca tek kullanımlık aktivasyon URL'si yoktur. Gerekliyse ayrı tasarlanmalıdır.
6. Yeni moda ait kullanıcı yardım metinleri ve mümkünse okul yöneticisi davet arayüzündeki açıklamalar yeni kullanım metnine göre ayrıca gözden geçirilmelidir.

## Yerel test ön koşulları

- Kodu mevcut çalışır localhost klasörüne doğrudan kopyalamayın. Ayrı ve yeni bir test kopyasında deneyin.
- Node.js 24 ve `npm ci` ile bağımlılıkları kurun.
- `NODE_ENV=development`, kendi PGlite test veritabanı, **gerçek Supabase bağlantısı olmadan** çalışın.
- Varsayılan her iki bayrak `false`. Yeni ekranı ancak sahte mesaj servisleri hazırsa ve sadece izole lokal koşullarda test için açın.
- `WHATSAPP_ACCESS_TOKEN`, `RESEND_API_KEY`, `DATABASE_URL` ve üretim kullanıcı verilerini lokal test kopyasına koymayın.
- Production migration, deploy, branch push/merge, App Store veya Play Store gönderimi için ayrı açık onay gerekir.

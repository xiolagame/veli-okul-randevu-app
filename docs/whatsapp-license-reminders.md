# WhatsApp lisans hatırlatmaları — çoklu yönetici revizyonu

Bu çalışma yalnız yerel kod/testtir. Production bağlantısı, migration, gerçek
mesaj, environment değişikliği, commit, push veya deploy yapılmaz. Referans:
`C:/Users/XIO/Documents/Codex/veli-randevu-excel-colors-release`.
Bu klasörde başka hazırlıklar vardır; tamamı yayın paketi olarak kullanılmamalı.
Önceki e-posta-only production hotfix'i gelecekteki izole entegrasyonda korunmalı.

## Alıcı ve izin

Birincil alıcı zorunluluğu kaldırıldı. Alıcılar okulun aktif `admin` üyelikleriyle
`users.phone` üzerinden her çalışmada yeniden belirlenir. Geçersiz/eksik telefon,
doğrulanmamış telefon, eksik/geri çekilmiş izin, telefon değişimi ve legacy Platform
hesapları neden kodlarıyla atlanır. Platform hesabının eski okul-admin üyeliği,
kendi başına gerçek okul yöneticisi/mesaj alıcısı kabul edilmez.
Canonical telefonla tekilleştirme okul içinde deterministiktir; iki farklı admin
aynı telefona sahip olsa da bir mesaj üretilir. Başka okulun alıcısı kullanılmaz.

`school_license_reminder_recipients` artık bir seçim tablosu değil,
`(school_id,user_id)` anahtarlı kişisel izin/tercih tablosudur. Yeni telefon,
manuel alıcı veya birincil yönetici ekranı yoktur. Hesabım içindeki checkbox yalnız
kullanıcının kendi aktif okul-admin üyeliği ve doğrulanmış mevcut telefonu için
opt-in kaydeder. Başka kullanıcı adına izin verilemez. İzin geri çekme, lisans
süresi dolunca da kullanılabilir. Telefon değişimi HMAC bağını geçersiz kılar;
Hesabım yeniden onay ister. İzin değişimi mevcut audit altyapısına yazılır.
Kişisel izin otomatik seçili gelmez; role sahip olmak izin değildir.

## Gönderim ve bayraklar

Şablon tam adı `kolayokul_lisans_hatirlatma`, dil `tr`. Yalnız okul adı, İstanbul
kalan takvim günü ve `GG.AA.YYYY` bitiş tarihi parametreleri gönderilir. Onaylı Meta
metni değiştirilmez. UI önizlemesi bu üç parametreyi gösterir; Meta'daki metnin
birebir görünümü henüz gerçek mesajla test edilmemiştir.

Üç server flag varsayılan false:
- `WHATSAPP_LICENSE_REMINDERS_ENABLED`: ana kapı.
- `WHATSAPP_LICENSE_REMINDERS_AUTO_ENABLED`: otomatik gönderim.
- `WHATSAPP_LICENSE_REMINDERS_MANUAL_ENABLED`: manuel gerçek gönderim.
Ana kapı ve ilgili amaç bayrağı true olmadıkça Meta API çağrılmaz. Gerçek manuel
mod kapalıyken preview/TEST onayı çalışır; gönderim kaydı ve Meta çağrısı oluşmaz.

Otomatik kontrol İstanbul tarihine göre 7/3/1 gün; cron `0 6 * * *` UTC,
İstanbul 09:00. Ayrı signed background worker kullanılır. Yalnız production
context ve onaylı origin kabul edilir. Ana cron, izin verilmiş manuel kuyruğu da
işleyebilir; AUTO bayrağı kapalıysa yeni otomatik mesaj üretmez.
Worker 13 dakika bütçesi ve sıralı gönderim kullanır; yüksek hacim ve gerçek
PostgreSQL eşzamanlı bağlantı yükü production öncesi ayrıca ölçülmelidir.

Manuel kullanım: güncel DB lisansı/alıcılar → beş dakikalık, okul/aktör/session
version/snapshot'a bağlı önizleme → açık checkbox onayı → kalıcı QUEUED işlem →
signed worker → her alıcıya ayrı kayıt. Preview'ün gerçek/test modu değişirse,
lisans/üyelik/telefon/izin değişirse yeniden preview gerekir. Yalnız preview'de
onaylanan hedef anahtarlar işlenir. Hız sınırı veya belirsiz eski sonuç nedeniyle
engellenen alıcılar önizlemede ayrıca gösterilir ve hedef sayısına katılmaz.
Manuel gönderim için bitiş anı gelecekte, lisans aktif ve belirli olmalıdır.
Bugün ileriki saatte bitecek lisans için gerçek takvim farkı 0 olabilir; negatif
veya uydurma gün gönderilmez.

## Idempotency ve hata davranışı

AUTO: okul/lisans/dönem/7-3-1 adımı/canonical telefon için benzersiz indeks.
MANUAL: işlem UUID + canonical telefon için benzersiz indeks. İşlemi başlatan
Platform Admin ID/auth_version kalıcıdır; worker yetkisini tekrar doğrular.
Amaçlar birbirinin 7/3/1 kayıtlarını değiştirmez. Ortak okul/telefon cooldown'u
10 dakikadır ve iki amaç arasındaki yakın gönderimleri de engeller. Aynı manuel
onay, bir dakika içinde ikinci worker uyandırmaz. Tekrar onay aynı UUID'de kalır.

Ağdan önce ayrı transaction ile DISPATCHING tombstone kaydedilir. Sonraki
transaction yetki/lisans/izin/telefonu yeniden doğrular. Network çağrısı sırasında
kilitler, yenileme ve yetki değişikliğiyle yarışı önler. Bağlantı en çok provider
8 saniyelik timeout'u boyunca tutulabilir. Meta kabulünden sonraki commit hatası
bile ilk kaydı geri alamaz. UNKNOWN/DISPATCHING aynı dönem/alıcı için yeni manuel
istekte de bloklanır; otomatik tekrar yoktur. REJECTED/UNKNOWN gerekçeleri yalnız
sanitized kodlardır; provider body/token/telefon loglanmaz.

ACCEPTED yalnız API kabulüdür, gerçek teslimat değildir. `delivery_status`
UNCONFIRMED kalır. DELIVERED/FAILED güncelleyen imzalı Meta webhook entegrasyonu
bu değişiklikte eklenmedi; UI bunu açıkça belirtir. Yönetici hesabı silinirse alıcı
FK'si NULL olur; telefon bazlı tombstone silinmez. Otomatik geçmiş temizliği yok;
bu kayıtları silmek veya HMAC secret'ını plansız değiştirmek dedupe garantisini
zayıflatır. Secret rotasyonu, saklama/anonimleştirme ve belirsiz sonuç uzlaştırma
ayrı kontrollü operasyon gerektirir; UI'da bypass/force-resend yoktur.

## Panel ve API

Lisans Yönetimi'ndeki her lisanslı okulda WhatsApp Hatırlatmaları açılır. Aktif/
izinli/tekil alıcı sayıları, telefon ve izin eksikleri, maskeli alıcılar, bitiş,
sonraki otomatik saat, son deneme/API kabulü, durumlar, sayaçlar, sayfalı gönderim
geçmişi ve son manuel işlemler gösterilir. Başarısız/stale işlem de kaybolmaz.

- GET `/api/platform/licenses/:schoolId/whatsapp?page=0`
- POST `.../whatsapp/preview` (boş body)
- POST `.../whatsapp/confirm` (`operationId`, `confirmed:true`)
- GET/PUT `/api/auth/me/license-reminder-preferences/:schoolId`

Platform uçları mevcut JWT + canUsePlatformAuthority korumasındadır. Normal
admin/parent/teacher/security veya kısıtlı WhatsApp token'ı kabul edilmez.
Tercih uçları yalnız oturum sahibinin kayıtlarını değiştirir; client userId,
telefon, school listesi veya izin kanıtı belirleyemez. Yanıtlar no-store ve maskeli.

## Migration / environment

Önce `20261027_add_whatsapp_license_reminders.sql`, ardından additive revizyon
`20261027_revise_whatsapp_license_reminders.sql` gerekir. İlk taslak değiştirilmedi;
revizyon eski verileri koruyup anahtar/indeksleri genişletir, operation ve cooldown
 tablolarını ekler. Testte temiz kurulum, ikinci uygulama, veri bulunan tablolar ve
browser rolleri kontrol edildi. Canlı SQL çalıştırılmadı. RLS/backend grant modeli
korunur; FORCE RLS eklenmez. Gerçek DB rol/sahipliği uygulanmadan önce doğrulanmalı.

Mevcut server-only env'ler yeniden kullanılır: WHATSAPP_PHONE_NUMBER_ID,
WHATSAPP_ACCESS_TOKEN, isteğe bağlı WHATSAPP_GRAPH_API_VERSION, AUTH_CODE_SECRET,
DATABASE_URL, SUPABASE_DB_CA_B64, URL, CONTEXT. OTP/login/pilot flag'leri değişmez.

## Test / yayın öncesi

Focused: `npx tsx scripts/test-license-whatsapp-reminders.ts`.
API: `npx tsx scripts/test-license-reminder-api.ts` — yalnız izole PGlite cwd ile;
repo .cache/performance-review runner'ı bağlantı env'lerini temizler ve temp DB kurar.
UI: `node scripts/test-license-reminder-ui.mjs` — Playwright module yolu gerekir.
Mevcut license UI/regresyonları ayrıca çalıştırılır.

Canlı öncesi: gerçek production tabanına scoped entegrasyon, ayrı migration/yayın
onayı ve yedek, izin metni/saklama kararı, Meta tr şablonu/WABA kontrolü, ayrı
bayrakların production Functions kapsamı, dry-run, imzalı background işleyişi ve
ayrıca onaylı gerçek telefon teslim testi. Bu doğrulamalar olmadan flag açılmaz.
Geri dönüşte additive tablolar/deneme kayıtları silinmez; yeni gönderim flag'lerle
kapatılır. Önceden provider'a ulaşmış bir isteğin geri alınamayacağı unutulmaz.

Netlify zamanlama kaynağı: https://docs.netlify.com/build/functions/scheduled-functions/

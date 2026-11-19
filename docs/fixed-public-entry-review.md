# Sabit karşılama ve WhatsApp giriş görünümü — 29 Ekim 2026

Yerel uygulama ve doğrulama tamamlandı. Production yayını, Git commit/push, environment değişikliği ve gerçek mesaj gönderimi yapılmadı.

## Görünüm

- `public/welcome/login-reference.png`, kullanıcının `Adsız Tasarım (4).png` dosyasının byte olarak aynı kopyasıdır. Arka plan cover ile, oranı korunarak gösterilir; doğal karanlık görüntüye ek beyaz katman uygulanmaz.
- 1917 × 907 referans boyutunda birleşik panel yaklaşık x30/y84 konumunda, 1320 × 740 boyutundadır. Sütun oranları %42/%58; beyaz giriş kartı 552 × 660 boyutundadır. Kısa masaüstü ekranları için boşluklar azaltılır; tablet ve mobilde mevcut tek sütunlu erişilebilir düzen korunur.
- Sol marka paneli yarı saydam koyu yeşil, giriş kartı beyazdır. Mevcut metinler, form, butonlar ve bağlantılar korunur.
- Karşılama koyu, giriş ekranı referanstaki sabit palette açılır. Bu iki ekranda tema düğmesi DOM'a eklenmez. Yerel CSS paleti ve bileşen kapsamı kullanılır; kullanıcının kayıtlı tema tercihi değiştirilmez. Yardım/Lisans gibi diğer sayfalarda ve oturum sonrası tema tercihi yeniden normal şekilde uygulanır.
- Sabit görünümde açılan portal diyalogları da okunabilir açık palette kalır. Safe-area ve overscroll için sayfa zemini koyu tutulur.

## Değişen dosyalar

Uygulama:

- `public/welcome/login-reference.png` (yeni)
- `src/context/WebTheme.tsx`
- `src/components/WebWelcome.tsx`
- `src/components/login-desktop.css`

Test ve rapor:

- `scripts/test-fixed-public-ui.mjs` (yeni)
- `scripts/test-login-desktop-layout.mjs`
- `scripts/test-web-theme-ui.mjs`
- `scripts/test-web-background-ui.mjs`
- `docs/fixed-public-entry-review.md` (bu rapor)

## Test sonuçları

| Kontrol | Sonuç |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run build:production-package` | PASS |
| Dört Function ZIP bağımsız runtime testi | PASS |
| Gerçek build + çıkarılmış API ZIP health/capabilities, 502 ve retry | PASS |
| `npm run test:whatsapp-login-ui` | PASS |
| İzole WhatsApp auth ve unified login regresyonları | PASS |
| Web tema boundary, mobile-platform regresyonları | PASS |
| Chromium/WebKit sabit giriş: 9 genişlik × 2 kayıtlı tema | PASS |
| Chromium/WebKit diğer temalar: 11 ekran × 7 genişlik × 2 tema | PASS |
| Web arka plan regresyonları: Chromium/WebKit | PASS |
| Kapsamlı kaynak whitespace kontrolü | PASS — whitespace hata çıktısı yok |

Sabit giriş çözünürlükleri: 1920×1080, 1917×907, 1440×900, 1366×768, 1024×768, 768×1024, 430×932, 390×844, 375×812. Açık/koyu kayıtlı tercihlerin hesaplanan renkleri ve yerleşimleri aynı; tema düğmesi yok; yatay taşma yok. Ekran görüntüleri görsel olarak incelendi. Tarayıcı bitmap rasterizasyonu nedeniyle ekran görüntüsü dosyalarının byte eşitliği test sözleşmesi değildir.

Tema tercihinin oturum açıldıktan sonra korunması, testte simüle edilen authenticated bileşen sınırıyla doğrulandı. Gerçek kullanıcı girişi, fiziksel iPhone/Android testi ve gerçek OTP gönderimi yapılmadı. Native kaynak dosyaları değiştirilmedi; bu web-only release'te native shell config bulunmadığından yeni native build doğrulaması yapılmadı.

Korunan backend/native dosyalarının hash karşılaştırmasında fark: 0. Dört API/scheduled/background ZIP'in hash'leri önceki doğrulanmış paketle aynı. `serverless-http` ve `pg` bağımlılıkları bağımsız ZIP testinde yükleniyor. Auth, API, OTP üretimi, video geçiş mantığı ve Netlify paketleme scriptleri değiştirilmedi.

Release klasörü Git worktree değildir; ana kirli Git çalışma ağacına dokunulmadı. `git diff --no-index --check` ile snapshot/kaynak karşılaştırmalarında whitespace uyarısı oluşmadı (no-index fark bulunduğunda 1 döndürebilir).

## Görüntüler ve yerel önizleme

- Önce: `.cache/fixed-public-before/chromium-light-1440.png`
- Sonra, referans boyutu: `.cache/login-desktop-review/fixed/chromium-light-1917.png`
- Sonra, mobil WebKit: `.cache/login-desktop-review/fixed/webkit-dark-390.png`
- Diğer ekranlar: `.cache/approved-theme-review/`
- Yerel önizleme: http://127.0.0.1:4179/login

Önizleme capabilities yanıtını taklit eder ve gerçek OTP/API gönderimi yapmaz. Yeniden başlatmak için:

```powershell
Set-Location 'C:\Users\XIO\Documents\Codex\veli-randevu-auth-runtime-hotfix-20261029'
$env:PLAYWRIGHT_MODULE='C:\Users\XIO\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright\index.mjs'
$env:LOGIN_LAYOUT_PREVIEW='true'
node scripts/test-fixed-public-ui.mjs
```

## Yayın komutu — çalıştırılmadı

Yalnız ayrıca yayın onayı verildikten ve yayınlanacak release kapsamı tekrar doğrulandıktan sonra:

```powershell
Set-Location 'C:\Users\XIO\Documents\Codex\veli-randevu-auth-runtime-hotfix-20261029'
npm run build:production-package
if ($LASTEXITCODE -ne 0) { throw 'Paket doğrulanamadı; yayın durduruldu.' }
netlify deploy --prod --site f15fdc98-3bb3-4f0d-88ca-bb8c685ffaea --dir release/client --functions netlify/functions --no-build --message 'Fixed welcome and WhatsApp login presentation'
```

Bu komut mevcut release paketinin tamamını yayınlar; yalnız bu dört uygulama dosyasından bağımsız bir production patch oluşturmaz. Yayın öncesi aktif production deploy ve rollback hedefi yeniden kontrol edilmelidir. Daha önce doğrulanmış rollback adayı `6ae342e13fc1e501a18f7b31`; bu görevde güncel production hedefi yeniden sorgulanmadı.

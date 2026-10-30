# Android giriş ekranı — 30 Ekim 2026

Çalışma: `C:/Users/XIO/Documents/Codex/veli-review-android-build`

Dal: `feature/android-login-polish-20261030`

Temel commit: `7c4781c52a7d43312d86da33bb76d56f4630b3ff`. iOS dalının sonraki değişiklikleri bu Android worktree'sine alınmadı veya üzerine yazılmadı.

## Kök neden ve düzeltme

- Capacitor StatusBar yapılandırması açık bir arka plan rengine sabitlenmişti; Android pencere dekoru da uygulamadaki manuel temayı izlemiyordu. Yeni Android sürümlerinde edge-to-edge davranışı nedeniyle yalnız StatusBar rengini değiştirmek yeterli değildir. Üç tuşlu gezinmede otomatik contrast enforcement ayrıca açık renkli scrim oluşturabilir.
- MainActivity artık edge-to-edge açar. AndroidSystemBarsPlugin çubukları şeffaflaştırır; API29+ için sistem scrim'ini kaldırır ve okunabilir ikon stilini kendisi belirler. Giriş fotoğrafında her iki temada açık ikonlar; uygulamanın diğer açık/koyu yüzeylerinde uygun koyu/açık ikonlar kullanılır. Eski WebView'in native inset alanları için marka/tema renginde dekor arka planı vardır. API24/25 koyu gezinme ikonunu desteklemediğinden bu sürümlerde koyu navigation arka planı korunur.
- Capacitor8 SystemBars'ın mevcut WindowInsets/IME listener'ı değiştirilmez. Android giriş CSS'i hem `env(safe-area-inset-*)` hem Capacitor'ın `--safe-area-inset-*` geri dönüşünü dikkate alır; bunları toplamak yerine max kullanarak aynı inset'i iki kez uygulamaz.
- Mevcut büyük mobil başlık, yüksekliğe göre sıkıştırılan aralıklar ve marka/tema kontrollerinin sabit ölçüleri dar ekranlarda dengesizleşiyordu. Android'e özel CSS akışkan başlık ve dikey boşluklar kullanır; büyük yazıda başlık/marka doğal biçimde bölünebilir. Yardım etiketi Android'de “Yardım ve yasal bilgiler” olarak kısaltıldı; erişilebilir adı ve açtığı tam yardım içeriği korunur. Kontroller en az48CSSpx; sabit ekran/kart yüksekliği eklenmedi.

Android platform davranışı referansı: [Android edge-to-edge ve contrast enforcement](https://developer.android.com/develop/ui/views/layout/edge-to-edge). Bu açıklama cihazda yapılmış testin yerine geçmez.

## Dosyalar ve kapsam

- `android/app/src/main/java/com/velirandevu/app/MainActivity.java`
- `android/app/src/main/java/com/velirandevu/app/AndroidSystemBarsPlugin.java` (yeni)
- `android/app/src/main/res/values/styles.xml`
- `src/platform/android-system-bars.ts` (yeni)
- `src/android-auth.css` (yeni)
- `src/main.tsx`
- `src/components/AuthView.tsx`
- `scripts/test-android-login-polish.mjs` (yeni)
- Bu rapor.

AuthView/main ortak dosyalardır; native çağrılar Android guard'ı arkasında, görsel kurallar `data-runtime-platform="android"` ile sınırlıdır. iOS tam yardım etiketini göstermeyi sürdürür ve Android native plugin'ini çağırmaz. iOS kaynak/config dosyaları değiştirilmedi.

OTP iş kodu, Oracle review origin, API/oturum/roller/QR işlevleri, mevcut tema tercih anahtarı, renk token'ları, logo ve04-Mobil.png değiştirilmedi. ApplicationId, sürüm ve imzalama ayarları aynı kaldı. Yeni bağımlılık yok.

## Doğrulama

| Kontrol | Sonuç |
|---|---|
| TypeScript | PASS |
| Production frontend/server build ve release artifact safety | PASS; build deploy değildir |
| `npm run android:sync:review` ve review package doğrulaması | PASS;56 güncel web dosyası native assets ile hash düzeyinde aynı |
| Android görsel/etkileşim paketi |17/17 PASS;320/360/375/390/412/430px, açık/koyu tema |
| Başlık ve kontroller | Normal yazı ölçeğinde hedef altı genişlikte tek satır başlık;48px hedefler, yatay taşma ve marka/tema çakışması yok |
| Büyük yazı, kısa klavye viewport'u, safe-area | Browser simülasyonu PASS;200% root font, küçülmüş viewport, enjekte edilmiş inset |
| OTP ve inceleme girişi | Mock request/verify/denial, review origin, tema ve yardım geçişleri PASS; gerçek mesaj gönderilmedi |
| Mevcut testler | whatsapp-login-ui, native-secure-storage, mobile-platform-foundation, theme-bootstrap, review-client, review-login-ui, store-review-config PASS |
| Derlenmiş Android ve iOS giriş regresyonu | PASS; Chromium + sentetik Capacitor bridge |
| Kaynak/asset bütünlüğü | PASS; korunan kaynak hash'leri aynı, son build test edilen asset'lerle aynı |
| Native kaynak incelemesi | XML sözdizimi PASS; kullanılan WindowCompat API'si kurulu androidx-core1.17.0 sınıfında mevcut |
| Gradle/Java native derlemesi | NOT TESTED — kullanıcı Android Studio'da yapacak |
| Fiziksel cihazda sistem çubukları/IME/kamera | NOT TESTED |

Kanıtlar yerel `audit/android-login-polish/` altında; bu klasör Git'e dahil edilmez.22 açık/koyu ekran görüntüsü, layout sonuçları, hash ve test günlükleri bulunur. Eski Android capability hatası fallback sözleşmesi korunmuştur; yeni bir auth retry akışı geliştirilmemiştir. Sistem çubuklarının gerçek pikselleri browser screenshot'larına dahil değildir.

## Android Studio ve cihaz kabulü

Açılacak klasör:

`C:/Users/XIO/Documents/Codex/veli-review-android-build/android`

Kullanıcı native build sonrasında özellikle şunları kontrol etmeli:

- Android15/16 gesture ve üç tuşlu gezinme: gri scrim, ikon okunabilirliği ve kesintisiz arka plan.
- Eski Android/WebView, çentik/kamera deliği ve yatay kullanım: aynı inset'in iki kez uygulanmaması, hiçbir kontrolün sistem alanına girmemesi.
- Klavye açıkken telefon/OTP ve submit erişimi; klavye kapatılınca normal boyuta dönüş ve geri tuşu.
- Uygulamayı kapat/aç, arka plana al/geri getir; tema değiştir, girişten çıkıp yardım/rol ekranına geç; native çubukların doğru yüzeye uyumu.
- Android font büyütme/TalkBack ve gerçek telefon screenshot'ı ile son görsel kabul.

APK/AAB veya Android Studio/Gradle build başlatılmadı. Production/Supabase/Netlify değişikliği, gerçek OTP/demo login çağrısı ve main merge yapılmadı. Push yalnız bu yeni Android feature dalına yapılır; iOS/ortak feature dalı güncellenmez.

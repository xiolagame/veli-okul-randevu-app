# Android demo girişi sonrası native kapanma — 30 Ekim 2026

Dal: `feature/android-login-polish-20261030`.
Referans: `79724e6eff262b19d395a976ed45c192a2bd080a`.
Kapsam: yalnız Android push güvenliği; APK/AAB üretimi veya mağaza yüklemesi yok.

## Kanıtlanan kök neden

USB ADB ile gerçek Android cihazının crash buffer'ında uygulamaya ait dört kayıt bulundu:

```text
FATAL EXCEPTION: CapacitorPlugins
java.lang.RuntimeException: java.lang.reflect.InvocationTargetException
Caused by: java.lang.IllegalStateException: Default FirebaseApp is not initialized in this process com.velirandevu.app.
  at com.google.firebase.FirebaseApp.getInstance(FirebaseApp.java:179)
  at com.google.firebase.messaging.FirebaseMessaging.getInstance(FirebaseMessaging.java:120)
  at com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin.register(PushNotificationsPlugin.java:114)
```

`dumpsys activity exit-info com.velirandevu.app` aynı kapanmalar için
`reason=4 (APP CRASH(EXCEPTION))` bildiriyor. Bu olaylar Java/native FCM
exception'ıdır; JS assertion, ANR veya birincil WebView renderer crash'i değildir.
Renderer'ın uygulama öldükten sonraki kapanışı ve daha sonraki `SwipeUpClean`
sistem/kullanıcı kapatmaları ayrı exit kayıtlarıdır.

İlk girişte ReviewLogin → doğrulanmış review JWT → secure storage → okul/rol
yüklemesi → Navbar push effect → AndroidPushManager.start/refreshPermission →
native register zinciri çalışıyordu. Veli/öğretmen rolü ve bildirim izni mevcutsa
FCM başlatılıyordu; demo için istisna yoktu. APK'da default Firebase app yok.
Yerel `android/app/google-services.json` da mevcut değil. Kurulu native plugin
`FirebaseMessaging.getInstance()` exception'ını JS promise rejection'a çevirmiyor;
Capacitor Bridge yeniden RuntimeException fırlatıyor. JS try/catch bunu önleyemez.

Normal girişin çalışması JWT'nin kapanma nedeni olduğunu göstermez. Rol/izin
durumuna bağlı FCM yolu çalıştırılmayan oturumlar etkilenmeyebilir. Aynı eksik
Firebase yapılandırması normal veli/öğretmen push yolunu da etkileyebileceğinden
koruma yalnız demo hesabı isim kontrolüyle sınırlandırılmadı.

Ayıklanmış gerçek cihaz kanıtı yerelde `audit/android-demo-crash/device-evidence.txt`.
Yalnız hedef uygulama crash kayıtları alındı; parola/JWT/istek gövdesi/cihaz seri
numarası rapora eklenmedi. Bu kanıt eski kurulu APK'ya aittir; yeni APK testi değildir.

## En küçük ürün düzeltmesi

1. `src/platform/android-push.ts`: review kimliklerinde native FCM kaydı/iptali
   başlatılmaz. Önceki registration callback'i review kimliğine sarkarsa atılır.
   Foreground/izin açma/çıkış/oturum iptali yolları da korunur.
2. `src/platform/android-notification-settings.ts`: mevcut native host plugin'ine
   default Firebase app uygunluk sorgusu eklenir.
3. `android/app/src/main/java/com/velirandevu/app/NotificationSettingsPlugin.java`:
   `getPushAvailability` mevcut default Firebase app'i güvenli biçimde inceler;
   eksik sınıf/default app ve invocation hataları `configured=false` olur.
   Firebase oluşturmaz, credential eklemez. Reflection ile yeni compile-time
   Firebase bağımlılığı gerekmez. Mevcut native plugin kullanılır.

Normal yapılandırılmış veli/öğretmen push kaydı ve güvenli cleanup sürer. Firebase
olmadığında kontrollü `unavailable` durumu oluşur. Eski/eksik host metodu da
fail-closed olur. Native unregister/deleteToken aynı exception'ı üretebildiği için
yalnız register değil çıkış yolları da kontrol edildi. Backend ve native cleanup'ın
ikisi birden başarısızsa normal logout'un ret sözleşmesi kaldırılmadı.

Yeni plugin/bağımlılık yok. OTP/JWT/protocol/CORS/tenant yetkileri, Oracle backend,
parolalar ve DB değişmedi. Android giriş CSS'i, sistem çubukları ve görselleri
değişmedi. iOS kaynakları ve açık tema dalı değiştirilmedi.

## Testler

| Kontrol | Sonuç |
|---|---|
| Gerçek cihaz ADB/Logcat ve exit-info | PASS — eski APK'nın native FCM kapanma nedeni kanıtlandı |
| `npm run lint` | PASS |
| `npm run android:sync:review` | PASS — Vite production client + Capacitor sync; native binary yok |
| `test-android-demo-push-safety.ts` | PASS — dört review rolünde FCM yok; eksik Firebase/eski host güvenli; yapılandırılmış normal veli/öğretmen kaydı/cleanup; normal→demo→normal geçişi |
| Aynı testin 79724e6 AndroidPushManager kaynak karşılığı | Beklenen FAIL — tam demo-FCM assertion'ı; düzeltmenin gerçek regresyonu yakaladığı doğrulandı |
| Canlı Oracle + derlenmiş Android client, dört Google rolü | PASS — her rol en az61 saniye, gezinme, simüle background/foreground, secure-storage fixture restore, logout/relogin; FCM register/unregister sıfır |
| `test-android-login-polish.mjs` | PASS — altı genişlik, iki tema, büyük yazı/klavye/safe-area simülasyonu, OTP/review ve native bar çağrı sözleşmeleri |
| Android shell / release safety / komut zinciri | PASS |
| Mevcut 24 regresyon | 23 test Android worktree'sinde PASS; iOS shell aşağıdaki izole hazırlıktan sonra PASS |
| Source provenance | PASS — yalnız incelenmiş Android guard dosyaları explicit listeye eklendi |
| Frozen source | 460/460 PASS — yeni ve önceden onaylanmış Android kaynakları Git index blob'larından kilitlendi; negatif değişiklik testi korunur |

İlk 24 test koşusunda bu Android worktree'sinde ignore edilmiş iOS Capacitor config
bulunmadığı için iOS-shell testi ENOENT verdi. Test kapatılmadı: `.cache/` altında
ayrı temiz kaynak kopyası, mevcut iOS log sanitizer'ı ve gerçek Capacitor iOS sync
ile gerekli fixture hazırlandı; yalnız bu test tekrar çalıştırılıp PASS alındı.
Asıl iOS kaynak/worktree/dalına dokunulmadı; Xcode derlemesi yapılmadı. İlk hata
ve tekrar test logları ayrı tutulur.

Canlı oturum testi açık `--live-isolated-review` opt-in ister. Dört test kimliği
stdin'den alınır; yalnız inceleme login POST'u ve demo GET'lerine izin verir.
Production talepleri, dış mesajlar ve veri değiştiren demo uçları engellenir.
Parola/token, browser trace veya storage-state dosyası yazılmaz. Native storage
ve lifecycle Chromium test bridge'idir; Android Keystore/device testi değildir.
Paket dışında kalan test harness hataları SDK sözleşmesi/selector ile düzeltildi;
ürün auth/UI kodu bu nedenle değiştirilmedi.

## Dosyalar

Üç ürün dosyasına ek olarak:

- `scripts/test-android-demo-push-safety.ts`: yeni negatif/normal akış regresyonları.
- `scripts/test-android-review-session.mjs`: açık izinli canlı demo +61 saniye istemci testi.
- `scripts/test-push-notifications.ts`: fixture'da Firebase yapılandırmasının açık belirtilmesi; eski assertions korunur.
- `scripts/verify-ios-provenance.mjs`: incelenmiş üç Android dosyası için explicit provenance kaydı.
- `audit/ios-source-lock.json`: canonical Git index hash'leri; denetim gevşetilmedi.
- Bu rapor.

## Kullanıcının yeni APK işlemi

Kaynak: `C:\Users\XIO\Documents\Codex\veli-review-android-build`.
Dal: `feature/android-login-polish-20261030` ve sonuç raporundaki yeni SHA.

```powershell
cd C:\Users\XIO\Documents\Codex\veli-review-android-build
npm run android:sync:review
```

Ardından `android` klasörünü Android Studio'da açıp APK'yı kullanıcı oluşturur.
Mevcut kurulum üzerine yükleme için doğru aynı signing key/package ID kullanılmalı.
Yalnız web sync/hot reload yeni Java metodunu telefona taşımaz; yeni native APK gerekir.

Firebase push teslimatı isteniyorsa doğru Android client `google-services.json`
yerelde sağlanmalıdır; service-account/private key kullanılmaz. Demo erişimi
Firebase olmadan çalışabilir; guard eksik yapılandırmayı sahte başarılı göstermez.

Yeni APK'da dört Google rolüyle en az60 saniye, gezinme, gerçek Home/geri dönme,
secure storage restart, çıkış/yeniden giriş ve normal WhatsApp OTP tekrar test edilir.
Gerçek kamera/QR veya FCM teslimatı bu çalışmada PASS sayılmadı. Yeni APK/AAB,
Gradle/native Java derlemesi, yeni APK'nın fiziksel cihaz kabulü, Google Play,
Codemagic veya TestFlight işlemi yapılmadı.

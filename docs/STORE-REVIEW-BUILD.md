# Android / iOS mağaza inceleme kaynakları

Dal: `feature/review-demo-theme-20261029`.
Yerel kaynak: `C:\Users\XIO\Documents\Codex\veli-review-demo-theme-20261029`.
APK, AAB ve iOS için aynı commit kullanılır. Bu dal production'a dağıtılmamalıdır.

## Ortak hazırlık

Node 24 kullanın; Codemagic ve regresyon referansı `24.17.0`.
Temiz checkout'ta `npm ci` çalıştırın. Kaynak bütünlüğü kontrolü:

```powershell
node scripts/verify-ios-source-lock.mjs
npm run lint
```

İnceleme profili `config/store-review.json` içindedir. `VITE_REVIEW_API_ORIGIN`
değeri `https://veli-review-demo.duckdns.org` olmalıdır. Aşağıdaki review sync
komutları bunu otomatik uygular; farklı bir override varsa işlemi durdurur.
Normal kullanıcı API'si `https://velirandevu.com` olarak korunur. Demo adresi
yalnız inceleme girişi ve demo oturumları için kullanılır. Hesap parolaları,
JWT signing secret, PostgreSQL bilgileri frontend build değişkeni değildir.

## Android APK / Google Play AAB — kullanıcı başlatır

1. Bu dalın güncel checkout'unda `npm ci` çalıştırın.
2. `npm run android:sync:review` çalıştırın. Bu komut yalnız web paketi ve
   Capacitor sync üretir; APK veya AAB oluşturmaz.
3. `android` klasörünü Android Studio'da açın. SDK 36, Java 21, Gradle
   wrapper 8.14.3 / AGP 8.13.0 mevcut kaynak gereksinimleridir. Yerel SDK
   yolu `local.properties` içinde tutulur ve Git'e eklenmez.
4. Play Console'daki son sürümden büyük bir pozitif `VELI_ANDROID_VERSION_CODE`
   seçin; `VELI_ANDROID_VERSION_NAME` kullanıcıya görünen sürümdür. Gradle
   proje özelliği veya aynı adlı environment değişkeni desteklenir. Android
   Studio için kullanıcı düzeyindeki Gradle properties kullanılabilir.
   Varsayılanlar `1` / `1.0.0` olup mevcut Play sürümüne yüklemeye uygun
   oldukları iddia edilmez. Önce mevcut mağaza numarasını kontrol edin.
5. APK için Android Studio'nun APK üretme, AAB için Generate Signed Bundle /
   APK → Android App Bundle akışını kullanıcı başlatır. Release için mevcut
   doğru signing key kullanılmalıdır. Anahtar/parola Git'e eklenmez.
6. FCM kullanılacaksa doğru Android Firebase uygulamasının
   `android/app/google-services.json` dosyası yalnız yerelde sağlanır;
   server service-account anahtarı kullanılmaz. Dosya bu commit'e dahil değildir.

Package ID `com.velirandevu.app`. Bu hazırlık Gradle/native derleme ve fiziksel
Android doğrulaması yerine geçmez. Test APK'sı mağaza için imzalı AAB değildir.

## iOS Codemagic — kullanıcı başlatır

1. Codemagic'te **main yerine** `feature/review-demo-theme-20261029` dalını ve
   rapordaki son uzak SHA'yı seçin.
2. Önce `ios-ci-check` seçin: imzasız Simulator derlemesi, Apple'a yükleme yok.
3. Dağıtım IPA'sı gerekiyorsa kullanıcı ayrıca `ios-signed-ipa` seçebilir.
   Bu workflow IPA üretir; Apple'a göndermez. Bu hazırlıkta çalıştırılmadı.
4. `ios-testflight` seçmeyin; ayrı explicit approval kilidi korunmuştur.

YAML, Node `24.17.0`, Xcode `26.6` ve `npm run ios:sync:review` kullanır.
Bundle ID `com.velirandevu.app`; mevcut signing entegrasyonu korunmuştur.
İmzalı akışın mevcut `firebase_credentials` grubundaki
`FCM_GOOGLE_SERVICE_INFO_PLIST` secret'ı base64 iOS Firebase plist içeriğidir.
Mevcut App Store Connect / signing yetkilendirmesi kullanıcı hesabında
korunmalıdır; değerleri kaynak dosyalara yazmayın. `APP_STORE_APPLE_ID`
YAML'de mevcut `6823597940` değeridir. Build numarası mevcut signed akışında
App Store Connect'teki son numaradan bir artırılır. Build 13'ü tekrar seçmek
güncel kaynak derlendiğini kanıtlamaz; dal/SHA ve yeni build numarası kontrol edilir.

Yerel iOS paket hazırlığı: `npm run ios:sync:review`. Bu komut Xcode derlemesi
veya IPA üretmez. Normal `ios:sync` / `android:sync` yerine review komutlarını
kullanın; yalnız bunlar inceleme servis profilini açıkça uygular.

## Teslim almadan önce kullanıcı kabul testi

- Yeni yüklemede “Okulunuza Hoş Geldiniz”, `04-Mobil.png`, güneş/ay ve
  “Mağaza inceleme erişimi” görünmeli; web sinematik video olmamalı.
- Native klavye/safe area, OTP gönderme/yeniden gönderme, oturum geri yükleme,
  kamera/QR ve bildirimler gerçek cihazda doğrulanmalı.
- Demo hesap bilgileri güvenli kanaldan inceleme notlarına aktarılmalı;
  gerçek WhatsApp alıcısına mesaj göndermeden demo senaryoları denenmeli.
- İki demo okul ve normal oturumlar arasında veri/token izolasyonu korunmalı.
- Canary/manuel test başarıları mağaza yükleme veya production deploy izni değildir.

GitHub push güvenliği: bu dal için webhook/zamanlanmış Codemagic build
bulunmamalı; YAML `triggering` / `publishing` içermemeli. Netlify branch deploy
kapsamı yalnız `main` kalmalı; PR açılmamalı. Hesap ayarları değişirse push
öncesi bu koşullar yeniden denetlenir.

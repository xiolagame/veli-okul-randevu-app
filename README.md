# Veli Randevu

## Talep Bildirim E-postası

Public ve okul yönetimi destek/lisans taleplerinin platform bildirim alıcısı için deploy ortamında `PLATFORM_REQUEST_NOTIFICATION_EMAIL` tanımlanmalıdır. Değer repository'ye yazılmaz; mevcut `RESEND_API_KEY` ve `EMAIL_FROM` e-posta gönderim ayarlarıyla birlikte kullanılır.

## Android Randevu Bildirimleri

Repo Node.js 24 kullanır. Push, yalnız Android veli ve öğretmen hesapları için FCM teslimat kanalıdır; uygulama içi `notifications` tablosu asıl kayıttır. Firebase Authentication, Firestore ve topic kullanılmaz.

Deploy öncesinde `server/database/migrations/20261003_add_mobile_push_delivery.sql` production veritabanına kontrollü olarak uygulanmalıdır. Netlify server ortamında `FCM_FIREBASE_PROJECT_ID`, `FCM_FIREBASE_CLIENT_EMAIL` ve `FCM_FIREBASE_PRIVATE_KEY` tanımlanır; bu değerler istemciye veya repository'ye konmaz. `AWS_LAMBDA_JS_RUNTIME` site-level override varsa ayrıca Node 24 uyumu doğrulanmalıdır. Android uygulaması için bu projeye ait gerçek `android/app/google-services.json` gerekir; dosya Git tarafından ignore edilir. Dosya olmadan debug APK derlenebilir, ancak gerçek FCM cihaz kaydı/teslimatı doğrulanmış sayılmaz.

Yerel doğrulama: `npm run test:push-notifications`, `npm run build`, `npm run android:sync` ve `android\gradlew.bat assembleDebug`.

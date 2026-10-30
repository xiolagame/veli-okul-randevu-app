# Android giriş başlangıcı ve inceleme kullanıcı adları

30 Ekim 2026. Dal: `feature/android-login-polish-20261030`; başlangıç: `d3121b272f06126ab9be24326a48dc412e77873e`.

## Kanıt ve düzeltme

Android `resolveLoginEntry`, capability durumu loading/error olduğunda da false başlangıç bayraklarıyla legacy parola formunu seçiyordu. Başarılı telefon giriş yanıtı formu değiştirebiliyordu. Artık pending durumunda mevcut nötr yükleme, hatada mevcut yeniden deneme görünür; yalnız hazır yanıt form seçer. Android'de bozuk capability yanıtları hata olarak ele alınır. Sunucunun açıkça izin verdiği legacy akış korunur.

İkinci sorun: kayıtlı review JWT varken API istemcisi public capability isteğini de Oracle'a yönlendiriyordu. Geçerli review oturumuyla Oracle'daki bu yol HTTP 403 döndürdü. Android public capability sorgusu artık tokensız production API'ye gider; review veri isteklerinin Oracle yönlendirmesi değişmedi. JWT, CORS ve tenant kontrolleri gevşetilmedi.

Production GET kontrolünde Android ve Capacitor origin'leri için HTTP 200 ve uygun CORS, whatsapp/unified/phoneCentric bayrakları true görüldü. Bu nedenle güncel normal giriş WhatsApp/telefon akışıdır. Bunlar istemcide sabitlenmedi.

USB cihazdan yalnız okunan APK SHA-256: `0654ba8ad7605581ab22c48b19a873163abbf9c36998de1148eaa041e4cbd864`. Paket içindeki politika aynı pending/error kusurunu içeriyor. Başarılı true yanıtında statik akış **parola → OTP** öngörür. Kullanıcının bildirdiği **OTP → parola** sırası fiziksel ekran kaydı/network ile kesinleştirilemedi; bu sıra doğrulandı diye raporlanmaz. Paket son yerel web paketiyle birebir eşleşmediğinden APK'ya kesin kaynak commit'i atanmıyor. Native splash giriş formu değil marka görselidir. SSR/hydration yok; tema form tipini seçmiyor.

## Demo hesapları

Kullanıcının açık onayıyla yalnız kullanıcı adları değişti. Önceden oluşturulan farklı, rastgele altı karakterli parolalar aynen korundu. Tekrarlı beş haneli parolalar uygulanmadı.

| Rol | Google | Apple |
|---|---|---|
| Okul yöneticisi | google1 | apple1 |
| Öğretmen | google2 | apple2 |
| Veli | google3 | apple3 |
| Güvenlik | google4 | apple4 |

Sunucu registry'sindeki `loginName` gerçek giriş eşleşmesidir; yalnız görünür etiket değildir. Kanonik review kimlikleri, DB ilişkileri, okul ve rol kapsamları korunur. Eski giriş adları reddedilir. Registry sürümleri artırılarak eski JWT'ler iptal edildi; yeni tokenların kanonik kimlik yapısı mevcut iOS/Android istemcileriyle uyumludur. Rate limit aynı kanonik hesap bütçesini kullanır.

Oracle'da yalnız iki review servis kaynak dosyası ve registry alias/sürümleri güncellendi. Mevcut beş güvenlik düzeltmesi korundu. Root korumalı kaynak/registry ve eski image yedeği, atomik geçiş, readiness ve güvenlik sürümlerini azaltmayan rollback hazırlandı. Demo DB sıfırlanmadı; parola/scrypt hash'leri değiştirilmedi. Login/audit sayaçlarının olağan yazımları dışında veri değişikliği yapılmadı. Windows CurrentUser DPAPI kasası aynı parolalarla eşleştirildi. Eski tokenlar yalnız DPAPI operasyon durumunda saklandı.

## Testler ve sınırlar

- TypeScript `npm run lint`: PASS.
- Production `npm run build`: PASS; native binary üretmez.
- `npm run android:sync:review`: PASS; review HTTPS origin ve 56 dosyalık Android web paketi doğrulandı; APK/AAB üretmez.
- `node scripts/test-android-auth-startup.mjs --baseline`: eski pending → parola → OTP kusuru yeniden üretildi.
- Aynı test düzeltmeyle: açık/koyu × phone/legacy/error/malformed, 8 senaryo PASS. DOM MutationObserver kısa süreli yanlış form eklenmesini de denetler. Retry, yavaş yanıt, pageshow'da alan kimliği/değeri ve inceleme erişimi korunur. Bunlar Chromium fixture testleridir.
- `node scripts/test-android-login-polish.mjs`: altı genişlik, iki tema, klavye viewport/safe-area simülasyonu, OTP/review fixture ve native bridge sözleşmeleri PASS.
- `node --import tsx scripts/test-ios-login-policy.ts`, `test-review-access.ts`, `test-review-aliases.ts`, `test-android-demo-push-safety.ts` ve `node scripts/test-review-client.mjs`: PASS. Sonuncu, kayıtlı review tokenına rağmen capability isteğinin production'a tokensız gittiğini sınar.
- Oracle canlı sentetik hesap testi: 8/8 yeni adla HTTP 200, doğru rol/okul ve yeni JWT erişimi; 8/8 eski ad ve eski JWT HTTP 401; 8/8 diğer mağaza okuluna HTTP 403. Yanlış parola HTTP 401. Rate-limit negatif testleri yerel fixture'da yapıldı; canlı sayaçlar sıfırlanmadı.
- Windows görüntüleyici SelfTest ve UiSelfTest: PASS; sekiz seçim, maskeli/salt okunur parola, kopyalama ve süreli temizleme kontrolleri. Parola veya token çıktısı üretilmedi.
- Normal WhatsApp auth ve unified login backend regresyonları: PASS; yalnız yerel sentetik test verileri. Gerçek OTP mesajı gönderilmedi.
- Android shell, review paket doğrulaması ve release güvenlik kontrolü: PASS. Frozen kaynak kontrolü çalışma klasöründe ve temiz Git index export alanında 464/464 PASS; metin/binary değiştirme negatif testleri PASS. Staged 14 dosyada gerçek sekiz kasa parolasının bulunmadığı, secret desenleri ve yasak build/veri dosyalarının eklenmediği doğrulandı.
- Node 24.17.0 ile 24 regresyon: Android klasöründe 23 PASS, iOS shell eksik üretilmiş `capacitor.config.json` nedeniyle FAIL. Aynı shell testi önceden Capacitor sync yapılmış ayrı geçici alanda PASS. Sonuç tek koşuda 24/24 olarak gösterilmez. Gerçek Xcode derlemesi yapılmadı.
- Arşiv production provenance PASS. Eski `verify-ios-license-sync.mjs` ise başlangıçtan miras Android native UI değişikliklerini eski 651e46 tabanlı izin listesinde tanımadığı için FAIL; kontrol değiştirilmedi/kapatılmadı. Güncel kilit ve bu görev başlangıcına göre korunan dosya denetimi ayrıca uygulanır.

Yerel ayrıntılı çıktılar Git'e alınmayan `audit/android-startup/` altındadır. Yeni APK fiziksel cihazda çalıştırılmadı. Temiz kurulum, kayıtlı oturum, çevrimdışı açılış ve gerçek arka plan/ön plan geçişleri yeni APK'da kullanıcı testi bekler. Önceki sürümdeki 61 saniyelik dört rol testi bu değişikliğin fiziksel testi sayılmaz.

## Değişen dosyaların kapsamı

- `src/platform/login-capability-policy.ts`, `src/components/AuthView.tsx`: Android capability kapısı ve yanıt doğrulaması.
- `src/services/api.ts`: yalnız Android public capability origin/token ayrımı.
- `server/review-access.ts`, `server/review-service.ts`: sınırlı login alias eşleşmesi, doğrulama ve kanonik rate-limit bütçesi.
- `scripts/test-android-auth-startup.mjs`, `scripts/test-review-aliases.ts`: yeni negatif/regresyon testleri.
- `scripts/test-ios-login-policy.ts`, `test-android-login-polish.mjs`, `test-review-client.mjs`, `test-android-review-session.mjs`: düzeltilmiş beklentiler ve alias girişi.
- Bu rapor, mağaza notu taslağı ve `audit/ios-source-lock.json`: belge ve gözden geçirilmiş kaynak hash'leri.

iOS'a özel kaynaklar, normal OTP bileşeni, auth-session, tema, `04-Mobil.png`, Android native tasarım/sistem çubukları ve FCM düzeltmesi bu görevde değiştirilmedi. Paylaşılan istemcideki yeni davranış Android koşuluyla sınırlı. Production, Supabase, main ve iOS feature dalı güncellenmedi.

Push öncesinde xiolagame hesabı/hedef repo ve yazma yetkisi doğrulandı. GitHub Actions akışı 0, repo webhook'u 0, bu dal için açık PR 0. Codemagic uygulama panelinde otomatik build için webhook gerektiği ve zamanlanmış build bulunmadığı görüldü; yerel YAML tetikleyici içermiyor. Netlify paneli production dalını main, branch deploy kapsamını yalnız production dalı olarak gösterdi. PR açılmayacağı için preview tetiklenmez. Hesap ayarı değiştirilmedi; push yalnız Android feature dalına yapılır.

## Kullanıcının sonraki adımı

Android Studio'da bu dalı açın. `npm ci` gerekirse çalıştırın; ardından `npm run android:sync:review` ve Android Studio'da Gradle Sync yapın. APK/AAB'yi kullanıcı oluşturur. Yeni APK'da özellikle ilk açılış, yavaş/kapalı ağ, retry, çıkış/yeniden giriş, google1..4 ve arka plan geçişlerini test edin. Bu çalışma APK/AAB, Codemagic, TestFlight veya mağaza işlemi başlatmaz.

Yerel parola aracı: `%USERPROFILE%\.codex\secure\veli-review-demo-20261030\Open-ReviewAccounts.cmd`. Parolaları rapora veya inceleme dışındaki kanallara kopyalamayın. Kapatma aracı aynı klasörde `Close-ReviewAccounts.cmd`; yalnız inceleme bitince `DEMO KAPAT` onayıyla kullanın. Bu kapatma henüz çalıştırılmadı.

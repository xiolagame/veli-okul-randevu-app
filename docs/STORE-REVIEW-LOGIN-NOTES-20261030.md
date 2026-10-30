# Mağaza inceleme giriş notları taslağı

Bu taslak mağaza paneline gönderilmedi. Parolalar burada veya kaynak kodunda bulunmaz; Windows DPAPI görüntüleyicisinden yalnız ilgili mağazanın gizli inceleme alanına kullanıcı tarafından aktarılır.

Uygulamada **Mağaza inceleme erişimi** seçin. İnceleme kimliği ve ilgili parolayla **Demo okuluna gir** düğmesine dokunun. WhatsApp mesajı veya OTP beklenmez. Görülen okul ve kişiler sentetiktir. Mesaj ve bildirim senaryoları gerçek alıcılara gönderim yapmaz. Normal kullanıcı WhatsApp girişi ayrı kalır.

| Rol | Google Play incelemesi | Apple incelemesi |
|---|---|---|
| Okul yöneticisi | google1 | apple1 |
| Öğretmen | google2 | apple2 |
| Veli | google3 | apple3 |
| Güvenlik | google4 | apple4 |

Her hesabın farklı parolası vardır. Diğer rolü incelemek için oturumu kapatıp ilgili hesapla giriş yapın. Apple ve Google ayrı demo okullarıdır; bir mağazanın hesabı diğer okulun verilerine erişemez. Sınırsız platform yöneticisi yetkisi verilmez. Hatalı girişleri tekrarlamayın; mevcut rate limit uygulanır.

Windows aracı: `%USERPROFILE%\.codex\secure\veli-review-demo-20261030\Open-ReviewAccounts.cmd`. İlgili hesabı seçin; parola maskeli açılır, isteğe bağlı gösterilir veya kopyalanır. Pano geçmişi/bulut senkronizasyonu açıksa elle yazmayı tercih edin.

İnceleme boyunca demo API'nin erişilebilirliğini koruyun. İnceleme bittikten sonra yerel `Close-ReviewAccounts.cmd` aracıyla hesapları kontrollü kapatın. Süreç parola/JWT paylaşımı veya production değişikliği gerektirmez.

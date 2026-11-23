# Excel şablonları (öğretmen/personel ve öğrenci-veli)

## Ne bozuktu
- Öğretmen şablonu `/PERSONEL_BİLGİ_FORMU.xlsx` (Türkçe karakterli ad) canlıda **dağıtılmıyordu**. Netlify'ın SPA yönlendirmesi
  (`/* → /index.html`, 200) devreye girip `index.html` döndürüyordu; tarayıcı bu HTML'yi `.xlsx` adıyla kaydediyor, Excel
  "dosya bozuk" diyordu. Öğrenci-veli şablonu ASCII adlı olduğu için çalışıyordu.
- Android/iOS uygulamalarında `<a download>` ve Blob indirmesi WebView'da çalışmaz; düğme sessizce hiçbir şey yapmıyordu.

## Şimdi
- Şablonlar **yalnız ASCII adlarla** yayınlanır: `/personel-bilgi-formu.xlsx`, `/ogrenci-veli-bilgi-formu.xlsx`.
  İndirilen dosya adı yine Türkçedir (`PERSONEL_BİLGİ_FORMU.xlsx`, `ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx`).
- `src/utils/excel-templates.ts`: tek indirme yolu. İndirileni `PK\x03\x04` zip imzasıyla doğrular; HTML/404 asla kaydedilmez.
  - Web: doğrulanmış Blob indirmesi.
  - Android/iOS uygulaması: `@capacitor/app-launcher` (zaten pakette) ile `https://velirandevu.com/...xlsx` sistem tarayıcısında açılır.
    Yeni native eklenti gerekmez. **Önce web deploy edilmeli** (dosya canlıda olmalı), sonra uygulama sürümü.
- `src/components/ExcelTemplateButton.tsx` üç yerde kullanılır: Personel sayfası, Toplu Personel Ekle penceresi (yeni) ve öğrenci-veli toplu kayıt.
- Yükleme: yeniden adlandırılmış sayfa (Google E-Tablolar/Numbers) ilk sayfadan okunur, başlık kontrolü sürer; HTML'in `.xlsx` olarak
  yüklenmesi açık bir mesajla reddedilir; dosya seçicide MIME tipi de verilir (iOS).
- `netlify.toml`: eski Türkçe adlı bağlantılar için 301 yönlendirmeleri (SPA yedeğinden önce).

## Şablonu değiştirmek
`node scripts/build-excel-templates.mjs` (tekrar çalıştırılabilir, deterministik). Standart OOXML üretir (Content_Types, BOM yok,
açılır liste hata mesajı, sütun metin biçimi, dondurulmuş başlık). Sonra `npm run test:excel-templates` ve özet değişiyorsa
`scripts/test-staff-excel-template.ts` içindeki sha256 değerini güncelleyin.

## Dikkat: eski Türkçe adlı dosyalar silinmedi
`public/PERSONEL_BİLGİ_FORMU.xlsx` ve `public/ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx` hâlâ duruyor (ASCII sürümlerin birebir kopyası).
iOS arşiv kanıt manifestosu (`audit/production-source-manifest.json`) bu yolları okur; silmek iOS provenance kapısını kırar.
Kodda bunlara bağlantı verilmez (test kontrol eder).

## Doğrulama durumu
- PASS: `npm run test:excel-templates`, tarayıcıda web indirme (zip imzası, boyut, ad, MIME) ve bozuk HTML yükleme mesajı.
- NOT VERIFIED: gerçek Microsoft Excel/Numbers ile açma; Android/iOS cihazda dokunma ve sistem tarayıcısında indirme; canlı Netlify yönlendirmeleri.

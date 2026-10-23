import { PUBLIC_CONTACT_PATH } from '../utils/public-request-route';

export interface HelpSection {
  title: string;
  paragraphs?: string[];
  steps?: string[];
  bullets?: string[];
  note?: string;
}

export interface HelpGuide {
  title: string;
  eyebrow: string;
  description: string;
  sections: HelpSection[];
}

const legalDraftNotice = 'Bu içerik Veli Randevu’nun mevcut teknik ve operasyonel yapısına göre hazırlanmış taslak bilgilendirmedir. Resmî hukuki metin, operasyon ve hukuk doğrulaması tamamlandıktan sonra kesinleştirilecektir.';

export const helpGuides = {
  'okul-yoneticisi': {
    eyebrow: 'NASIL KULLANILIR?',
    title: 'Kurum / Okul Yöneticisi Rehberi',
    description: 'Okulunuzun personelini, öğrenci-veli kayıtlarını, randevu ayarlarını ve taleplerini yönetin.',
    sections: [
      {
        title: 'İlk giriş ve aktivasyon',
        steps: [
          'Birleşik giriş etkinse kayıtlı telefon numaranızla WhatsApp kodunu doğrulayın.',
          'İlk okul yöneticisi aktivasyonunda kayıtlı e-posta adresinize gönderilen 6 haneli ikinci doğrulama kodunu da girin.',
          'Sonraki girişlerde kayıtlı telefonunuza gönderilen tek kullanımlık WhatsApp kodunu kullanın. Platform Yönetimi hesabı ayrı parola girişiyle çalışır.',
          'Geçiş süresince eski mobil sürümlerdeki “Okul Yöneticisi İlk Giriş” ve parola kurtarma akışları kullanılabilir.',
        ],
      },
      {
        title: 'Personel yönetimi',
        bullets: [
          'Yönetim panelindeki Personel alanından Öğretmen veya Güvenlik rolüyle yeni personel ekleyebilirsiniz.',
          'Öğretmen kaydında ad soyad, branş, telefon ve e-posta; güvenlik kaydında ad soyad, telefon ve e-posta gerekir.',
          'WhatsApp doğrulaması etkin olduğunda personel, birleşik giriş ekranında kayıtlı telefonuyla tek kullanımlık kod alarak hesabını etkinleştirir. Eski mobil sürümlerin parola ve aktivasyon akışları geçiş süresince çalışmaya devam eder.',
          'Personel bilgilerini düzenleyebilir ve yalnız kendi okulunuzdaki personel kayıtlarını yönetebilirsiniz.',
        ],
      },
      {
        title: 'Öğrenci ve veli kayıtları',
        bullets: [
          'Öğrenci ve veliler alanında sınıfa göre kayıtları görüntüleyebilir, arayabilir ve yönetebilirsiniz.',
          'Toplu kayıt ekleme aracıyla öğrenci-veli kayıtlarını Excel dosyasından içeri aktarabilirsiniz.',
          'Veli hesabı, okul kodu ve kayıtlı veli telefonu WhatsApp ile doğrulandığında ilgili okul kaydıyla bağlanır. Doğum tarihi giriş doğrulaması olarak kullanılmaz.',
        ],
      },
      {
        title: 'Randevular ve okul ayarları',
        bullets: [
          'Randevular alanında bugünkü veya tüm okul randevularını durumlarıyla birlikte izleyebilirsiniz.',
          'Okul ayarlarından standart görüşme süresini belirleyebilirsiniz. Öğretmenlerin eklediği müsaitlikler bu süreye göre randevu saatlerine ayrılır.',
          'Velilerin kendi bekleyen veya onaylanmış randevularını iptal edip edemeyeceğini okul ayarından yönetebilirsiniz.',
        ],
      },
      {
        title: 'İşlem günlüğü ve destek',
        bullets: [
          'İşlem günlüğü okulunuzdaki yönetim ve randevu işlemlerinin kayıtlarını gösterir.',
          'Destek / Lisans alanından teknik destek veya yıllık lisans talebi oluşturabilir, yalnız kendi okulunuzun taleplerini takip edebilirsiniz.',
          'Parolanızı unuttuğunuzda giriş ekranındaki okul yönetimi parola sıfırlama akışını kullanın. Kod kayıtlı e-posta adresinize gönderilir.',
        ],
      },
    ],
  },
  ogretmen: {
    eyebrow: 'NASIL KULLANILIR?',
    title: 'Personel / Öğretmen Rehberi',
    description: 'Hesabınızı etkinleştirin, haftalık müsaitliğinizi belirleyin ve veli taleplerini yönetin.',
    sections: [
      {
        title: 'Hesabı etkinleştirme ve giriş',
        steps: [
          'Okul yönetimi sizi Öğretmen rolüyle ad, branş, telefon ve e-posta bilgilerinizle tanımlar.',
          'WhatsApp doğrulaması etkinse birleşik giriş ekranına kayıtlı telefonunuzu girip WhatsApp kodunu isteyin.',
          'Kodu doğruladıktan sonra aynı kayıtlı telefonla WhatsApp üzerinden giriş yapın. Okul yöneticisinin ilk aktivasyonunda ek e-posta doğrulaması istenir.',
        ],
      },
      {
        title: 'Müsaitlik programı',
        bullets: [
          'Müsaitlik alanından Pazartesi–Cumartesi için başlangıç ve bitiş saati ekleyebilirsiniz.',
          'Eklediğiniz haftalık aralıklar okulun standart görüşme süresine göre velilere uygun saat olarak gösterilir.',
          'Artık kullanmadığınız müsaitlik aralıklarını listeden kaldırabilirsiniz.',
        ],
      },
      {
        title: 'Randevu talepleri',
        bullets: [
          'Randevular alanında tüm, bugünkü, onay bekleyen ve onaylanan görüşmeleri filtreleyebilirsiniz.',
          'Bekleyen bir talebi onaylayabilir veya isteğe bağlı bir gerekçeyle reddedebilirsiniz.',
          'Onaylanmış bir randevuyu gerektiğinde iptal edebilirsiniz. Sonuç veli ekranındaki randevu durumuna yansır.',
        ],
      },
      {
        title: 'Parola sıfırlama ve güvenlik',
        paragraphs: [
          'WhatsApp girişi etkin personel için parola gerekmez; her girişte kısa süreli ve tek kullanımlık kod doğrulanır. Eski parola hesabınız varsa mevcut parola sıfırlama akışı kullanılabilir.',
        ],
      },
    ],
  },
  veli: {
    eyebrow: 'NASIL KULLANILIR?',
    title: 'Veli Rehberi',
    description: 'Hesabınızı okul kaydıyla doğrulayın, öğretmenlerin uygun saatlerinden randevu talebi oluşturun.',
    sections: [
      {
        title: 'Veli hesabı oluşturma',
        steps: [
          'Giriş ekranından “Veli ilk giriş” seçeneğini açın.',
          'Okul kodunu ve okul kayıtlarında bulunan telefon numaranızı girin.',
          'Telefonunuz okulun öğrenci-veli kaydıyla eşleşirse WhatsApp üzerinden gelen 6 haneli kodu doğrulayın.',
          'Hesap etkinleştikten sonra kayıtlı telefonunuza gönderilen tek kullanımlık WhatsApp koduyla giriş yapın.',
        ],
      },
      {
        title: 'Randevu oluşturma',
        steps: [
          'Öğretmenler alanından öğrencinizle ilişkili öğretmeni seçin.',
          'Görüşülecek öğrenciyi, öğretmenin uygun olduğu tarihi ve boş saati seçin.',
          'İsterseniz kısa bir not ekleyip randevu talebini gönderin.',
          'Talep öğretmenin onayından sonra kesinleşir. Durumu Randevular alanından takip edin.',
        ],
      },
      {
        title: 'Randevu durumu ve giriş kartı',
        bullets: [
          'Bekleyen talepler henüz okul giriş izni vermez.',
          'Onaylanmış randevuda QR giriş kartınızı açıp okul girişinde güvenlik görevlisine gösterebilirsiniz.',
          'Okul ayarı izin veriyorsa bekleyen veya onaylanmış randevunuzu iptal edebilirsiniz.',
          'Uygulamada ayrı bir randevu değiştirme akışı yoktur; farklı zaman için mevcut randevuyu uygun olduğunda iptal edip yeni talep oluşturun.',
        ],
      },
      {
        title: 'Giriş doğrulaması',
        paragraphs: [
          'WhatsApp girişi etkin olduğunda veli parolası gerekmez. Giriş ekranında kayıtlı telefonunuzu yazıp yeni bir tek kullanımlık kod isteyin.',
        ],
      },
    ],
  },
  guvenlik: {
    eyebrow: 'NASIL KULLANILIR?',
    title: 'Güvenlik Rehberi',
    description: 'Kamera ile randevu QR kodunu okutun ve sunucunun verdiği giriş sonucunu doğru yorumlayın.',
    sections: [
      {
        title: 'Aktivasyon ve giriş',
        steps: [
          'Okul yönetimi sizi Güvenlik rolüyle telefon ve e-posta bilgileriniz üzerinden tanımlar.',
          '“Personel ilk giriş” alanında okul kodunu ve kayıtlı telefonunuzu girip WhatsApp doğrulama kodunu isteyin.',
          'Kodu doğruladıktan sonra kayıtlı telefonunuza gönderilen tek kullanımlık kodla giriş yapın.',
        ],
      },
      {
        title: 'QR kod tarama',
        steps: [
          '“QR Kod Tara” düğmesine basın ve tarayıcının kamera iznine izin verin.',
          'Velinin randevu kartındaki QR kodu kamera çerçevesine gösterin.',
          'Uygulama QR içeriğini sunucuda, güvenlik hesabınızın bağlı olduğu okul kapsamında doğrular.',
          'Sonuç ekranındaki başlık ve açıklamaya göre hareket edin. Renk tek başına karar ölçütü değildir.',
        ],
        note: 'Kamera yalnız QR kodunu okuyabilmek için kullanılır. Uygulama fotoğraf veya video kaydı oluşturmaz; kamera görüntüsünü sunucuya yüklemez, yalnız çözülen QR metnini doğrulama servisine gönderir.',
      },
      {
        title: 'Giriş zaman penceresi',
        paragraphs: [
          'Onaylanmış bir randevu için giriş penceresi, randevu başlangıcından 30 dakika önce açılır ve randevu bitişinden 30 dakika sonra kapanır.',
        ],
      },
      {
        title: 'QR sonuçlarının anlamı',
        bullets: [
          'RANDEVU ONAYLANDI: Randevu onaylıdır ve giriş zaman penceresi açıktır.',
          'RANDEVU SAATİ HENÜZ GELMEDİ: Randevu onaylıdır ancak giriş penceresi henüz açılmamıştır.',
          'RANDEVU SÜRESİ GEÇMİŞ: Randevunun giriş penceresi kapanmıştır.',
          'RANDEVU İPTAL EDİLMİŞ veya RANDEVU REDDEDİLMİŞ: Giriş verilmemelidir.',
          'RANDEVU HENÜZ ONAYLANMADI: Öğretmen onayı beklenmektedir; giriş verilmemelidir.',
          'GEÇERSİZ QR KODU: Kod, bu okul kapsamında geçerli bir randevuyla doğrulanamamıştır.',
        ],
      },
    ],
  },
  'ilk-giris': {
    eyebrow: 'HESAP VE GÜVENLİK',
    title: 'İlk Giriş ve Hesap Aktivasyonu',
    description: 'İlk kullanım adımları rolünüze göre farklıdır.',
    sections: [
      {
        title: 'Veli',
        paragraphs: ['“Veli ilk giriş” alanında okul kodu ve kayıtlı telefonunuzu girin; WhatsApp üzerinden gelen tek kullanımlık kodla okul kaydınızı doğrulayın.'],
      },
      {
        title: 'Öğretmen ve güvenlik personeli',
        paragraphs: ['Okul yönetiminizin oluşturduğu personel kaydındaki okul kodu ve telefonla “Personel ilk giriş” akışını açın; WhatsApp kodunu doğrulayın.'],
      },
      {
        title: 'Okul yöneticisi',
        paragraphs: ['Birleşik girişte kayıtlı telefonunuza gelen WhatsApp kodunu doğrulayın; ilk okul yöneticisi aktivasyonunda kayıtlı e-posta adresine gönderilen ikinci kodu da girin. Eski mobil sürümlerde mevcut okul yöneticisi aktivasyon ekranı geçiş süresince kullanılabilir.'],
      },
    ],
  },
  'parolami-unuttum': {
    eyebrow: 'HESAP VE GÜVENLİK',
    title: 'Parolamı Unuttum',
    description: 'Hesap türünüze uygun doğrulama yöntemini kullanarak yeni parola belirleyin.',
    sections: [
      {
        title: 'Veli girişi',
        paragraphs: ['WhatsApp girişi etkin veli hesabında parola gerekmez. Kayıtlı telefonunuza yeni bir tek kullanımlık kod isteyerek giriş yapın.'],
      },
      {
        title: 'Öğretmen ve güvenlik personeli parolası',
        paragraphs: ['WhatsApp girişi etkin personel hesabında parola gerekmez. Eski parola hesabı kullanılıyorsa mevcut personel parola sıfırlama alanı kayıtlı e-posta üzerinden çalışmaya devam eder.'],
      },
      {
        title: 'Okul yöneticisi parolası',
        paragraphs: ['Okul Yöneticisi parola sıfırlama alanında okul kodu ve telefonu girin. Kayıt uygunsa kod, okul yöneticisinin kayıtlı e-posta adresine gönderilir. Bu kurtarma yolu WhatsApp ile aktive edilmiş parolasız okul yöneticisi hesabında da güvenli geri dönüş için kullanılabilir.'],
      },
    ],
  },
  'hesap-guvenligi': {
    eyebrow: 'HESAP VE GÜVENLİK',
    title: 'Hesap Güvenliği',
    description: 'Hesabınızı ve okul bilgilerini korumak için temel güvenlik adımları.',
    sections: [
      {
        title: 'Güvenli kullanım',
        bullets: [
          'Parolanızı ve WhatsApp, aktivasyon veya parola sıfırlama kodlarınızı başka kişilerle paylaşmayın.',
          'Ortak veya başkasına ait bir cihaz kullandıysanız işiniz bitince oturumu kapatın.',
          'Şüpheli bir erişim fark ederseniz rolünüze uygun parola sıfırlama akışıyla parolanızı yenileyin ve okul yönetiminize bilgi verin.',
          'Yalnız resmi Veli Randevu ekranlarını kullanın; sizden parola isteyen bağlantılara karşı dikkatli olun.',
        ],
      },
    ],
  },
  'hesap-silme': {
    eyebrow: 'HESAP VE GÜVENLİK',
    title: 'Hesabımı Silme',
    description: 'Hesabınızı uygulama içinden güvenli ve kalıcı olarak silin.',
    sections: [
      { title: 'Silme yoluna nasıl ulaşılır?', paragraphs: ['Sağ üstteki Hesabım menüsünü açın, “Hesap ve gizlilik” bölümünden “Hesabımı sil” seçeneğine dokunun. Bu işlem için telefon, e-posta veya destek formu kullanmanız gerekmez.'] },
      { title: 'Güvenlik doğrulaması', paragraphs: ['Parolası bulunan hesaplarda mevcut parola; parolasız WhatsApp hesaplarında işleme özel tek kullanımlık WhatsApp kodu istenir. HESABIMI SİL onay metni veya kimlik doğrulaması geçersizse hiçbir veri değiştirilmez ve oturum açık kalır.'] },
      { title: 'Kalıcı olarak silinenler', bullets: ['Ad, telefon, e-posta, parola özeti ve hesap güvenliği bilgileri', 'Okul üyelikleri ve veli-öğrenci bağlantıları', 'Push cihaz kayıtları, tokenlar ve aktif oturum erişimi', 'Kullanıcının kişisel destek içeriği ve randevu notları'] },
      { title: 'Anonim olarak korunabilenler', paragraphs: ['Okulun öğrenci kaydı ile zorunlu randevu, işlem ve güvenlik kayıtları kurumsal kayıt bütünlüğü için korunabilir. Bu kayıtlarda kullanıcı kimliği, iletişim bilgileri ve eski kullanıcı bağlantısı kaldırılır; kişi “Silinmiş Kullanıcı” veya “Silinmiş Veli” olarak gösterilir. Öğrenci kaydı yalnız veli hesabı silindiği için silinmez.'] },
      { title: 'Tamamlanma ve bildirim', paragraphs: ['Silme işlemi tek bir sunucu işlemi içinde tamamlanır. Başarı yanıtından sonra bu cihazdaki güvenli oturum temizlenir ve eski oturum anahtarları hesabı kullanamaz. Kayıtlı e-posta varsa tamamlanma bildirimi gönderilmeye çalışılır; e-posta gönderilememesi tamamlanmış silme işlemini geri almaz. Güvenli tekrar denemeleri için kullanıcı kimliğini içermeyen, tek yönlü bir işlem makbuzu en fazla 30 gün tutulur.'] },
    ],
  },
  'kvkk-aydinlatma': {
    eyebrow: 'GİZLİLİK VE YASAL',
    title: 'KVKK Aydınlatma Metinleri',
    description: 'Rollere göre kullanılan veriler ve mevcut uygulama süreçleri hakkında taslak bilgilendirme.',
    sections: [
      {
        title: 'Taslak bilgilendirme',
        paragraphs: [legalDraftNotice, 'Bu sayfa bir onay veya kabul ekranı değildir. Rolünüze ilişkin mevcut süreçleri anlamanıza yardımcı olmak amacıyla hazırlanmıştır.'],
      },
      {
        title: 'Kurum / Okul Yöneticisi',
        bullets: [
          'Hesap oluşturma ve aktivasyon sürecinde okul kodu, telefon, e-posta ve aktivasyon bilgileri kullanılır.',
          'Yetkilendirme; kullanıcı hesabı, aktif okul üyeliği ve okul yöneticisi rolü üzerinden uygulanır.',
          'Okul, personel, öğrenci-veli kayıtları, randevu ayarları ve destek talepleri okul kapsamı içinde yönetilir.',
          'Hesap ve yönetim işlemleri güvenlik ve izlenebilirlik amacıyla işlem kayıtlarına konu olabilir.',
        ],
      },
      {
        title: 'Personel / Öğretmen',
        bullets: [
          'Öğretmen hesabı okul yönetimi tarafından ad, branş, telefon ve e-posta bilgileriyle tanımlanır.',
          'WhatsApp doğrulaması etkin olduğunda aktivasyon ve giriş kayıtlı telefon üzerinden tek kullanımlık kodla yürütülür; eski parola hesapları için mevcut kurtarma akışı korunur.',
          'Öğretmen kendi okulundaki müsaitlik ve kendisiyle ilişkili randevu işlemlerine yetkisi kapsamında erişir.',
          'Hesap güvenliği için parola ve tek kullanımlık kodların başka kişilerle paylaşılmaması gerekir.',
        ],
      },
      {
        title: 'Veli ve Öğrenci',
        bullets: [
          'Veli hesabı; okul kodu ve veli telefonu okul kaydıyla eşleştirilip WhatsApp tek kullanımlık koduyla doğrulanır.',
          'Veli-öğrenci ilişkisi, velinin yalnız ilişkili olduğu öğrenci ve randevu süreçlerine erişebilmesi için kullanılır.',
          'Öğretmen seçimi, randevu talebi, randevu durumu ve onaylı randevuya ait QR giriş kartı uygulama içinde gösterilir.',
          'Veli erişimi yalnız okul kütüğünde aynı telefonla doğrulanan gerçek veli-öğrenci ilişkilerine açılır.',
        ],
      },
      {
        title: 'Güvenlik',
        bullets: [
          'Güvenlik hesabı okul yönetimi tarafından tanımlanır ve WhatsApp doğrulaması etkin olduğunda kayıtlı telefona gelen tek kullanımlık kodla kullanılır.',
          'Yetkilendirme aktif okul üyeliği ve güvenlik rolüyle sınırlandırılır.',
          'QR doğrulama yalnız hesabın bağlı olduğu okul kapsamındaki randevular için yapılır.',
          'Randevu durumu ve giriş zaman penceresi sunucuda doğrulanır; sonuç ekranı giriş kararına yardımcı olur.',
        ],
      },
      {
        title: 'Kesinleştirilecek hukuki ve operasyonel bilgiler',
        paragraphs: [
          'Resmî veri sorumlusu unvanı ve iletişim bilgileri; hukuki sebepler, aktarım alıcıları, yurt dışı aktarım durumu, kesin saklama süreleri ve veri sahibi başvuru kanalı operasyon ve hukuk doğrulaması sonrası kesinleştirilecektir.',
        ],
      },
    ],
  },
  'gizlilik-politikasi': {
    eyebrow: 'GİZLİLİK VE YASAL',
    title: 'Gizlilik Politikası',
    description: 'Veli Randevu içindeki veri akışlarına ilişkin okunabilir taslak bilgilendirme.',
    sections: [
      { title: 'Taslak bilgilendirme', paragraphs: [legalDraftNotice] },
      { title: 'Gizlilik yaklaşımımız', paragraphs: ['Veli Randevu, kullanıcıların yalnız görevleri ve okul ilişkileri için gerekli verilere erişmesini hedefleyen rol ve okul kapsamlı bir yapı kullanır. Erişim kararları istemciden gelen okul bilgisine değil, sunucuda doğrulanan kullanıcı, üyelik ve rol bilgilerine dayanır.'] },
      { title: 'Hesap ve kimlik doğrulama verileri', paragraphs: ['Telefon, e-posta, parola özeti ve tek kullanımlık doğrulama süreçlerine ait güvenlik verileri hesap oluşturma, giriş ve hesap kurtarma işlemlerinde kullanılır. Parolalar ve tek kullanımlık kodlar açık metin olarak saklanmamalıdır.'] },
      { title: 'Okul ve rol bilgileri', paragraphs: ['Okul üyeliği ve rol bilgileri, okul yöneticisi, öğretmen, veli ve güvenlik personelinin hangi ekranlara ve kayıtlara erişebileceğini belirlemek için kullanılır.'] },
      { title: 'Öğrenci-veli ilişkisinde veri minimizasyonu', paragraphs: ['Veli hesabı oluşturulurken okul kodu ve kayıtlı telefon gerçek okul kaydıyla eşleştirilir; telefon WhatsApp koduyla doğrulanır. Veli erişimi yalnız doğrulanmış öğrenci-veli ilişkileriyle sınırlandırılır.'] },
      { title: 'Randevu verileri', paragraphs: ['Öğrenci, veli, öğretmen, tarih, saat, durum ve kullanıcı tarafından eklenen randevu notu gibi bilgiler görüşmenin oluşturulması, yönetilmesi ve görüntülenmesi için kullanılır.'] },
      { title: 'QR doğrulama', paragraphs: ['Onaylanan randevunun QR verisi, okul girişinde güvenlik rolüne sahip kullanıcı tarafından sunucuya gönderilir. Sunucu; okul kapsamını, randevu durumunu ve giriş zaman penceresini doğrular.'] },
      { title: 'Kamera kullanımı', paragraphs: ['Kamera QR kodunun okunması için kullanılır. Veli Randevu uygulaması fotoğraf veya video kaydı oluşturmaz ve kamera görüntüsünü doğrulama servisine yüklemez; doğrulama için çözülen QR verisi kullanılır.'] },
      { title: 'Hesap ve işlem güvenliği', paragraphs: ['JWT tabanlı oturum, aktif okul üyeliği, rol yetkisi ve okul kapsamlı veri erişimi birlikte uygulanır. Hesap, yönetim ve randevu işlemleri güvenlik ve izlenebilirlik amacıyla işlem kayıtlarına konu olabilir.'] },
      { title: 'Destek talepleri', paragraphs: ['Public iletişim ve yıllık lisans formunda okul, yetkili, e-posta, telefon ve isteğe bağlı mesaj bilgileri alınır. Okul yöneticisinin destek alanından oluşturduğu talepler okul ve kullanıcı bağlamıyla ilişkilendirilir.'] },
      { title: 'Hizmet sağlayıcıları ve altyapı', paragraphs: ['Uygulamanın barındırma, veritabanı ve e-posta gönderimi gibi teknik ihtiyaçlarında hizmet sağlayıcı altyapıları kullanılabilir. Alıcı grupları, veri lokasyonu ve aktarım koşulları operasyon ve hukuk doğrulaması tamamlanmadan kesin hukuki beyan olarak sunulmamaktadır.'] },
      { title: 'Veri saklama ve silme', paragraphs: ['Kullanıcı, Hesabım menüsünden hesabını kalıcı olarak silebilir. Hesap kimliği, iletişim bilgileri, parola özeti, üyelikler, cihaz tokenları ve kişisel içerikler silinir; okulun zorunlu öğrenci, randevu ve güvenlik kayıtları kullanıcı kimliğinden ayrıştırılarak anonimleştirilir. Güvenli tekrar denemeleri için kullanıcı kimliğini içermeyen tek yönlü işlem makbuzu en fazla 30 gün tutulur. Kurumsal kayıtların kesin saklama süreleri veri envanteri ile hukuk ve operasyon doğrulamasına tabidir.'] },
      { title: 'Kullanıcı hakları ve iletişim', paragraphs: ['Resmî veri sahibi başvuru kanalı hukuk ve operasyon doğrulaması tamamlandıktan sonra burada yayınlanacaktır. Uygulamadaki genel destek kanalı, doğrulanmış resmî veri sahibi başvuru kanalı olarak sunulmamaktadır.'] },
    ],
  },
  'kullanim-kosullari': {
    eyebrow: 'GİZLİLİK VE YASAL',
    title: 'Kullanım Koşulları',
    description: 'Uygulamanın güvenli ve amacına uygun kullanımına ilişkin taslak koşullar.',
    sections: [
      { title: 'Taslak bilgilendirme', paragraphs: [legalDraftNotice, 'Bu metin henüz bir kabul ekranına bağlı değildir ve kurumsal lisans sözleşmesinin yerine geçmez.'] },
      { title: 'Hizmetin amacı', paragraphs: ['Veli Randevu; okul, veli, öğretmen ve güvenlik personeli arasındaki okul randevusu süreçlerini düzenlemek, randevu durumunu izlemek ve onaylı ziyaretlerin QR ile doğrulanmasına yardımcı olmak amacıyla sunulur.'] },
      { title: 'Kullanıcı hesabı ve bilgilerin doğruluğu', bullets: ['Kullanıcı hesabı kişiye özeldir ve başka bir kişiye kullandırılmamalıdır.', 'Kullanıcı, hesabı ve okul kaydı için sunduğu bilgilerin doğru ve güncel olmasına özen göstermelidir.', 'Okul yönetimi, kendi okulu kapsamındaki kullanıcı ve personel kayıtlarını yetkisi çerçevesinde tanımlar ve yönetir.'] },
      { title: 'Parola ve doğrulama kodu güvenliği', paragraphs: ['Parola ile WhatsApp, aktivasyon ve parola sıfırlama kodları gizli tutulmalı; şüpheli erişimde yeni bir doğrulama kodu istenmeli veya uygun parola sıfırlama akışı kullanılmalı ve gerektiğinde okul yönetimine bilgi verilmelidir.'] },
      { title: 'Randevu sisteminin amacı', paragraphs: ['Randevu kaydı, veli ile öğretmen arasındaki okul görüşmesini planlar. Bekleyen talep kesinleşmiş randevu veya giriş izni sayılmaz; uygulamadaki güncel durum dikkate alınmalıdır.'] },
      { title: 'QR doğrulamanın kapsamı', paragraphs: ['QR doğrulama, randevunun okul kapsamını, durumunu ve giriş zaman penceresini kontrol etmeye yardımcı olur. QR sonucu okulun kimlik kontrolü, ziyaretçi kaydı ve diğer fiziki güvenlik prosedürlerini ortadan kaldırmaz.'] },
      { title: 'Yetkisiz ve kötüye kullanım yasağı', bullets: ['Başka bir kullanıcıya ait hesaba, okula, öğrenciye, randevuya veya yönetim alanına yetkisiz erişim denenmemelidir.', 'QR verisi, aktivasyon kodu veya teknik güvenlik önlemleri yanıltılmamalı, paylaşılmamalı ya da aşılmaya çalışılmamalıdır.', 'Hizmetin çalışmasını bozacak otomatik veya zararlı kullanım yapılmamalıdır.'] },
      { title: 'Sistem güvenliği', paragraphs: ['Veli Randevu rol, okul üyeliği ve sunucu tarafı doğrulamalarla erişimi sınırlar. Kullanıcılar güvenlik açığı şüphesini kötüye kullanmadan uygun destek kanalı üzerinden bildirmelidir.'] },
      { title: 'Bakım, güncellemeler ve teknik kesintiler', paragraphs: ['Güvenlik, performans veya işlev geliştirmeleri için bakım ve güncellemeler yapılabilir. Planlı veya beklenmeyen teknik kesintilerde bazı özellikler geçici olarak kullanılamayabilir; kritik okul süreçleri için kurumun mevcut alternatif prosedürleri izlenmelidir.'] },
      { title: 'Destek', paragraphs: ['Genel iletişim ve yıllık lisans talepleri public iletişim formundan; okul kapsamındaki teknik destek talepleri okul yöneticisinin Destek / Lisans alanından iletilebilir.'] },
      { title: 'Fikri mülkiyet', paragraphs: ['Uygulamanın yazılımı, görsel kimliği ve içerikleri üzerindeki hakların kapsamı nihai hukuki metinde açıklanacaktır. Kullanım hakkı, kullanıcıya yazılımı kopyalama veya yetkisiz biçimde dağıtma hakkı vermez.'] },
      { title: 'Okul lisansı sona erdiğinde erişim', paragraphs: ['Okul özelliklerine erişim aktif lisans durumuna bağlı olabilir. Lisans sona erdiğinde erişim sınırlandırılabilir; yenileme, veri erişimi ve kapanış süreçlerinin ayrıntıları operasyon ve hukuk doğrulaması sonrası kesinleştirilecektir.'] },
      { title: 'Kişisel veri belgeleri', paragraphs: ['Kişisel verilerin kullanımına ilişkin taslak açıklamalar için KVKK Aydınlatma Metinleri, Gizlilik Politikası ve Veri Saklama ve Silme Bilgilendirmesi sayfalarını inceleyin.'] },
    ],
  },
  'veri-saklama-silme': {
    eyebrow: 'GİZLİLİK VE YASAL',
    title: 'Veri Saklama ve Silme Bilgilendirmesi',
    description: 'Uygulamadaki veri grupları için saklama ve silme yaklaşımına ilişkin taslak bilgilendirme.',
    sections: [
      { title: 'Taslak bilgilendirme', paragraphs: [legalDraftNotice] },
      { title: 'Genel saklama ilkesi', paragraphs: ['Veriler yalnızca hizmetin yürütülmesi, güvenlik, operasyon ve uygulanabilir hukuki yükümlülüklerin gerektirdiği süre boyunca saklanmalıdır. Kesin süreler veri envanteri ve hukuk/operasyon doğrulaması sonrasında kesinleştirilecektir.'] },
      { title: 'Hesap verileri', paragraphs: ['Telefon, e-posta, ad soyad, parola özeti ve hesap güvenliğiyle ilgili kayıtlar hesabın oluşturulması, doğrulanması, kullanılması ve korunması için işlenir. Kullanıcı uygulama içinden hesabını sildiğinde bu kimlik ve giriş verileri kalıcı olarak kaldırılır.'] },
      { title: 'Okul üyelik ve yetkilendirme verileri', paragraphs: ['Okul üyeliği, rol ve lisans ilişkileri kullanıcının hangi okul ve özelliklere erişebileceğini belirler. Eski veya pasif ilişkilerin ne kadar süre tutulacağı operasyonel ihtiyaçlar ve hukuki yükümlülükler doğrulandıktan sonra belirlenecektir.'] },
      { title: 'Öğrenci-veli ilişki kayıtları', paragraphs: ['Öğrenci ve veli kayıtları hesap doğrulama, yetkili erişim ve randevu süreçleri için okul kapsamında kullanılır. Bu kayıtların silinmesi, bağlı hesap ve randevu ilişkileri dikkate alınarak yetkili süreçlerle yürütülmelidir.'] },
      { title: 'Randevu kayıtları', paragraphs: ['Randevu tarihi, saati, tarafları, durumu ve ilgili işlem bilgileri randevu akışının yürütülmesi ve güvenli biçimde izlenmesi için tutulur. Kesin saklama süresi henüz belirlenmemiştir.'] },
      { title: 'Güvenlik ve QR doğrulama kayıtları', paragraphs: ['QR doğrulama ve giriş işlemleri, okul giriş sürecinin güvenliği ve işlem izlenebilirliği amacıyla kayda konu olabilir. Bu kayıtların kapsamı ve saklama süresi hukuk ve operasyon doğrulamasıyla kesinleştirilecektir.'] },
      { title: 'Destek talepleri', paragraphs: ['İletişim, lisans ve teknik destek taleplerinde okul, yetkili, e-posta, telefon, mesaj, durum ve işlem bilgileri talebin değerlendirilmesi için tutulur. Eski talep kayıtlarının saklama ve silme kuralları ayrıca kesinleştirilecektir.'] },
      { title: 'İşlem kayıtları ve e-posta süreçleri', paragraphs: ['Güvenlik ve denetim amacıyla işlem kayıtları; aktivasyon, parola sıfırlama, randevu ve destek süreçlerinde ise e-posta gönderim bilgileri oluşabilir. Bu kayıtların kesin saklama süreleri veri envanteri tamamlandıktan sonra belirlenecektir.'] },
      { title: 'Silme ve anonimleştirme yaklaşımı', paragraphs: ['Kullanıcı, sağ üstteki Hesabım menüsünde “Hesap ve gizlilik” altında bulunan “Hesabımı sil” işlemini doğrudan başlatır. Parolalı hesapta mevcut parola, parolasız hesapta işleme özel WhatsApp kodu ve açık onay metni doğrulandıktan sonra hesap kimliği, giriş verileri, üyelikler, push cihaz kayıtları ve kişisel içerikler aynı sunucu işlemi içinde silinir. Veli hesabının silinmesi okulun öğrenci kaydını silmez. Zorunlu kurumsal randevu, işlem ve güvenlik kayıtları korunuyorsa ad, telefon, e-posta ve eski kullanıcı bağlantısı kaldırılarak “Silinmiş Kullanıcı” biçiminde anonimleştirilir. İşlem başarısız olursa veri değişmez ve oturum açık kalır.'] },
    ],
  },
} satisfies Record<string, HelpGuide>;

export type HelpGuideSlug = keyof typeof helpGuides;

export interface HelpCategory {
  id: 'usage' | 'account' | 'legal' | 'support';
  title: string;
  description: string;
  icon: 'book' | 'shield' | 'file' | 'support';
  items: { slug?: HelpGuideSlug; path?: string; title: string; description: string }[];
}

export const helpCategories: HelpCategory[] = [
  {
    id: 'usage',
    title: 'Nasıl Kullanılır?',
    description: 'Rolünüze özel adım adım kullanım rehberleri.',
    icon: 'book',
    items: [
      { slug: 'okul-yoneticisi', title: 'Kurum / Okul Yöneticisi', description: 'Personel, öğrenci-veli kayıtları, ayarlar ve okul talepleri.' },
      { slug: 'ogretmen', title: 'Personel / Öğretmen', description: 'Aktivasyon, müsaitlik ve randevu taleplerinin yönetimi.' },
      { slug: 'veli', title: 'Veli', description: 'Hesap oluşturma, öğretmen seçimi, randevu ve QR giriş kartı.' },
      { slug: 'guvenlik', title: 'Güvenlik', description: 'Kamera ile QR tarama ve giriş sonuçlarının anlamı.' },
    ],
  },
  {
    id: 'account',
    title: 'Hesap ve Güvenlik',
    description: 'İlk giriş, parola işlemleri ve güvenli kullanım.',
    icon: 'shield',
    items: [
      { slug: 'ilk-giris', title: 'İlk giriş ve hesap aktivasyonu', description: 'Veli, personel ve okul yöneticisi için farklı ilk giriş yolları.' },
      { slug: 'parolami-unuttum', title: 'Parolamı unuttum', description: 'Hesap türünüze uygun güvenli parola sıfırlama adımları.' },
      { slug: 'hesap-guvenligi', title: 'Hesap güvenliği', description: 'Parola, tek kullanımlık kod ve ortak cihaz güvenliği.' },
      { slug: 'hesap-silme', title: 'Hesabımı silme', description: 'Uygulama içinden kalıcı silme, doğrulama ve anonimleştirme.' },
    ],
  },
  {
    id: 'legal',
    title: 'Gizlilik ve Yasal',
    description: 'Doğrulanmış belgeler için hazırlanmış bilgi alanları.',
    icon: 'file',
    items: [
      { slug: 'kvkk-aydinlatma', title: 'KVKK Aydınlatma Metinleri', description: 'Rollere göre mevcut veri süreçlerine ilişkin taslak bilgilendirme.' },
      { slug: 'gizlilik-politikasi', title: 'Gizlilik Politikası', description: 'Uygulamanın doğrulanmış teknik veri akışlarına ilişkin taslak.' },
      { slug: 'kullanim-kosullari', title: 'Kullanım Koşulları', description: 'Güvenli ve amacına uygun kullanıma ilişkin taslak koşullar.' },
      { slug: 'veri-saklama-silme', title: 'Veri Saklama ve Silme Bilgilendirmesi', description: 'Veri grupları, saklama ilkesi ve kesinleştirilecek süreçler.' },
    ],
  },
  {
    id: 'support',
    title: 'Destek',
    description: 'Mevcut ve gerçek destek kanallarına ulaşın.',
    icon: 'support',
    items: [
      { path: PUBLIC_CONTACT_PATH, title: 'İletişim ve destek', description: 'Genel iletişim veya yıllık lisans talebinizi güvenli formdan iletin.' },
    ],
  },
];

export function getHelpGuide(slug: string | null): HelpGuide | null {
  if (!slug || !(slug in helpGuides)) return null;
  return helpGuides[slug as HelpGuideSlug];
}

# Set Günlüğü

React Native, Expo ve TypeScript ile geliştirilen bir workout tracker uygulaması.

## Çalıştırma

Gerekenler:

- Node.js LTS
- Telefonda Expo Go veya bilgisayarda iOS/Android simülatörü

Projeyi başlat:

```bash
npm start
```

Terminalde QR kod göründüğünde telefonundaki Expo Go ile okutabilirsin. Bilgisayarda web sürümünü açmak için `w`, iOS simülatörü için `i`, Android emülatörü için `a` tuşuna bas.

## İlk klasör yapısı

```text
app/
  _layout.tsx          # Uygulamanın ana navigasyon çerçevesi
  (tabs)/              # Alt menüde görünen ekranlar
    _layout.tsx        # Alt menünün ayarları
    index.tsx          # Ana Sayfa
    programs.tsx       # Programlar
    history.tsx        # Geçmiş
    profile.tsx        # Profil
  program/
    create.tsx         # Yeni program oluşturma ekranı
    [id].tsx            # Seçilen programın detay ekranı
    [id]/day/[dayId]/
      add-exercise.tsx  # Bir antrenman gününe egzersiz ekleme
```

Expo Router'da `app` klasöründeki her ekran dosyası bir sayfadır. `_layout.tsx` dosyaları ise bu sayfaların nasıl gezileceğini belirler.

## Şu anda çalışanlar

- Dört sekmeli temel navigasyon
- İlk çalışan ana ekran
- Programlar, geçmiş ve profil için başlangıç ekranları
- Program adı ve antrenman günlerini alan form
- Oluşturulan programları ekranlar arasında paylaşan React Context yapısı
- Programları listeleyen ve antrenman günlerini gösteren Programlar ekranı
- Göğüs, sırt, omuz, kol, bacak, core, tüm vücut ve kardiyo kategorilerini içeren geniş egzersiz kataloğu
- Egzersiz adına, kas grubuna veya ekipmana göre arama
- Katalogdan seçim yapmadan kullanıcının kendi egzersiz adını ekleyebilmesi
- Program günlerine hedef set, tekrar ve dinlenme süresiyle egzersiz ekleme
- Program detayında egzersizleri görüntüleme ve kaldırma
- Egzersizleri tutup sürükleyerek istenen sıraya yerleştirme
- Program ve gün adlarını sonradan düzenleme
- Farklı günlerde aynı antrenman gün adını kullanabilme (örneğin haftada iki Push Day)
- Antrenman günlerini Yukarı/Aşağı kontrolleriyle yeniden sıralama
- Programlar ve günler için 24 ikon, sayı/emoji veya galeri fotoğrafı seçme
- Program detayından bir güne girerek yalnızca o günün egzersizlerini görüntüleme
- Egzersizler için ikon, sayı/emoji veya galeri fotoğrafı seçme ve sonradan değiştirme
- Gün ekranında egzersiz başına tamamlanan set sayacı ve toplam ilerleme çubuğu
- Antrenmanı başlatma, durdurma, devam ettirme ve bitirme akışı
- Duraklatıldığında duran, devam edildiğinde kaldığı yerden süren antrenman kronometresi
- Tamamlanan antrenman sürelerini Geçmiş ekranında görüntüleme
- Set tamamlandıktan sonra egzersizin dinlenme süresine göre çalışan mola sayacı ve yerel bildirim
- Egzersiz set/tekrar/dinlenme, görsel, sıra ve silme kontrollerini program detayından yönetme
- Program günlerini gerçek Pazartesi-Pazar takvimine bağlama
- Program günlerini Off day olarak işaretleme
- Set ilerlemesinden otomatik yeşil, turuncu veya gri disiplin durumu hesaplama
- Off day geldiğinde disiplin takvimini otomatik yeşil işaretleme
- Birden fazla program arasından takvim ve seri hesabında kullanılacak aktif programı seçme
- Aktif programın takvim otomasyonunu yalnızca etkinleştirildiği tarihten itibaren uygulama
- Galeriden profil fotoğrafı seçme, değiştirme ve kaldırma
- Ana sayfada hafta, ay ve yıl arasında geçiş yapılabilen disiplin takvimi
- Tamamlandı, eksik tamamlandı ve atlandı durumlarını renkle işaretleme
- Ad, kullanıcı adı, biyografi ve antrenman hedefi düzenlenebilen profil
- Güneş, telefon ve ay simgeli küçük görünüm seçiciyle açık, sistem ve koyu tema seçenekleri
- Profil ekranından mola sayacını açma veya kapatma
- Supabase bağlantısı ve cihazda saklanan kullanıcı oturumu
- E-posta ve şifreyle hesap oluşturma, giriş yapma ve çıkış yapma
- Oturum durumuna göre korunan uygulama ekranları

Programlar, program günleri, egzersiz hedefleri ve aktif program seçimi Supabase hesabında kalıcı olarak saklanır. Galeriden seçilen fotoğraflar henüz Supabase Storage'a yüklenmediği için yalnızca seçildikleri cihazda görüntülenebilir.

Disiplin takvimindeki planlı program günleri tamamlanan setlerden otomatik hesaplanır. Plansız günler kutulara dokunularak elle işaretlenebilir.

Profil metinleri, antrenman hedefi, mola sayacı ayarı, program yapısı, antrenman süreleri, tamamlanan setler ve elle işaretlenen disiplin günleri Supabase hesabında saklanır. Tema seçimi, aktif mola sayacı ve henüz Storage'a yüklenmeyen yerel fotoğraflar cihazda kalıcı olarak tutulur.

Tema, Profil ekranındaki Görünüm bölümünden değiştirilebilir. `Sistem` seçeneği telefonun açık/koyu tema ayarını otomatik takip eder. Seçilen görünüm cihazda saklanır ve uygulama yeniden açıldığında korunur.

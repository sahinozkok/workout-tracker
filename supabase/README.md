# Supabase veritabanı

Migration dosyaları `migrations/` klasöründe tarih sırasıyla tutulur. Bu dosyalar veritabanının
hangi tablolar ve güvenlik kurallarıyla oluşturulduğunun Git geçmişidir.

## İlk migration'ı Dashboard üzerinden çalıştırma

1. Supabase Dashboard'da projeyi aç.
2. Sol menüden **SQL Editor** bölümüne gir.
3. **New query** seç.
4. `migrations/20260803195000_initial_schema.sql` dosyasının tamamını kopyala.
5. SQL Editor'a yapıştır ve **Run** düğmesine bas.
6. Başarı mesajından sonra **Table Editor** bölümünde tabloları kontrol et.

Beklenen tablolar:

- `profiles`
- `programs`
- `program_days`
- `program_exercises`
- `workout_sessions`
- `workout_sets`
- `manual_discipline_statuses`

Migration dosyalarını dosya adındaki tarih sırasına göre ve yalnızca birer defa çalıştır. Yeni bir
değişiklik gerektiğinde yeni tarihli migration dosyası oluşturulur; daha önce çalıştırılan migration
dosyası değiştirilmez.

## Profil fotoğrafları

Profil fotoğraflarının web ve telefon arasında görünmesi için
`migrations/20260805093000_add_avatar_storage.sql` dosyasını Supabase SQL Editor'da bir kez çalıştır.
Bu migration, `avatars` Storage alanını ve kullanıcıların yalnızca kendi fotoğraflarını
değiştirebilmesini sağlayan güvenlik kurallarını oluşturur.

## Güvenlik

Tüm uygulama tablolarında Row Level Security (RLS) açıktır. `anon` rolünün tablo erişimi kapalıdır.
Giriş yapan kullanıcılar yalnızca kendi satırlarını okuyabilir ve değiştirebilir.

`service_role` veya database password mobil uygulamaya ve `.env` dosyasına eklenmemelidir.

## Gemini AI Koç kurulumu

Uygulama Gemini anahtarını doğrudan telefonda tutmaz. Akış şu şekildedir:

```text
Giriş yapmış kullanıcı
        ↓
Supabase Edge Function (kullanıcıyı doğrular)
        ↓
Kullanıcının kendi antrenman kayıtlarını RLS ile okur
        ↓
Gemini API
        ↓
Biçimi doğrulanan Türkçe koç yorumu
```

### 1. AI kullanım tablosunu oluştur

Supabase Dashboard içindeki **SQL Editor** bölümünde
`migrations/20260805153000_add_ai_requests.sql` dosyasını bir kez çalıştır. Bu tablo kullanıcı başına
günlük istek sınırı ve token kullanım kaydı için kullanılır.

### 2. Gemini anahtarı oluştur

Google AI Studio üzerinden bir Gemini API anahtarı oluştur. Anahtarı Expo `.env` dosyasına veya
GitHub'a koyma.

Supabase Dashboard içinde **Edge Functions → Secrets** bölümüne şu değerleri ekle:

```text
GEMINI_API_KEY=Google AI Studio anahtarın
GEMINI_MODEL=gemini-3.6-flash
AI_DAILY_LIMIT=10
```

`GEMINI_MODEL` ve `AI_DAILY_LIMIT` isteğe bağlıdır; yazılmazsa uygulama aynı varsayılan değerleri
kullanır.

### 3. Edge Function'ı yayınla

Supabase CLI ile giriş yapıp projeyi bağladıktan sonra:

```bash
npx supabase login
npx supabase link --project-ref PROJE_KODUN
npx supabase functions deploy workout-coach
```

Fonksiyon dosyası `functions/workout-coach/index.ts` konumundadır. Dashboard'daki eski
**Verify JWT with legacy secret** ayarı kapalıdır. Kimlik doğrulaması fonksiyonun içinde
`withSupabase({ auth: 'user' })` ile yapılır; giriş yapmamış istekler reddedilir.

### 4. Uygulamada gerçek AI'ı aç

Fonksiyon başarıyla yayınlandıktan sonra Expo `.env` dosyasına yalnızca şu güvenli ayarı ekle:

```text
EXPO_PUBLIC_AI_PROVIDER=gemini
```

Ardından Expo'yu önbelleği temizleyerek yeniden başlat. Bu ayar yalnızca sağlayıcı seçer; Gemini API
anahtarını içermez. Kurulum tamamlanana kadar değer `mock` olarak kalabilir.

### Koruma önlemleri

- Edge Function yalnızca giriş yapmış kullanıcılar tarafından çağrılabilir.
- Metrikler telefondan kabul edilmez; kullanıcının Supabase kayıtlarından sunucuda yeniden hesaplanır.
- Model yanıtı tanımlı JSON biçimine göre doğrulanır.
- Varsayılan sınır kullanıcı başına son 24 saatte 10 başarılı AI isteğidir.
- AI yalnızca antrenman verilerini açıklar; tıbbi teşhis veya sakatlık tedavisi sunmaz.

/**
 * KARDİYO GİRDİ AYRIŞTIRMA — saf, test edilebilir katman.
 *
 * Arayüz kilometre ve dakika konuşur; veritabanı YALNIZCA tam sayı metre ve tam
 * sayı saniye kabul eder. Dönüşüm burada TEK noktada yapılır ve hiçbir yolda
 * kayan noktalı bir değer veritabanına gönderilmez.
 *
 * Sınırlar canlı şemadaki CHECK kısıtlarıyla birebir aynıdır; istemci aynı
 * kuralı önce uygular ki kullanıcı anlaşılmaz bir Postgres hatasıyla
 * karşılaşmasın.
 */

/** `workout_activity_records.duration_seconds between 1 and 86400` */
export const ACTIVITY_DURATION_SECONDS_MIN = 1;
export const ACTIVITY_DURATION_SECONDS_MAX = 86400;

/** `workout_activity_records.distance_meters between 1 and 500000` */
export const ACTIVITY_DISTANCE_METERS_MIN = 1;
export const ACTIVITY_DISTANCE_METERS_MAX = 500000;

/** `program_exercises.target_duration_seconds between 10 and 86400` */
export const TARGET_DURATION_SECONDS_MIN = 10;
export const TARGET_DURATION_SECONDS_MAX = 86400;

/** `program_exercises.target_distance_meters between 10 and 500000` */
export const TARGET_DISTANCE_METERS_MIN = 10;
export const TARGET_DISTANCE_METERS_MAX = 500000;

/** `workout_activity_records.rpe numeric(3,1) between 0 and 10` */
export const RPE_MIN = 0;
export const RPE_MAX = 10;

/**
 * Ayrıştırma hatası nedeni. Ekran her nedene ayrı bir lokalize metin bağlar;
 * ham `Error` mesajı kullanıcıya asla gösterilmez.
 */
export type ActivityInputError = 'empty' | 'invalid' | 'range';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: ActivityInputError };

const ok = <T,>(value: T): ParseResult<T> => ({ ok: true, value });
const fail = <T,>(reason: ActivityInputError): ParseResult<T> => ({ ok: false, reason });

/**
 * Ondalık girdiyi NORMALLEŞTİRİR. Virgül ve nokta ayırıcı olarak kabul edilir.
 *
 * İşaret KABUL EDİLMEZ: negatif değerler bu aşamada `invalid` olur, sınır
 * kontrolüne hiç ulaşmaz. `1e3`, `5.5.5`, `abc`, ` ` gibi girdiler de reddedilir
 * — `Number()`'ın sessiz kabullerine (boş dize → 0, `Infinity`) güvenilmez.
 */
function normalizeDecimal(raw: string): string | undefined {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed.length === 0) return undefined;
  return /^\d+(\.\d+)?$/.test(trimmed) ? trimmed : undefined;
}

/**
 * Kilometreyi TAM SAYI metreye çevirir.
 *
 * Dönüşüm kayan noktalı çarpma ile DEĞİL, dize üzerinden tam sayı aritmetiğiyle
 * yapılır: `0.1 * 1000` gibi ifadeler ikili gösterimde 100.00000000000001
 * üretir ve doğrudan veritabanına gönderilirse kolon tipini ihlal eder.
 * Metre altı basamaklar yarı-yukarı yuvarlanır.
 */
function kilometersToMeters(normalized: string): number {
  const [whole, fraction = ''] = normalized.split('.');
  const digits = `${fraction}0000`.slice(0, 4);
  const scaled = Number(`${whole}${digits.slice(0, 3)}`);
  return Number(digits[3]) >= 5 ? scaled + 1 : scaled;
}

function inRange(value: number, min: number, max: number) {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Kilometre girdisi → zorunlu tam sayı metre. */
export function parseKilometersToMeters(
  raw: string,
  bounds: { min: number; max: number },
): ParseResult<number> {
  const normalized = normalizeDecimal(raw);
  if (raw.trim().length === 0) return fail('empty');
  if (normalized === undefined) return fail('invalid');

  const meters = kilometersToMeters(normalized);
  if (!inRange(meters, bounds.min, bounds.max)) return fail('range');
  return ok(meters);
}

/** Kilometre girdisi → İSTEĞE BAĞLI metre. Boş girdi geçerlidir. */
export function parseOptionalKilometersToMeters(
  raw: string,
  bounds: { min: number; max: number },
): ParseResult<number | undefined> {
  if (raw.trim().length === 0) return ok(undefined);
  return parseKilometersToMeters(raw, bounds);
}

/** Tam sayı girdisi. Ondalık, işaret ve boşluk reddedilir. */
function parseInteger(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || !/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * Dakika + saniye → tam sayı saniye.
 *
 * Saniye alanı boş bırakılabilir (0 sayılır) ama doluysa 0–59 olmalıdır;
 * "90 saniye" yazımı sessizce 1 dk 30 sn'ye çevrilmez, açıkça reddedilir.
 */
export function parseMinutesSecondsToSeconds(
  minutesRaw: string,
  secondsRaw: string,
  bounds: { min: number; max: number },
): ParseResult<number> {
  const minutesEmpty = minutesRaw.trim().length === 0;
  const secondsEmpty = secondsRaw.trim().length === 0;
  if (minutesEmpty && secondsEmpty) return fail('empty');

  const minutes = minutesEmpty ? 0 : parseInteger(minutesRaw);
  const seconds = secondsEmpty ? 0 : parseInteger(secondsRaw);
  if (minutes === undefined || seconds === undefined) return fail('invalid');
  if (seconds > 59) return fail('invalid');

  const total = minutes * 60 + seconds;
  if (!inRange(total, bounds.min, bounds.max)) return fail('range');
  return ok(total);
}

/** Dakika girdisi → tam sayı saniye. Program hedefi bu biçimi kullanır. */
export function parseMinutesToSeconds(
  raw: string,
  bounds: { min: number; max: number },
): ParseResult<number> {
  if (raw.trim().length === 0) return fail('empty');
  const minutes = parseInteger(raw);
  if (minutes === undefined) return fail('invalid');

  const total = minutes * 60;
  if (!inRange(total, bounds.min, bounds.max)) return fail('range');
  return ok(total);
}

/**
 * RPE — İSTEĞE BAĞLI, 0–10, tek ondalık.
 *
 * Kolon `numeric(3,1)` olduğu için 7.25 gibi değerler sunucuda sessizce
 * yuvarlanırdı; istemci bunu kabul etmez ve `invalid` döner.
 */
export function parseOptionalRpe(raw: string): ParseResult<number | undefined> {
  if (raw.trim().length === 0) return ok(undefined);

  const normalized = normalizeDecimal(raw);
  if (normalized === undefined) return fail('invalid');

  const [, fraction = ''] = normalized.split('.');
  if (fraction.length > 1) return fail('invalid');

  const value = Number(normalized);
  if (!Number.isFinite(value)) return fail('invalid');
  if (value < RPE_MIN || value > RPE_MAX) return fail('range');
  return ok(value);
}

/**
 * RPE (algılanan zorluk) SINIFLANDIRMASI — TEK doğruluk kaynağı.
 *
 * Active Workout (strength + kardiyo) ve History AYNI bantları buradan okur;
 * hiçbir ekran bu eşikleri kopyalamaz. Yalnızca sayısal bandı döndürür; görünen
 * metin locale katmanında (`rpe.bands.*`) çözülür — çekirdek dilden bağımsız
 * kalır ve saftır.
 *
 * Bantlar (üst sınır dahil):
 *   0           → rest
 *   0 < v ≤ 2   → veryEasy
 *   2 < v ≤ 4   → easy
 *   4 < v ≤ 6   → moderate
 *   6 < v ≤ 8   → hard
 *   8 < v ≤ 9   → veryHard
 *   9 < v ≤ 10  → max
 */
export type RpeBand = 'rest' | 'veryEasy' | 'easy' | 'moderate' | 'hard' | 'veryHard' | 'max';

export function classifyRpe(value: number): RpeBand | undefined {
  if (!Number.isFinite(value) || value < RPE_MIN || value > RPE_MAX) return undefined;
  if (value === 0) return 'rest';
  if (value <= 2) return 'veryEasy';
  if (value <= 4) return 'easy';
  if (value <= 6) return 'moderate';
  if (value <= 8) return 'hard';
  if (value <= 9) return 'veryHard';
  return 'max';
}

/**
 * Ham girdiden CANLI bant. Mevcut `parseOptionalRpe` validasyonunu AYNEN
 * kullanır: boş ya da geçersiz değer açıklama üretmez (`undefined` döner),
 * kayıt/validasyon davranışı değişmez.
 */
export function describeRpeInput(raw: string): RpeBand | undefined {
  const parsed = parseOptionalRpe(raw);
  if (!parsed.ok || parsed.value === undefined) return undefined;
  return classifyRpe(parsed.value);
}

/** Bant → locale anahtarı. Etiket eşlemesi de tek yerde yaşar. */
export function rpeBandLabelKey(band: RpeBand): string {
  return `rpe.bands.${band}`;
}

/**
 * Kayıtlı bir RPE değerini `8 · Zor` biçiminde yazar — History ve tamamlanmış
 * set listesinin ORTAK biçimi. `translate` ve `locale` dışarıdan verilir;
 * fonksiyon saf kalır ve sınıflandırmayı `classifyRpe` üzerinden yapar.
 * Bant çözülemezse yalnız sayı döner (eski `—`/gizleme davranışı çağıranda).
 */
export function formatRpeWithBand(
  value: number,
  translate: (key: string) => string,
  locale: string,
): string {
  const formatted = value.toLocaleString(locale, { maximumFractionDigits: 2 });
  const band = classifyRpe(value);
  return band ? `${formatted} · ${translate(rpeBandLabelKey(band))}` : formatted;
}

/** Metre → kilometre metni. Girdi alanlarını mevcut kayıtla doldurmak için. */
export function formatMetersAsKilometers(meters: number): string {
  const whole = Math.trunc(meters / 1000);
  const remainder = meters % 1000;
  if (remainder === 0) return String(whole);
  return `${whole}.${String(remainder).padStart(3, '0').replace(/0+$/, '')}`;
}

/** Saniye → `{ minutes, seconds }` metinleri. */
export function splitSecondsIntoFields(totalSeconds: number) {
  return {
    minutes: String(Math.trunc(totalSeconds / 60)),
    seconds: String(totalSeconds % 60),
  };
}

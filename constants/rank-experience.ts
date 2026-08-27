/**
 * RANK DENEYİMİ — SAF KARARLAR (RP geçmişi + rank yükselme)
 *
 * Bu dosya `constants/ranks.ts` ile AYNI duruşu izler: **hiçbir `import`u
 * YOKTUR**. Harness (`.mjs`) modülü tek başına `tsc` ile derleyip
 * çalıştırabilsin diye bilinçli böyledir; buraya tema, çeviri, React veya
 * `@/` alias'lı bir bağımlılık eklenmemelidir. Rank sıralaması bu yüzden
 * yeniden tanımlanmaz, çağıran taraftan `order` olarak GEÇİRİLİR — eşikler ve
 * tier listesi tek kaynakta (`constants/ranks.ts`) kalır.
 *
 * KAPSAM — burada RP veya rank HESAPLANMAZ. Sunucu tek otoritedir; bu
 * fonksiyonlar yalnızca "sunucudan gelen değeri nasıl gösterelim" ve
 * "kutlamayı oynatalım mı" sorularını yanıtlar.
 */

// ---------------------------------------------------------------------------
// 1) RP hareket geçmişi — satır eşlemesi
// ---------------------------------------------------------------------------

/**
 * Sunucudaki `rank_events.event_type` CHECK kısıtıyla BİREBİR aynı liste.
 * Yeni bir tür eklenirse burası da güncellenmeli; tanınmayan tür ekrana hiç
 * çıkmaz (bkz. `parseRankEventKind`).
 */
export const RANK_EVENT_KINDS = [
  'scheduled_day',
  'unscheduled_workout',
  'weekly_perfect',
  'streak_milestone',
] as const;

export type RankEventKind = (typeof RANK_EVENT_KINDS)[number];

/**
 * Sunucudan gelen ham `event_type` değerini güvenle daraltır.
 *
 * Sunucu ileride yeni bir tür eklerse eski istemci çökmez ve kullanıcıya ham
 * anahtar GÖSTERMEZ: satır sessizce listeden düşer.
 */
export function parseRankEventKind(value: unknown): RankEventKind | undefined {
  return RANK_EVENT_KINDS.includes(value as RankEventKind) ? (value as RankEventKind) : undefined;
}

/** Kullanıcıya gösterilecek etkinlik adının çeviri anahtarı (son parça). */
export type RankEventLabelKey =
  | 'scheduledComplete'
  | 'scheduledPartial'
  | 'scheduledDay'
  | 'unscheduledWorkout'
  | 'weeklyPerfect'
  | 'streakMilestone';

/**
 * Etkinlik türü → kullanıcı metninin anahtarı.
 *
 * `dayState` YALNIZCA `scheduled_day` için okunur ve yalnızca sunucunun
 * gerçekten yazdığı iki değeri (`completed` / `partial`) tanır. Başka bir
 * metadata alanı (UUID, `desired_rp`, `written_rp`, `source_key`) kullanıcı
 * metnine HİÇBİR koşulda dönüşmez; bilinmeyen durum genel etikete düşer.
 *
 * Negatif (telafi) satırları da AYNI adı taşır: ad etkinliğin ne olduğunu
 * söyler, işaretin anlamını RP değeri ve ayrı bir açıklama satırı taşır.
 * Böylece kodda bulunmayan bir sebep uydurulmaz.
 */
export function resolveRankEventLabel(
  kind: RankEventKind,
  dayState?: string | null,
): RankEventLabelKey {
  if (kind === 'unscheduled_workout') return 'unscheduledWorkout';
  if (kind === 'weekly_perfect') return 'weeklyPerfect';
  if (kind === 'streak_milestone') return 'streakMilestone';
  if (dayState === 'completed') return 'scheduledComplete';
  if (dayState === 'partial') return 'scheduledPartial';
  return 'scheduledDay';
}

/** `+25 RP` / `-25 RP` gösterimi için işaret ve mutlak değer. */
export type RankRpDisplay = {
  isPositive: boolean;
  /** Her zaman pozitif tam sayı; işaret çeviri metninde durur. */
  amount: number;
};

/**
 * RP değişimini gösterime hazırlar.
 *
 * 0 pratikte deftere hiç yazılmaz (`record_rank_event` 0'ı reddeder), ama
 * bozuk/eski bir satır gelirse pozitif kabul edilir ve ekran çökmez.
 */
export function toRankRpDisplay(rpDelta: number): RankRpDisplay {
  const safeDelta = Number.isFinite(rpDelta) ? Math.trunc(rpDelta) : 0;
  return { amount: Math.abs(safeDelta), isPositive: safeDelta >= 0 };
}

/** Ekranda gösterilecek en fazla RP hareketi. Liste bilinçli olarak kısadır. */
export const RANK_EVENT_LIMIT = 30;

// ---------------------------------------------------------------------------
// 2) Rank yükselme kutlaması — kararın TEK yeri
// ---------------------------------------------------------------------------

/**
 * Kullanıcının bu sezon için en son ONAYLADIĞI rank.
 *
 * AsyncStorage'da yalnızca bu saklanır. RP veya rank BURADA HESAPLANMAZ;
 * kayıt sadece "hangi yükseliş zaten gösterildi" sorusunu yanıtlar. Sunucudan
 * gelen değer her zaman otoritedir.
 */
export type RankCelebrationBaseline<Rank extends string> = {
  seasonIndex: number;
  rank: Rank;
};

/** Sunucudan gelen güncel sezon durumunun kutlama için gereken parçası. */
export type RankCelebrationSnapshot<Rank extends string> = {
  seasonIndex: number;
  currentRank: Rank;
};

/**
 * Kararlar:
 *   * `seed`     — ilk yükleme veya YENİ SEZON. Kutlama YOK, referans yazılır.
 *   * `settle`   — rank düştü. Kutlama YOK, referans sessizce güncellenir.
 *   * `celebrate`— aynı sezonda gerçek yükseliş. Referans yeni ranka taşınır.
 *   * `idle`     — değişiklik yok; hiçbir şey yazılmaz.
 *
 * `seed`, `settle` ve `celebrate` kararlarının hepsi `baseline` taşır: çağıran
 * taraf tek bir yolda kalıcılaştırır, "hangi durumda yazılır" dağılmaz.
 */
export type RankCelebrationDecision<Rank extends string> =
  | { type: 'seed'; baseline: RankCelebrationBaseline<Rank> }
  | { type: 'settle'; baseline: RankCelebrationBaseline<Rank> }
  | { type: 'celebrate'; baseline: RankCelebrationBaseline<Rank>; fromRank: Rank; toRank: Rank }
  | { type: 'idle' };

/**
 * Kutlama kararı.
 *
 * DEĞİŞMEZLER
 *  - İlk kez görülen rank kutlanmaz; başlangıç değeri olarak yazılır.
 *  - Sezon değişimi (soft reset dâhil) yükselme SAYILMAZ: farklı sezon numarası
 *    yeni bir referans anlamına gelir, karşılaştırma yapılmaz.
 *  - Düşüşte kutlama yoktur, referans sessizce iner.
 *  - Çoklu atlayışta yalnızca başlangıç ve ulaşılan son rank döner; henüz
 *    gösterilmemiş bir kutlama varsa (`pendingFromRank`) BAŞLANGICI korunur.
 *  - Tanınmayan rank kimliği hiçbir şey tetiklemez/bozmaz.
 */
export function decideRankCelebration<Rank extends string>(input: {
  order: readonly Rank[];
  season: RankCelebrationSnapshot<Rank>;
  baseline?: RankCelebrationBaseline<Rank>;
  pendingFromRank?: Rank;
}): RankCelebrationDecision<Rank> {
  const { baseline, order, pendingFromRank, season } = input;

  const currentIndex = order.indexOf(season.currentRank);
  // Bilinmeyen rank: yazma da yapılmaz, kutlama da. Sonraki geçerli değerde
  // normal akış devam eder.
  if (currentIndex < 0) return { type: 'idle' };

  const nextBaseline: RankCelebrationBaseline<Rank> = {
    rank: season.currentRank,
    seasonIndex: season.seasonIndex,
  };

  // Referans yok (ilk yükleme) veya BAŞKA bir sezona ait: sessiz başlangıç.
  if (!baseline || baseline.seasonIndex !== season.seasonIndex) {
    return { baseline: nextBaseline, type: 'seed' };
  }

  const baselineIndex = order.indexOf(baseline.rank);
  // Bozuk/eski kayıt kutlama üretmez; güvenli tarafa düşülür.
  if (baselineIndex < 0) return { baseline: nextBaseline, type: 'seed' };

  if (currentIndex < baselineIndex) return { baseline: nextBaseline, type: 'settle' };
  if (currentIndex === baselineIndex) return { type: 'idle' };

  // Bekleyen kutlamanın başlangıcı hâlâ daha düşükse korunur: kullanıcı
  // aradaki adımları değil, gerçekten nereden nereye çıktığını görür.
  const pendingIndex = pendingFromRank === undefined ? -1 : order.indexOf(pendingFromRank);
  const fromRank =
    pendingIndex >= 0 && pendingIndex < baselineIndex ? (pendingFromRank as Rank) : baseline.rank;

  return { baseline: nextBaseline, fromRank, toRank: season.currentRank, type: 'celebrate' };
}

/**
 * Kutlamanın GÖSTERİLEBİLECEĞİ ekran mı?
 *
 * Aktif antrenman ekranı (`/program/:id/day/:dayId`) ve şifre kurtarma /
 * doğrulama ekranları hariç tutulur. Aktif antrenmanda kutlama BEKLETİLİR
 * (düşürülmez): kullanıcı güvenli bir ekrana geçtiğinde bir kez gösterilir.
 *
 * Auth grubu zaten oturum guard'ıyla dışarıda kalır; buradaki kontrol ikinci
 * bir güvenlik katmanıdır ve route listesi büyüdüğünde tek noktadan yönetilir.
 */
export function canShowRankCelebration(pathname: string | null | undefined): boolean {
  if (!pathname) return false;

  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  // Aktif antrenman / set giriş ekranı — kullanıcı asla bölünmez.
  if (/^\/program\/[^/]+\/day\/[^/]+$/.test(trimmed)) return false;

  // Oturum akışı ekranları.
  if (
    trimmed === '/reset-password' ||
    trimmed === '/confirm' ||
    trimmed === '/login' ||
    trimmed === '/register' ||
    trimmed === '/forgot-password'
  ) {
    return false;
  }

  return true;
}

/**
 * Kutlama onay kaydının AsyncStorage anahtarı.
 *
 * Hem kullanıcı kimliği hem sezon numarası adın içindedir: başka bir hesap
 * giriş yaptığında önceki kullanıcının kaydı okunamaz, yeni sezon da kendi
 * anahtarını kullandığı için soft reset bir "yükselme" gibi görünmez.
 */
export function rankCelebrationStorageKey(userId: string, seasonIndex: number): string {
  return `rank:celebrated:${userId}:${seasonIndex}`;
}

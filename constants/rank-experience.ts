/**
 * RANK DENEYİMİ — SAF KARARLAR
 * (RP geçmişi + rank yükselme + sezon özeti + arkadaş sıralaması +
 *  sezon başarıları + başarı kutlaması + katman sahipliği)
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

// ---------------------------------------------------------------------------
// 3) Sezon sonu özeti — tek seferlik gösterim kararı
// ---------------------------------------------------------------------------

/**
 * Özet kararının ihtiyaç duyduğu KAPANMIŞ sezon alanları.
 *
 * Bilinçli olarak dardır: karar yalnızca "gösterilebilir mi" sorusunu yanıtlar,
 * ekranda çizilen değerler sunucu arşivinin kendisinden okunur.
 */
export type SeasonRecapArchiveInput = {
  seasonIndex: number;
  finalRp: number;
  scheduledDaysTotal: number;
  scheduledDaysCompleted: number;
};

/** Gösterilecek özetin kimliği ve tek türetilmiş gösterim değeri. */
export type SeasonRecapPlan = {
  /** Özeti gösterilecek kapanmış sezon. */
  closedSeasonIndex: number;
  /** Kullanıcının şu an içinde olduğu sezon. */
  nextSeasonIndex: number;
  /**
   * Plan uyumu yüzdesi.
   *
   * Bu bir RP/rank hesabı DEĞİLDİR: sunucunun yazdığı iki sayının oranıdır ve
   * rank ekranındaki mevcut gösterimle birebir aynı formülü kullanır.
   */
  planCompletionPercent: number;
};

/** Sonlu, negatif olmayan tam sayı mı? Bozuk sunucu verisi ekranı açmamalı. */
function isSafeCount(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Sezon sonu özeti gösterilmeli mi?
 *
 * DEĞİŞMEZLER
 *  - İlk sezonda (veya arşiv yokken) özet YOKTUR.
 *  - Yalnızca **güncel sezonun hemen öncesi** kapanmış sezon özet üretir; daha
 *    eski arşivler (kullanıcı bir sezonu tamamen kaçırmışsa da) üretmez.
 *  - Sunucu verisi eksik/tutarsızsa (negatif sayı, tamamlanan > planlanan,
 *    sonsuz/NaN değer) özet ÜRETİLMEZ — istemci hiçbir değeri tahmin etmez.
 *  - Buradaki karar "gösterildi" anlamına GELMEZ; gösterim onayı ayrı bir
 *    adımdır (bkz. `seasonRecapStorageKey`).
 */
export function decideSeasonRecap(input: {
  currentSeasonIndex: number;
  /** Yeni sezona soft reset ile girilen RP. Sunucudan gelir. */
  startingRp: number;
  /** Kapanmış sezon arşivi; sıralaması önemli değildir. */
  archives: readonly SeasonRecapArchiveInput[];
}): SeasonRecapPlan | undefined {
  const { archives, currentSeasonIndex, startingRp } = input;

  if (!Number.isInteger(currentSeasonIndex) || currentSeasonIndex < 2) return undefined;
  if (!isSafeCount(startingRp)) return undefined;
  if (!archives || archives.length === 0) return undefined;

  // En yeni kapanmış sezon.
  let newest: SeasonRecapArchiveInput | undefined;
  for (const archive of archives) {
    if (!Number.isInteger(archive.seasonIndex)) continue;
    if (!newest || archive.seasonIndex > newest.seasonIndex) newest = archive;
  }

  if (!newest) return undefined;
  // Hemen önceki sezon DEĞİLSE özet gösterilmez.
  if (newest.seasonIndex !== currentSeasonIndex - 1) return undefined;

  if (!isSafeCount(newest.finalRp)) return undefined;
  if (!isSafeCount(newest.scheduledDaysTotal) || !isSafeCount(newest.scheduledDaysCompleted)) {
    return undefined;
  }
  if (newest.scheduledDaysCompleted > newest.scheduledDaysTotal) return undefined;

  const planCompletionPercent =
    newest.scheduledDaysTotal > 0
      ? Math.round((newest.scheduledDaysCompleted / newest.scheduledDaysTotal) * 100)
      : 0;

  return {
    closedSeasonIndex: newest.seasonIndex,
    nextSeasonIndex: currentSeasonIndex,
    planCompletionPercent,
  };
}

/**
 * Sezon sonu özetinin gösterim kaydının AsyncStorage anahtarı.
 *
 * Rank yükselme onayından (`rankCelebrationStorageKey`) BİLİNÇLİ olarak
 * ayrıdır: iki deneyim birbirinin kaydını okuyamaz veya bozamaz. Anahtar hem
 * kullanıcı kimliğini hem KAPANMIŞ sezon numarasını taşır, bu yüzden A
 * hesabının kaydı B'yi etkileyemez.
 */
export function seasonRecapStorageKey(userId: string, closedSeasonIndex: number): string {
  return `rank:season-recap-shown:${userId}:${closedSeasonIndex}`;
}

// ---------------------------------------------------------------------------
// 4) Arkadaş sezon sıralaması — satır eşlemesi
// ---------------------------------------------------------------------------

/**
 * `get_friends_rank_leaderboard()` RPC'sinin döndürebileceği en fazla satır.
 *
 * SQL tarafındaki `display_position <= 100` sınırıyla AYNI olmalıdır; harness
 * ikisini karşılaştırır. Aktif kullanıcının kendi satırı bu sınırdan muaftır.
 */
export const FRIEND_RANK_LEADERBOARD_LIMIT = 100;

/**
 * Sunucudan gelen HAM satır.
 *
 * Bütün alanlar `unknown`: bu eşleme katmanı sunucunun sözleşmeye uyduğunu
 * VARSAYMAZ. Bozuk/eksik satır uygulamayı çökertmez, sessizce güvenli tarafa
 * düşer.
 */
export type FriendRankLeaderboardRow = {
  participant_id?: unknown;
  display_name?: unknown;
  username?: unknown;
  avatar_url?: unknown;
  season_index?: unknown;
  current_rp?: unknown;
  current_rank?: unknown;
  rank_position?: unknown;
  is_self?: unknown;
  is_ranked?: unknown;
  participant_count?: unknown;
};

/** Eşlenmiş satır. `Rank` çağıran taraftan gelir; bu dosya import ETMEZ. */
export type FriendRankLeaderboardParsedEntry<Rank extends string> = {
  userId: string;
  /** Profil adı okunamıyorsa `undefined`; ekran çeviriden yedek metin koyar. */
  displayName?: string;
  username?: string;
  avatarUrl?: string;
  isSelf: boolean;
  /**
   * Güncel sezonda rank satırı var mı? `false` ise `currentRp`, `currentRank`
   * ve `position` alanlarının ÜÇÜ DE `undefined`dır — Bronze/0'a ZORLANMAZ.
   */
  isRanked: boolean;
  currentRp?: number;
  currentRank?: Rank;
  position?: number;
};

/** Ekranın ihtiyaç duyduğu tam yanıt. */
export type FriendRankLeaderboardParsed<Rank extends string> = {
  seasonIndex?: number;
  entries: FriendRankLeaderboardParsedEntry<Rank>[];
  /** Sunucudaki TOPLAM katılımcı sayısı (sınırdan bağımsız). */
  participantCount: number;
  /** Sınır nedeniyle bazı katılımcılar listede yok mu? */
  isTruncated: boolean;
};

function asText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Sonlu, negatif olmayan tam sayı; aksi hâlde `undefined`. */
function asCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const floored = Math.floor(value);
  return floored >= 0 ? floored : undefined;
}

/**
 * Tek satırı eşler. Katılımcı kimliği okunamıyorsa satır DÜŞER (`undefined`).
 *
 * İSTEMCİ BURADA HİÇBİR ŞEY HESAPLAMAZ: RP, rank ve sıra doğrudan sunucudan
 * gelir. `is_ranked` doğru olsa bile RP veya sıra tutarsızsa satır güvenli
 * biçimde "bu sezon sıralanmadı" durumuna düşer — uydurma değer üretilmez.
 */
export function parseFriendRankLeaderboardRow<Rank extends string>(
  row: FriendRankLeaderboardRow,
  options: { order: readonly Rank[]; fallbackRank: Rank },
): FriendRankLeaderboardParsedEntry<Rank> | undefined {
  const userId = asText(row.participant_id);
  if (!userId) return undefined;

  const currentRp = asCount(row.current_rp);
  const position = asCount(row.rank_position);
  const isRanked =
    row.is_ranked === true && currentRp !== undefined && position !== undefined && position > 0;

  const rawRank = asText(row.current_rank);
  const currentRank =
    rawRank !== undefined && options.order.includes(rawRank as Rank)
      ? (rawRank as Rank)
      : options.fallbackRank;

  return {
    avatarUrl: asText(row.avatar_url),
    // Sıralanmamış katılımcıda rank/RP/sıra HİÇ doldurulmaz.
    currentRank: isRanked ? currentRank : undefined,
    currentRp: isRanked ? currentRp : undefined,
    displayName: asText(row.display_name),
    isRanked,
    isSelf: row.is_self === true,
    position: isRanked ? position : undefined,
    userId,
    username: asText(row.username),
  };
}

/**
 * Bütün yanıtı eşler.
 *
 * Sıralama SUNUCUDAN geldiği gibi korunur; istemci yeniden sıralamaz. Sezon
 * numarası ve toplam katılımcı sayısı her satırda aynıdır, ilk geçerli
 * satırdan okunur. Aynı katılımcı iki kez gelirse (beklenmez) ilk satır
 * kalır: kullanıcının kendi satırı listede İKİ KEZ görünmez.
 */
export function parseFriendRankLeaderboard<Rank extends string>(
  rows: readonly FriendRankLeaderboardRow[] | null | undefined,
  options: { order: readonly Rank[]; fallbackRank: Rank },
): FriendRankLeaderboardParsed<Rank> {
  const entries: FriendRankLeaderboardParsedEntry<Rank>[] = [];
  const seen = new Set<string>();
  let seasonIndex: number | undefined;
  let participantCount: number | undefined;

  for (const row of rows ?? []) {
    const entry = parseFriendRankLeaderboardRow(row, options);
    if (!entry || seen.has(entry.userId)) continue;
    seen.add(entry.userId);
    entries.push(entry);

    if (seasonIndex === undefined) seasonIndex = asCount(row.season_index);
    if (participantCount === undefined) participantCount = asCount(row.participant_count);
  }

  // Toplam okunamazsa en azından gösterilen satır sayısı doğrudur.
  const total = Math.max(participantCount ?? 0, entries.length);

  return {
    entries,
    isTruncated: total > entries.length,
    participantCount: total,
    seasonIndex,
  };
}

// ---------------------------------------------------------------------------
// 5) Sezon başarıları — anahtar sözlüğü ve satır eşlemesi
// ---------------------------------------------------------------------------

/**
 * Sezon başarılarının TEK ve SABİT anahtar kaynağı.
 *
 * Sıra, SQL'deki `season_achievement_catalog()` içindeki `sort_order` ile
 * BİREBİR aynıdır; harness ikisini karşılaştırır. Eşik (hedef) değerleri
 * BİLİNÇLİ OLARAK burada tutulmaz: onların tek otoritesi sunucudur ve
 * `target_progress` olarak yanıtla birlikte gelir.
 */
export const SEASON_ACHIEVEMENT_KEYS = [
  'first_workout',
  'workout_5',
  'workout_15',
  'streak_3',
  'streak_7',
  'perfect_week',
] as const;

export type SeasonAchievementKey = (typeof SEASON_ACHIEVEMENT_KEYS)[number];

/** Sunucudan gelen HAM satır; sözleşmeye uyduğu VARSAYILMAZ. */
export type SeasonAchievementRow = {
  achievement_key?: unknown;
  is_unlocked?: unknown;
  unlocked_at?: unknown;
  current_progress?: unknown;
  target_progress?: unknown;
};

/** Ekranın kullandığı, güvenle daraltılmış başarı satırı. */
export type SeasonAchievementParsed = {
  key: SeasonAchievementKey;
  isUnlocked: boolean;
  /** Yalnızca açılmışsa dolu gelir. */
  unlockedAt?: string;
  currentProgress: number;
  targetProgress: number;
};

/** Bilinen bir başarı anahtarı mı? */
export function parseSeasonAchievementKey(value: unknown): SeasonAchievementKey | undefined {
  return SEASON_ACHIEVEMENT_KEYS.includes(value as SeasonAchievementKey)
    ? (value as SeasonAchievementKey)
    : undefined;
}

/**
 * Başarı yanıtını eşler.
 *
 * DEĞİŞMEZLER
 *  - İstemci hiçbir ilerleme HESAPLAMAZ: `currentProgress` ve `targetProgress`
 *    sunucudan geldiği gibi taşınır.
 *  - Tanınmayan anahtar, kimliksiz veya bozuk satır sessizce DÜŞER; ekran
 *    çökmez.
 *  - Aynı anahtar iki kez gelirse İLK satır kalır — rozet listede iki kez
 *    görünmez.
 *  - Sıralama her zaman `SEASON_ACHIEVEMENT_KEYS` sırasıdır; sunucu sırası
 *    bozulsa bile ekran kararlı kalır.
 *  - Eksik satır için sahte bir hedef ÜRETİLMEZ: o rozet hiç çizilmez.
 */
export function parseSeasonAchievements(
  rows: readonly SeasonAchievementRow[] | null | undefined,
): SeasonAchievementParsed[] {
  const byKey = new Map<SeasonAchievementKey, SeasonAchievementParsed>();

  for (const row of rows ?? []) {
    const key = parseSeasonAchievementKey(row.achievement_key);
    if (!key || byKey.has(key)) continue;

    const targetProgress = asCount(row.target_progress);
    // Hedef okunamıyorsa satır gösterilemez: uydurma eşik üretilmez.
    if (targetProgress === undefined || targetProgress <= 0) continue;

    const isUnlocked = row.is_unlocked === true;
    const rawProgress = asCount(row.current_progress) ?? 0;

    byKey.set(key, {
      currentProgress: Math.min(rawProgress, targetProgress),
      isUnlocked,
      key,
      targetProgress,
      unlockedAt: isUnlocked ? asText(row.unlocked_at) : undefined,
    });
  }

  return SEASON_ACHIEVEMENT_KEYS.map((key) => byKey.get(key)).filter(
    (entry): entry is SeasonAchievementParsed => entry !== undefined,
  );
}

// ---------------------------------------------------------------------------
// 6) Başarı açılma kutlaması — baseline, kuyruk ve depo anahtarı
// ---------------------------------------------------------------------------

/**
 * Gösterilmiş başarı kutlamalarının AsyncStorage anahtarı.
 *
 * Rank yükselme (`rankCelebrationStorageKey`) ve sezon özeti
 * (`seasonRecapStorageKey`) anahtarlarından BİLİNÇLİ olarak ayrıdır: üç
 * deneyim birbirinin kaydını okuyamaz veya bozamaz. Anahtar hem kullanıcı
 * kimliğini hem sezon numarasını taşır, bu yüzden A hesabının kaydı B'yi ve
 * eski sezonun kaydı yeni sezonu etkileyemez.
 */
export function seasonAchievementCelebrationStorageKey(
  userId: string,
  seasonIndex: number,
): string {
  return `rank:achievements-celebrated:${userId}:${seasonIndex}`;
}

/**
 * Depodaki "gösterildi" kaydını güvenle çözer.
 *
 * `undefined` = KAYIT YOK (veya okunamıyor). Çağıran taraf bunu "henüz
 * baseline oluşmadı" olarak yorumlar ve mevcut açılmış rozetleri sessizce
 * baseline yazar — eski rozetler topluca kutlanmaz.
 *
 * Bozuk JSON, dizi olmayan içerik veya tanınmayan anahtarlar uygulamayı
 * ÇÖKERTMEZ: bozuk kayıt "kayıt yok" gibi ele alınır, tanınmayan anahtarlar
 * ise sessizce düşer.
 */
export function parseCelebratedAchievementKeys(
  raw: string | null | undefined,
): SeasonAchievementKey[] | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!Array.isArray(decoded)) return undefined;

  const keys: SeasonAchievementKey[] = [];
  for (const value of decoded) {
    const key = parseSeasonAchievementKey(value);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** Depoya yazılacak biçim. Sıra her zaman katalog sırasıdır. */
export function serializeCelebratedAchievementKeys(
  keys: readonly SeasonAchievementKey[],
): string {
  const unique = SEASON_ACHIEVEMENT_KEYS.filter((key) => keys.includes(key));
  return JSON.stringify(unique);
}

export type AchievementCelebrationDecision = {
  /**
   * `seed` — bu (kullanıcı, sezon) için ilk çalıştırma. Kutlama YOK; mevcut
   * açılmış rozetler baseline olarak yazılır.
   * `queue` — baseline zaten var; yeni açılan rozetler kutlama sırasına girer.
   */
  type: 'seed' | 'queue';
  /** Depoya yazılacak tam liste (`seed`) veya mevcut kayıt (`queue`). */
  celebrated: SeasonAchievementKey[];
  /** Gösterilecek yeni rozetler — KATALOG sırasında. */
  queue: SeasonAchievementKey[];
};

/**
 * Hangi rozetlerin kutlanacağına karar verir.
 *
 * DEĞİŞMEZLER
 *  - İlk çalıştırmada (kayıt yok / bozuk) kutlama ÜRETİLMEZ: mevcut açılmış
 *    rozetlerin tamamı baseline olur.
 *  - Baseline oluştuktan sonra yalnızca YENİ açılan rozetler kuyruğa girer.
 *  - Kuyruk her zaman `SEASON_ACHIEVEMENT_KEYS` sırasındadır; sunucu sırası
 *    değişse bile gösterim sırası kararlı kalır.
 *  - Karar "gösterildi" anlamına GELMEZ. Kalıcı kayıt yalnızca overlay
 *    gerçekten render/layout olduğunda ilerler.
 *  - Bu fonksiyon hiçbir başarı koşulu veya ilerleme HESAPLAMAZ; yalnızca
 *    sunucudan gelen "açık" listesini karşılaştırır.
 */
export function decideAchievementCelebrations(input: {
  /** Sunucuya göre şu an AÇIK olan rozetler. */
  unlockedKeys: readonly string[];
  /** Depodaki kayıt; `undefined` ise baseline henüz yok. */
  celebrated?: readonly SeasonAchievementKey[];
}): AchievementCelebrationDecision {
  const unlocked = SEASON_ACHIEVEMENT_KEYS.filter((key) => input.unlockedKeys.includes(key));

  if (input.celebrated === undefined) {
    // İlk çalıştırma: eski rozetler topluca kutlanmaz.
    return { celebrated: unlocked, queue: [], type: 'seed' };
  }

  const celebrated = SEASON_ACHIEVEMENT_KEYS.filter((key) => input.celebrated!.includes(key));
  return {
    celebrated,
    queue: unlocked.filter((key) => !celebrated.includes(key)),
    type: 'queue',
  };
}

// ---------------------------------------------------------------------------
// 7) Rank katmanı sahipliği — aynı anda tek overlay
// ---------------------------------------------------------------------------

/**
 * Rank deneyimindeki tam ekran katmanlar.
 *
 * Sıra ÖNCELİK sırasıdır: aynı anda birden fazlası beklerken önce sıradaki
 * gösterilir. Öncelik ÖNCELEME (preemption) DEĞİLDİR — süren bir katman
 * bölünmez; yeni gelen sırasını bekler.
 */
export const RANK_OVERLAY_PRIORITY = ['rank-up', 'season-recap', 'achievement'] as const;

export type RankOverlayOwner = (typeof RANK_OVERLAY_PRIORITY)[number];

/**
 * Bir katman gösterime başlayabilir mi?
 *
 * Saf ve senkron: `active` boşsa ya da zaten aynı katmansa evet. Böylece iki
 * katman AYNI KAREDE üst üste açılamaz.
 */
export function canClaimRankOverlay(
  active: RankOverlayOwner | undefined,
  owner: RankOverlayOwner,
): boolean {
  return active === undefined || active === owner;
}

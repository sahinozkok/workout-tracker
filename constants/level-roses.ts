/**
 * SEVİYE GÜLLERİ — İSTEMCİ TARAFINDAKİ TEK KATALOG (SAF)
 *
 * Kullanıcı seviye atladıkça YENİ gül sembolleri AÇILIR; kullanıcı açtığı
 * güllerden birini seçip profilinde sergiler. Bu dosya `constants/ranks.ts` ile
 * AYNI duruşu izler:
 *   * hiçbir `import`u YOKTUR (harness `.mjs` tek başına derleyip çalıştırır),
 *   * asset `require`'ları BURADA DEĞİL, `components/rewards/level-rose-emblem`
 *     içindeki kaynak haritasındadır (bu dosya saf/derlenebilir kalsın diye).
 *
 * ÜRÜN AYRIMI — Bu semboller LEVEL (XP) sistemine bağlıdır. Season Rank
 * rozetleri, RP, Season Badges ve harcanabilir "roses" bakiyesi AYRI
 * sistemlerdir; bu dosya onları TANIMAZ ve ETKİLEMEZ. Bir gül seçmek XP/RP/roses
 * üretmez veya harcamaz.
 *
 * OTORİTE — açılma ve seçim geçerliliğinin SON otoritesi SUNUCUDUR. Buradaki saf
 * fonksiyonlar yalnızca (a) sunucu verisi gelmeden güvenli yerel gösterim ve
 * (b) sınır testleri içindir. Gerçek seviye `constants/level-curve.ts`'ten gelir
 * ve bir gül seçmek gerçek seviyeyi DEĞİŞTİRMEZ.
 */

/** Kararlı sembol kimliği + açılma seviyesi. Sıra açılma seviyesine göre artar. */
export type LevelRose = {
  /** KALICI kimlik. Sunucuda ve istemcide bu string saklanır; asla değişmez. */
  id: string;
  /** Bu gülün açıldığı seviye (dahil). */
  unlockLevel: number;
};

/**
 * 25 sembol — kaynak görsellerin kesin seviye eşlemesi. Eksik seviyeye yeni gül
 * UYDURULMAZ; liste bu 25 kimlikle sabittir.
 *
 * Çoklu kaynaklar: 1..5 → L1-5, 6..10 → L6-10, 11..13 → L11-13.
 * Tekli kaynaklar: 15,20,25,30,35,40,50,65,80,100,150,200.
 */
export const LEVEL_ROSES: readonly LevelRose[] = [
  { id: 'rose_1', unlockLevel: 1 },
  { id: 'rose_2', unlockLevel: 2 },
  { id: 'rose_3', unlockLevel: 3 },
  { id: 'rose_4', unlockLevel: 4 },
  { id: 'rose_5', unlockLevel: 5 },
  { id: 'rose_6', unlockLevel: 6 },
  { id: 'rose_7', unlockLevel: 7 },
  { id: 'rose_8', unlockLevel: 8 },
  { id: 'rose_9', unlockLevel: 9 },
  { id: 'rose_10', unlockLevel: 10 },
  { id: 'rose_11', unlockLevel: 11 },
  { id: 'rose_12', unlockLevel: 12 },
  { id: 'rose_13', unlockLevel: 13 },
  { id: 'rose_15', unlockLevel: 15 },
  { id: 'rose_20', unlockLevel: 20 },
  { id: 'rose_25', unlockLevel: 25 },
  { id: 'rose_30', unlockLevel: 30 },
  { id: 'rose_35', unlockLevel: 35 },
  { id: 'rose_40', unlockLevel: 40 },
  { id: 'rose_50', unlockLevel: 50 },
  { id: 'rose_65', unlockLevel: 65 },
  { id: 'rose_80', unlockLevel: 80 },
  { id: 'rose_100', unlockLevel: 100 },
  { id: 'rose_150', unlockLevel: 150 },
  { id: 'rose_200', unlockLevel: 200 },
] as const;

export type LevelRoseId = (typeof LEVEL_ROSES)[number]['id'];

/** Kimlik → katalog kaydı (O(1) arama). */
const ROSE_BY_ID: ReadonlyMap<string, LevelRose> = new Map(
  LEVEL_ROSES.map((rose) => [rose.id, rose]),
);

/** Katalogda tanımlı geçerli bir gül kimliği mi? */
export function isKnownRoseId(value: unknown): value is LevelRoseId {
  return typeof value === 'string' && ROSE_BY_ID.has(value);
}

/** Verilen kimliğin açılma seviyesi; bilinmeyen kimlikte `undefined`. */
export function roseUnlockLevel(id: string): number | undefined {
  return ROSE_BY_ID.get(id)?.unlockLevel;
}

/**
 * Gerçek seviyesi `level` olan kullanıcının AÇILMIŞ gülleri (açılma sırasına
 * göre). Önceden yüksek seviyeye ulaşmış kullanıcı da bütün kazanılmış güllerine
 * erişir. Seviye ne olursa olsun (>=1) en az `rose_1` açıktır.
 */
export function unlockedRoses(level: number): LevelRose[] {
  const safe = Number.isFinite(level) ? Math.floor(level) : 1;
  return LEVEL_ROSES.filter((rose) => rose.unlockLevel <= safe);
}

/** Belirli bir gül bu seviyede AÇIK mı? (sunucu doğrulamasının yerel yansıması) */
export function isRoseUnlocked(id: string, level: number): boolean {
  const unlock = roseUnlockLevel(id);
  if (unlock === undefined) return false;
  const safe = Number.isFinite(level) ? Math.floor(level) : 1;
  return unlock <= safe;
}

/**
 * En yüksek açılmış gül — kullanıcı HENÜZ SEÇİM YAPMAMIŞSA gösterilen otomatik
 * varsayılan. Seviye < 1 bile olsa `rose_1` döner (liste boş kalmaz).
 */
export function highestUnlockedRose(level: number): LevelRose {
  const unlocked = unlockedRoses(level);
  return unlocked.length > 0 ? unlocked[unlocked.length - 1] : LEVEL_ROSES[0];
}

/**
 * GÖSTERİLECEK gül kararı — sunucudan gelen (veya yerel) seçim + gerçek seviye.
 *
 *   * Kullanıcının AÇIK bir seçimi varsa ve o gül seviyesinde AÇIKSA, seçim
 *     aynen gösterilir — kullanıcı KAZANDIĞI eski bir gülü takabilir ve bu
 *     seviyeyi DEĞİŞTİRMEZ.
 *   * Seçim yoksa (otomatik mod) VEYA seçim artık geçerli değilse (kilitli/
 *     bilinmeyen — normalde olmaz) EN YÜKSEK açılmış gül gösterilir.
 *
 * Bu, "açık kullanıcı tercihi" ile "otomatik varsayılan"ı ayırır: yeni seviye
 * açıldığında manuel tercih KENDİLİĞİNDEN değişmez (seçim hâlâ geçerliyse
 * korunur); yalnızca otomatik moddaki kullanıcı en yükseğe taşınır.
 */
export function resolveDisplayedRose(level: number, selectedId?: string | null): LevelRose {
  if (selectedId && isRoseUnlocked(selectedId, level)) {
    return ROSE_BY_ID.get(selectedId) as LevelRose;
  }
  return highestUnlockedRose(level);
}

/**
 * Bir seçimin KAYDEDİLEBİLİR olup olmadığı (istemci ön kontrolü; sunucu yine
 * kendi seviyesine göre doğrular). `null` = otomatik moda dönüş, her zaman
 * geçerlidir. Bilinmeyen veya kilitli kimlik reddedilir.
 */
export function canSelectRose(id: string | null, level: number): boolean {
  if (id === null) return true;
  return isRoseUnlocked(id, level);
}

/**
 * BAŞKA BİR KULLANICININ (arkadaş) gül tercihinin YÜKLEME DURUMU.
 *
 * Kendi profilimizden farkı: arkadaşın tercihi AYRI bir istekle okunur ve bu
 * istek yükleniyor/başarısız olabilir. Bu üç durum GERÇEKTEN ayrılmalıdır;
 * okunamayan tercih "otomatik" gibi sunulup arkadaşın SEÇMEDİĞİ bir gül onun
 * sembolü olarak GÖSTERİLMEZ.
 *
 *   * `loading`     — tercih henüz okunmadı; hiçbir varsayım yapılmaz.
 *   * `unavailable` — RPC eksik / ağ hatası / erişim reddi / geçersiz yanıt;
 *                     null tercihe DÖNÜŞTÜRÜLMEZ.
 *   * `ready`       — başarılı okuma. `selectedId` string ise açık seçim,
 *                     `null` ise arkadaşın açık otomatik tercihi.
 */
export type FriendRoseState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; selectedId: string | null };

/**
 * Arkadaşın gülünün NASIL gösterileceği kararı — SAF.
 *
 *   * `ready` + `selectedId` string  → o gül (kilitliyse/​bilinmeyense en
 *     yükseğe düşer; seviye DEĞİŞMEZ).
 *   * `ready` + `null`               → arkadaşın DOĞRULANMIŞ seviyesine göre
 *     otomatik (en yüksek açık) gül.
 *   * `loading` / `unavailable`      → GÜL GÖSTERİLMEZ (placeholder); tahmini
 *     bir gül seçilmiş gibi çizilmez. Gerçek level metni çağıran tarafta
 *     ayrıdır ve bu karardan ETKİLENMEZ.
 *
 * `loading` ve `unavailable` FARKLI sonuçlardır (biri "henüz bilmiyoruz", diğeri
 * "okunamadı"); `ready+null`'dan da farklıdır (o gerçek otomatik tercih).
 */
export type FriendRoseDisplay =
  | { mode: 'rose'; roseId: string }
  | { mode: 'placeholder'; reason: 'loading' | 'unavailable' };

export function resolveFriendRoseDisplay(state: FriendRoseState, level: number): FriendRoseDisplay {
  if (state.kind === 'loading') return { mode: 'placeholder', reason: 'loading' };
  if (state.kind === 'unavailable') return { mode: 'placeholder', reason: 'unavailable' };
  return { mode: 'rose', roseId: resolveDisplayedRose(level, state.selectedId).id };
}

/**
 * `get_my_level_rose` / `get_friend_level_rose` HAM yanıtını GÜVENLE daraltır.
 *
 *   * `null`            → geçerli "otomatik" tercih (seçim yok).
 *   * boş olmayan string→ seçim kimliği (ham; geçerlilik gösterimde çözülür).
 *   * boş string        → otomatik (null).
 *   * BAŞKA HER ŞEY     → GEÇERSİZ yanıt → `throw`. SESSİZCE null'a (otomatik)
 *     ÇEVRİLMEZ: çağıran bunu hata olarak ele alır (arkadaş tarafında
 *     `unavailable`), böylece geçersiz sunucu yanıtı "otomatik tercih" gibi
 *     sunulmaz.
 */
export function parseLevelRoseResponse(data: unknown): string | null {
  if (data === null) return null;
  if (typeof data === 'string') return data.length > 0 ? data : null;
  throw new Error('invalid_level_rose_response');
}

/**
 * ARKADAŞ okumasının SONUCU — üç durumu AÇIKÇA ayırır (SAF).
 *
 *   * `ready`  → erişim VAR; `selectedId` string=açık seçim, `null`=arkadaşın
 *     gerçek OTOMATİK tercihi.
 *   * `denied` → erişim YOK (arkadaş değil / engellenmiş). Bu "otomatik tercih"
 *     DEĞİLDİR; çağıran bunu `unavailable` gibi ele alır ve arkadaşın SEÇMEDİĞİ
 *     bir gülü SEMBOL olarak çizmez.
 */
export type FriendRoseFetch =
  | { kind: 'ready'; selectedId: string | null }
  | { kind: 'denied' };

/**
 * `get_friend_level_rose` HAM yanıtını GÜVENLE daraltır — erişim reddini otomatik
 * tercihten AYIRIR.
 *
 *   * DİZİ (yeni sözleşme, `returns table`): 0 satır → `denied` (erişim yok);
 *     1 satır → `ready` (satırdaki `selected_level_rose`; null=otomatik).
 *   * SKALER (eski sunucu, `returns text`): `ready` (null=otomatik). Eski
 *     sözleşmede red ile otomatik AYIRT EDİLEMEZ; ama arkadaş profili zaten
 *     `are_friends` kapısıyla açıldığından başarılı skaler okuma gerçek tercih
 *     sayılır. Beklenmedik değer (nesne/sayı) `parseLevelRoseResponse` içinde
 *     fırlatılır → çağıran `unavailable`.
 */
export function parseFriendLevelRoseResponse(data: unknown): FriendRoseFetch {
  if (Array.isArray(data)) {
    if (data.length === 0) return { kind: 'denied' };
    const row = data[0] as { selected_level_rose?: unknown } | null;
    const value = row && typeof row === 'object' ? row.selected_level_rose ?? null : null;
    return { kind: 'ready', selectedId: parseLevelRoseResponse(value) };
  }
  return { kind: 'ready', selectedId: parseLevelRoseResponse(data) };
}

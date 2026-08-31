#!/usr/bin/env node
/**
 * RANK SEKME GEÇİŞİ — DOĞRULAMA HARNESS'I
 *
 * Kapsam: `app/rank.tsx` içindeki YEREL sekmelerin (Genel / Başarılar / Geçmiş)
 * içerik GEÇİŞİ. Sekmeye basıldığında içerik sert biçimde değişmez; mevcut
 * motion altyapısındaki tek `MotionSwap` sınırı kısa fade + çok küçük dikey
 * girişle yerleştirir.
 *
 * Bu harness YALNIZCA görsel geçiş sözleşmesini kilitler. Sekme değişimi hiçbir
 * sorgu/RPC çalıştırmaz, veri yüklemeleri sekmeden bağımsızdır ve motion
 * tokenları/helper'ı bu turda DEĞİŞMEZ. RP kuralları, rank/achievement
 * hesapları, kutlama ve emblem tasarımı burada test EDİLMEZ — onlar ayrı
 * harness'lardadır ve bu tur onlara dokunmaz.
 *
 * Projede jest KURULU DEĞİL; diğer rank harness'ları gibi kaynak metni statik
 * denetlenir. Harness gerçek SÖZLEŞMEYİ test eder; yorum/boşluk değişikliğine
 * bağlı değildir.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (path) => readFileSync(join(ROOT, path), 'utf8');

const screen = source('app/rank.tsx');
const motionSection = source('components/motion-section.tsx');
const motionTokens = source('constants/motion.ts');

let passed = 0;
function check(condition, message) {
  assert.ok(condition, message);
  passed += 1;
}

// ---------------------------------------------------------------------------
// Tek geçiş sınırının gövdesini çıkar.
// ---------------------------------------------------------------------------
const swapOpenCount = (screen.match(/<MotionSwap[\s>]/g) ?? []).length;
const swapCloseCount = (screen.match(/<\/MotionSwap>/g) ?? []).length;
check(swapOpenCount === 1, 'Sekme içeriği TEK bir MotionSwap sınırı kullanmalı');
check(swapCloseCount === 1, 'MotionSwap tam olarak bir kez kapanmalı');

const swapStart = screen.indexOf('<MotionSwap');
const swapEnd = screen.indexOf('</MotionSwap>');
assert.ok(swapStart !== -1 && swapEnd > swapStart, 'MotionSwap bloğu bulunamalı');
/** MotionSwap açılış etiketi (props) — kapanış `>`'ine kadar. */
const swapOpen = screen.slice(swapStart, screen.indexOf('>', swapStart) + 1);
/** MotionSwap iç gövdesi — açılış `>`'inden kapanışa kadar. */
const swapBody = screen.slice(screen.indexOf('>', swapStart) + 1, swapEnd);
/** MotionSwap'tan ÖNCEki bölge — başlık/hero/sekme şeridi burada. */
const preSwap = screen.slice(0, swapStart);

// ---------------------------------------------------------------------------
// 1. transitionKey doğrudan activeTab.
// ---------------------------------------------------------------------------
check(/transitionKey=\{activeTab\}/.test(swapOpen), 'transitionKey doğrudan activeTab olmalı');

// ---------------------------------------------------------------------------
// 2. Geçmiş ağır içerik olarak layout animasyonundan korunuyor.
// ---------------------------------------------------------------------------
check(
  /contentWeight=\{HEAVY_CONTENT_TABS\.includes\(activeTab\) \? 'heavy' : 'regular'\}/.test(swapOpen),
  "Geçmiş sekmesi contentWeight=\"heavy\" almalı; diğerleri 'regular'",
);
// Ağır içerik yalnızca geçmiş sekmesidir; genel/başarılar normal ağırlıkta.
check(
  /HEAVY_CONTENT_TABS[^=]*=\s*\[\s*'history'\s*\]/.test(screen),
  'Yalnızca geçmiş sekmesi ağır içerik olarak işaretlenmeli',
);
check(
  !/HEAVY_CONTENT_TABS[^=]*=\s*\[[^\]]*'overview'|HEAVY_CONTENT_TABS[^=]*=\s*\[[^\]]*'achievements'/.test(screen),
  'Genel/Başarılar ağır içerik olarak işaretlenmemeli',
);
// MotionSwap'ın ağır içerikte layout animasyonunu gerçekten kapattığını doğrula
// (helper sözleşmesi): heavy → layout undefined.
check(
  /isHeavy\s*\?\s*undefined\s*:\s*LinearTransition/.test(motionSection),
  'MotionSwap ağır içerikte layout animasyonunu kapatmalı (helper sözleşmesi)',
);

// ---------------------------------------------------------------------------
// 3. Üç koşullu sekme içeriği MotionSwap altında ve doğru kalmış.
// ---------------------------------------------------------------------------
for (const key of ['overview', 'achievements', 'history']) {
  check(
    new RegExp(`activeTab === '${key}' \\? \\(`).test(swapBody),
    `${key} dalı MotionSwap altında koşullu olmalı`,
  );
}
check(
  swapBody.includes('WeekFocusCard') && swapBody.includes("t('ranks.seasonEndsIn')"),
  'Genel dalı haftalık odak ve sezon istatistiklerini taşımalı',
);
check(
  swapBody.includes('AchievementsGrid') && swapBody.includes("t('ranks.achievements.title')"),
  'Başarılar dalı başarı grid’ini taşımalı',
);
check(
  swapBody.includes("t('ranks.recentActivity')") && swapBody.includes("t('ranks.pastSeasons')"),
  'Geçmiş dalı RP hareketleri ve geçmiş sezonları taşımalı',
);
// Her dal kendi `) : null}` ile kapanır (sunum state'i; render koşulu korunur).
check((swapBody.match(/\) : null\}/g) ?? []).length === 3, 'Üç sekme dalı da koşullu render kapanışını korumalı');

// ---------------------------------------------------------------------------
// 4. İç dallarda ÇİFT giriş animasyonu üreten MotionSection YOK.
// ---------------------------------------------------------------------------
check(!swapBody.includes('MotionSection'), 'Sekme içeriğinde MotionSection kalmamalı (çift animasyon riski)');
check(!/delay=\{/.test(swapBody), 'Sekme içeriğinde gereksiz delay katmanı kalmamalı');

// ---------------------------------------------------------------------------
// 5. Başlık, hero ve sekme şeridinin ilk giriş animasyonları korunuyor.
// ---------------------------------------------------------------------------
// Bu üç MotionSection MotionSwap'tan ÖNCE gelir ve ekrandaki TEK MotionSection'lardır.
const totalSections = (screen.match(/<MotionSection/g) ?? []).length;
check(totalSections === 3, 'Yalnızca başlık/hero/sekme şeridi MotionSection kullanmalı (üç giriş)');
check((preSwap.match(/<MotionSection/g) ?? []).length === 3, 'Üç MotionSection MotionSwap’tan önce gelmeli');
check(/<MotionSection style=\{styles\.header\}/.test(preSwap), 'Başlık MotionSection girişi korunmalı');
check(/<MotionSection delay=\{40\}/.test(preSwap), 'Hero kartının giriş animasyonu (delay 40) korunmalı');
check(/<MotionSection delay=\{80\}>[\s\S]*?<RankTabs/.test(preSwap), 'Sekme şeridinin giriş animasyonu (delay 80) korunmalı');

// ---------------------------------------------------------------------------
// 6. Sekme düğmeleri hâlâ MotionPressable; a11y rolü/durumu ve 44 pt korunuyor.
// ---------------------------------------------------------------------------
const tabsStart = screen.indexOf('function RankTabs(');
assert.ok(tabsStart !== -1, 'RankTabs bileşeni bulunmalı');
const tabsBody = screen.slice(tabsStart, screen.indexOf('function ', tabsStart + 1));
check(tabsBody.includes('<MotionPressable'), 'Sekme düğmeleri MotionPressable basma geri bildirimini korumalı');
check(tabsBody.includes('accessibilityRole="tab"'), 'Sekmeler tab rolü taşımalı');
check(/accessibilityState=\{\{\s*selected:/.test(tabsBody), 'Seçili durum accessibilityState ile bildirilmeli');
check(/tab:\s*\{[^}]*minHeight:\s*Layout\.minTouchSize/.test(screen), 'Her sekme en az 44 pt dokunma yüksekliğinde olmalı');
check(screen.includes('tabUnderline') && screen.includes('backgroundColor: accent'), 'Seçili alt çizgi rank rengini korumalı');

// ---------------------------------------------------------------------------
// 7. Dört veri yükleme effect'i sekmeden BAĞIMSIZ; activeTab dep değil.
// ---------------------------------------------------------------------------
for (const loader of ['loadHistory', 'loadEvents', 'loadWeekFocus', 'loadAchievements']) {
  check(
    new RegExp(`useEffect\\(\\(\\) => \\{\\s*void ${loader}\\(\\);`).test(screen),
    `${loader} mount effect'i korunmalı`,
  );
}
// Yükleyici çağrı satırları sekme state'i içermez.
for (const line of screen.split('\n')) {
  if (/void load(History|Events|WeekFocus|Achievements)\(\);/.test(line)) {
    check(!line.includes('activeTab'), 'Veri yüklemesi sekmeye göre koşullandırılmamalı');
  }
}
// Hiçbir bağımlılık dizisi activeTab içermez (sekme değişimi fetch tetiklemez).
for (const deps of screen.matchAll(/\}, \[([^\]]*)\]\)/g)) {
  check(!deps[1].includes('activeTab'), 'activeTab hiçbir effect bağımlılığına eklenmemeli');
}

// ---------------------------------------------------------------------------
// 8. Motion tokenı/helper değişmemiş; yeni paket veya ham animasyon YOK.
// ---------------------------------------------------------------------------
// Geçiş mevcut altyapı üzerinden gelir: ekran doğrudan Reanimated'a inmez.
check(!/from 'react-native-reanimated'/.test(screen), 'Ekran Reanimated’ı doğrudan import etmemeli');
check(
  !/\.duration\(|\.easing\(|withTiming|withSpring|withInitialValues|FadeIn|FadeOut|FadeInDown|LinearTransition/.test(
    screen,
  ),
  'Ekran ham animasyon/süre değeri yazmamalı — geçiş MotionSwap üzerinden gelmeli',
);
// MotionSwap yine mevcut motion-section helper'ından gelir.
check(
  /import \{[^}]*MotionSwap[^}]*\} from '@\/components\/motion-section'/.test(screen),
  'MotionSwap mevcut motion-section helper’ından gelmeli',
);
// Helper ve tokenlar hâlâ yerinde ve token kaynağından besleniyor (gutlanmamış).
check(/export function MotionSwap/.test(motionSection), 'MotionSwap helper’ı korunmalı');
check(/from '@\/constants\/motion'/.test(motionSection), 'MotionSwap tokenları constants/motion’dan almalı');
check(/export const MotionDuration/.test(motionTokens), 'Motion süre tokenları korunmalı');
// Reduce Motion kapısı MotionSwap içinde otomatik: ekran kendi kapısını kurmaz.
check(/reduceMotion \? undefined : motion\.entering/.test(motionSection), 'Reduce Motion MotionSwap içinde otomatik ele alınmalı');
check(!/useReducedMotion/.test(screen), 'Ekran kendi Reduce Motion kapısını kurmamalı');

// ---------------------------------------------------------------------------

console.log(`✓ Rank sekme geçişi harness: ${passed} kontrol geçti.`);
console.log('  (Motion tokenı/helper’a dokunulmadı; yalnızca sekme içerik geçişi doğrulandı.)');

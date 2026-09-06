#!/usr/bin/env node
/**
 * KARİYER BAŞARIMLARI — SÖZLEŞME + PARİTE HARNESS'I (statik)
 *
 * SUNUCU (`achievement_catalog()` + ledger CHECK + sync RPC + backfill + showcase)
 * ile İSTEMCİ (`constants/achievements.ts`) arasındaki paritenin ve güvenlik
 * yüzeyinin bozulmadığını kilitler. Gerçek RPC DAVRANIŞI ayrı izole PostgreSQL
 * (`supabase/tests/career_achievements_isolated.sql` + `..._backfill_isolated`)
 * ve gerçek RLS/JWT authz testinde çalıştırılır — burası statik sözleşmedir.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); } };

const mig = src('supabase/migrations/20260912120000_add_career_achievements.sql');
const backfill = src('supabase/migrations/20260913120000_backfill_career_achievements.sql');
const showcase = src('supabase/migrations/20260914120000_add_career_achievement_showcase.sql');
const client = src('constants/achievements.ts');

// --- SQL catalog VALUES -> map ---
const sqlCatalog = new Map();
{
  const block = /achievement_catalog\(\)[\s\S]*?from \(values([\s\S]*?)\) as c\(/.exec(mig)[1];
  const re = /\('([a-z0-9_]+)','([a-z]+)',(\d+),(\d+),'([a-z]+)'\)/g;
  let m;
  while ((m = re.exec(block))) sqlCatalog.set(m[1], { category: m[2], target: +m[3], sort: +m[4], kind: m[5] });
}

// --- client catalog -> map ---
const clientCatalog = new Map();
{
  const re = /\{ key: '([a-z0-9_]+)', category: '([a-z]+)', target: (\d+), sort: (\d+), kind: '([a-z]+)', unit: '([a-z0-9_]+)' \}/g;
  let m;
  while ((m = re.exec(client))) clientCatalog.set(m[1], { category: m[2], target: +m[3], sort: +m[4], kind: m[5], unit: m[6] });
}

check('1. Sunucu kataloğu tam 30 benzersiz anahtar', () => {
  assert.equal(sqlCatalog.size, 30, `SQL katalog ${sqlCatalog.size} anahtar`);
  const sorts = [...sqlCatalog.values()].map((v) => v.sort).sort((a, b) => a - b);
  assert.deepEqual(sorts, Array.from({ length: 30 }, (_, i) => i + 1), 'sort 1..30 değil');
  const cats = { easy: 0, medium: 0, hard: 0 };
  for (const v of sqlCatalog.values()) cats[v.category] += 1;
  assert.deepEqual(cats, { easy: 10, medium: 10, hard: 10 }, 'kategori dağılımı 10/10/10 değil');
});

check('2. İstemci kataloğu SUNUCU ile BİREBİR (anahtar/kategori/hedef/sıra)', () => {
  assert.equal(clientCatalog.size, 30, `istemci katalog ${clientCatalog.size} anahtar`);
  for (const [key, s] of sqlCatalog) {
    const c = clientCatalog.get(key);
    assert(c, `istemcide eksik anahtar: ${key}`);
    assert.equal(c.category, s.category, `${key} kategori ayrışıyor`);
    assert.equal(c.target, s.target, `${key} hedef ayrışıyor (${c.target}≠${s.target})`);
    assert.equal(c.sort, s.sort, `${key} sıra ayrışıyor`);
    assert.equal(c.kind, s.kind, `${key} tür ayrışıyor`);
  }
  for (const key of clientCatalog.keys()) assert(sqlCatalog.has(key), `istemcide fazladan anahtar: ${key}`);
});

check('3. Ledger CHECK 30 anahtarın hepsini içerir', () => {
  const block = /achievement_key in \(([\s\S]*?)\)\s*\)/.exec(mig)[1];
  const keys = new Set([...block.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]));
  for (const key of sqlCatalog.keys()) assert(keys.has(key), `CHECK'te eksik: ${key}`);
  assert.equal(keys.size, 30, 'CHECK anahtar sayısı 30 değil');
});

check('4. Görsel TEK KAYNAK: 30 anahtar → statik PNG require kaynak haritası', () => {
  const block = /ACHIEVEMENT_VISUALS[\s\S]*?=\s*\{([\s\S]*?)\n\};/.exec(client)[1];
  const visuals = new Map(
    [...block.matchAll(/([a-z0-9_]+):\s*require\('@\/assets\/achievements\/career\/([a-z0-9_]+)\.png'\)/g)].map((m) => [
      m[1],
      m[2],
    ]),
  );
  for (const key of sqlCatalog.keys()) {
    assert(visuals.has(key), `görsel haritada eksik: ${key}`);
    // Statik require; dosya adı anahtarla birebir eşleşir (Metro tüm assetleri paketler).
    assert.equal(visuals.get(key), key, `${key} görsel asset dosyası anahtarla eşleşmiyor: ${visuals.get(key)}`);
  }
  assert.equal(visuals.size, 30, 'görsel harita 30 değil');
  // Geçici Ionicons kaynağı KALDIRILDI (tip/import artık katalogda yok).
  assert(!/from '@expo\/vector-icons'/.test(client), 'katalog hâlâ geçici Ionicons import ediyor');
  assert(!/keyof typeof Ionicons\.glyphMap/.test(client), 'katalog hâlâ Ionicons glyph tipini kullanıyor');
});

check('5. Sync RPC 30 başarımın HEPSİNİ türetir; sürekli-0 başarım yok', () => {
  const insertBlock = /insert into public\.career_achievements \(user_id, achievement_key\)[\s\S]*?on conflict/.exec(mig)[0];
  const derived = new Set([...insertBlock.matchAll(/select '([a-z0-9_]+)'|union all select '([a-z0-9_]+)'/g)].map((m) => m[1] || m[2]));
  for (const key of sqlCatalog.keys()) assert(derived.has(key), `türetilmeyen başarım: ${key}`);
  assert.equal(derived.size, 30, `türetilen sayı 30 değil: ${derived.size}`);
  // Podyum: sync FINALIZE eder (değişmez snapshot) ve YALNIZ snapshot'tan okur.
  // Blocker 3: finalizer İSTEMCİ TARİHİ ALMAZ (yalnız actor) → erken finalizasyon yok.
  assert(/perform public\.career_finalize_podium\(actor\)/.test(mig), 'podyum finalize çağrısı sync\'te yok (1-arg)');
  assert(!/career_finalize_podium\([^)]*client_today[^)]*\)/.test(mig), 'finalizer hâlâ istemci tarihi alıyor (erken finalizasyon riski)');
  assert(/from public\.career_podium_results as r[\s\S]*?r\.rank <= 3 and r\.score > 0/.test(mig), 'podyum snapshot okuması yok');
  assert(!/career_podium_top3/.test(mig), 'eski anlık podyum yeniden-hesabı (career_podium_top3) kalmış');
  // Blocker 4: hafta-kapanış çevresi friendship_intervals'tan (append-only geçmiş) kurulur.
  assert(/friendship_intervals/.test(mig), 'hafta-sonu arkadaş çevresi (friendship_intervals) yok');
  assert(/started_at < \(\(aw\.week_start \+ 7\)::timestamptz\)/.test(mig), 'hafta-kapanış anına göre arkadaş filtresi yok');
  // Coach: benzersiz tamamlanmış workout analiz defterinden (completed + result dolu).
  assert(/count\(distinct wa\.workout_session_id\)/.test(mig), 'coach kaynağı (ai_workout_analyses) sync\'te yok');
  assert(/wa\.status = 'completed' and wa\.result is not null/.test(mig), 'coach sayımı completed+result değil');
  // İstemci pending listesi BOŞ (hiçbir başarım kaynaksız değil).
  const pending = /ACHIEVEMENTS_PENDING_SOURCE[^=]*=\s*\[([^\]]*)\]/.exec(client)[1];
  assert.equal(pending.trim(), '', 'istemci pending listesi boş olmalı (tüm 30 kaynaklı)');
});

check('6. Backfill: 6 eski sezon anahtarı → yeni kalıcı anahtar, idempotent', () => {
  const map = [
    ['first_workout', 'first_step'], ['workout_5', 'warmup_done'], ['workout_15', 'rhythm_found'],
    ['streak_3', 'three_day_spark'], ['streak_7', 'weekly_flame'], ['perfect_week', 'perfect_week'],
  ];
  for (const [oldK, newK] of map) {
    assert(new RegExp(`\\('${oldK}','${newK}'\\)`).test(backfill), `backfill eşlemesi yok: ${oldK}→${newK}`);
  }
  assert(/on conflict on constraint career_achievements_pkey do nothing/.test(backfill), 'backfill idempotent değil');
  assert(/min\(sra\.unlocked_at\)/.test(backfill), 'en erken unlocked_at korunmuyor');
});

check('7. GÜVENLİK: ledger/showcase tablolarına istemci yazamaz; RPC auth.uid + revoke', () => {
  // Ledger: sadece select grant; insert/update/delete grant/policy YOK.
  assert(/grant select on table public\.career_achievements to authenticated/.test(mig), 'ledger select grant yok');
  assert(!/grant (insert|update|delete)[^;]*career_achievements to authenticated/.test(mig), 'ledger yazma grant sızmış');
  assert(!/for (insert|update|delete)[\s\S]{0,80}career_achievements/.test(mig), 'ledger yazma policy sızmış');
  // Showcase seçim tablosuna HİÇ grant yok.
  assert(/revoke all on table public\.career_achievement_showcase_selections from authenticated/.test(showcase), 'showcase revoke yok');
  // RPC'ler security definer + sabit search_path + auth.uid.
  for (const [file, fn] of [[mig, 'sync_my_achievements'], [showcase, 'set_my_achievement_showcase'], [showcase, 'get_friend_achievement_showcase']]) {
    const body = new RegExp(`function public\\.${fn}[\\s\\S]*?\\$\\$;`).exec(file)[0];
    assert(/security definer/.test(body), `${fn} security definer değil`);
    assert(/set search_path = ''/.test(body), `${fn} sabit search_path yok`);
    assert(/auth\.uid\(\)/.test(body), `${fn} auth.uid kullanmıyor`);
    assert(new RegExp(`grant execute on function public\\.${fn}`).test(file), `${fn} authenticated execute grant yok`);
    assert(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from anon`).test(file), `${fn} anon revoke yok`);
  }
  // Arkadaş showcase are_friends kapılı.
  const friendFn = /function public\.get_friend_achievement_showcase[\s\S]*?\$\$;/.exec(showcase)[0];
  assert(/are_friends\(\(select auth\.uid\(\)\), target_user_id\)/.test(friendFn), 'arkadaş showcase are_friends kapısı yok');
  // Podyum snapshot: kullanıcı KENDİ satırını okur (select grant + select-own policy); yazma yok.
  assert(/grant select on table public\.career_podium_results to authenticated/.test(mig), 'career_podium_results select grant yok');
  assert(!/grant (insert|update|delete)[^;]*career_podium_results to authenticated/.test(mig), 'career_podium_results yazma grant sızmış');
  // AI analiz defteri: istemciye HİÇ grant yok (SELECT dâhil) → claim_token/lease/state gizli.
  assert(!/grant [a-z, ]*on table public\.ai_workout_analyses to (anon|authenticated)/.test(mig), 'ai_workout_analyses istemciye grant sızmış (token/lease gizliliği)');
  assert(!/create policy[\s\S]{0,120}on public\.ai_workout_analyses/.test(mig), 'ai_workout_analyses istemci policy\'si var (grant olmadan işlevsiz + kafa karıştırıcı)');
  for (const t of ['career_podium_results', 'ai_workout_analyses']) {
    assert(!new RegExp(`for (insert|update|delete)[\\s\\S]{0,80}${t}`).test(mig), `${t} yazma policy sızmış`);
  }
  // Podyum finalizer istemci tarafından KEYFİ çalıştırılamaz (authenticated execute YOK, 1-arg).
  assert(/revoke all on function public\.career_finalize_podium\(uuid\) from authenticated/.test(mig),
    'podyum finalizer authenticated\'a kapalı değil');
  assert(!/grant execute on function public\.career_finalize_podium/.test(mig), 'podyum finalizer client\'a açılmış');
  // Blocker 2: atomik claim/complete/fail RPCleri yalnız service_role; authenticated/anon kapalı.
  for (const fn of ['claim_workout_analysis', 'complete_workout_analysis', 'fail_workout_analysis']) {
    assert(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`).test(mig), `${fn} client'a kapalı değil`);
    assert(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`).test(mig), `${fn} service_role grant yok`);
  }
  // friendship_intervals server-internal: anon+authenticated'a HİÇ grant yok.
  assert(/revoke all on table public\.friendship_intervals from anon, authenticated/.test(mig), 'friendship_intervals client\'a kapalı değil');
  assert(!/grant [a-z, ]*on table public\.friendship_intervals to (anon|authenticated)/.test(mig), 'friendship_intervals grant sızmış');
  // Blocker 1: kota UUID/feature — consume_ai_quota workout_analysis kabul eder, service_role only.
  assert(/if requested_feature not in \('chat','workout_analysis'\)/.test(mig), 'consume_ai_quota workout_analysis feature\'ını kabul etmiyor');
  assert(/grant execute on function public\.consume_ai_quota\(uuid, uuid, text, integer\) to service_role/.test(mig), 'consume_ai_quota service_role grant yok');
  // AI analiz bütünlük trigger'ı (sahiplik+tamamlanma) mevcut ve istemciye kapalı.
  assert(/ai_workout_analyses_guard/.test(mig) && /invalid_analysis_session/.test(mig), 'AI analiz guard trigger yok');
  assert(/revoke all on function public\.ai_workout_analyses_guard\(\) from authenticated/.test(mig), 'guard trigger fonksiyonu authenticated\'a açık');
});

check('9. GÜVENLİK v2: friendship helper kaldırıldı, claim sahiplik-token\'ı, ACL denetimi', () => {
  // Blocker 1: dışarıdan çağrılabilir friendship helper fonksiyonları KALDIRILDI.
  assert(!/function public\.friendship_interval_open\b/.test(mig), 'friendship_interval_open hâlâ tanımlı (dis-callable açık)');
  assert(!/function public\.friendship_interval_close\b/.test(mig), 'friendship_interval_close hâlâ tanımlı (dis-callable açık)');
  // Aralık aç/kapat mantığı YALNIZ trigger fonksiyonunun içinde (inline).
  assert(/friendship_intervals_sync[\s\S]*?insert into public\.friendship_intervals[\s\S]*?update public\.friendship_intervals\s+set ended_at/.test(mig),
    'aralık aç/kapat mantığı trigger içine alınmamış');
  // Trigger fonksiyonu istemciye kapalı (execute revoke).
  assert(/revoke all on function public\.friendship_intervals_sync\(\) from authenticated/.test(mig), 'friendship_intervals_sync authenticated\'a açık');
  // Blocker 2: sahiplik token'ı — kolon + claim döndürür + complete/fail token alır.
  assert(/claim_token uuid/.test(mig), 'claim_token kolonu yok');
  assert(/returns table \(outcome text, result jsonb, claim_token uuid\)/.test(mig), 'claim claim_token döndürmüyor');
  assert(/complete_workout_analysis\(\s*target_user uuid, target_session uuid, target_token uuid, analysis jsonb\s*\)/.test(mig), 'complete token parametresi almıyor');
  assert(/fail_workout_analysis\(target_user uuid, target_session uuid, target_token uuid\)/.test(mig), 'fail token parametresi almıyor');
  // complete/fail sorguları status='generating' VE doğru token'ı birlikte zorlar.
  assert(/status = 'completed'[\s\S]*?and status = 'generating' and claim_token = target_token/.test(mig), 'complete token+generating eşleşmesini zorlamıyor');
  assert(/status = 'failed'[\s\S]*?and status = 'generating' and claim_token = target_token/.test(mig), 'fail token+generating eşleşmesini zorlamıyor');
  // Blocker 1 ACL denetimi migrationda mevcut (apply anında güvenlik yüzeyini doğrular).
  assert(/ACL AUDIT FAIL/.test(mig), 'ACL denetim bloğu yok');
  assert(/has_function_privilege\('authenticated'/.test(mig), 'ACL denetimi authenticated iznini kontrol etmiyor');
  // GENEL denetim: ön-snapshot ile bu migrationın YENİ security-definer fonksiyonlarını
  // kapsar (listeye eklenmemiş yeni fonksiyon apply anında yakalanır).
  assert(/_career_pre_secdef/.test(mig), 'security-definer ön-snapshot (genel denetim) yok');
  assert(/unexpected security-definer function/.test(mig), 'listeye eklenmemiş fonksiyon denetimi yok');
  assert(/has_function_privilege\('public'/.test(mig), 'PUBLIC EXECUTE sızıntı denetimi yok');
  // TABLO/KOLON GÖRÜNÜRLÜĞÜ: claim_token/lease/status istemciden gizli.
  assert(/has_table_privilege\('authenticated', 'public\.ai_workout_analyses', 'SELECT'\)/.test(mig), 'tablo görünürlük denetimi yok');
  assert(/has_column_privilege\('authenticated', 'public\.ai_workout_analyses'/.test(mig), 'kolon görünürlük denetimi yok');
  assert(/claim_token[\s\S]{0,120}lease_expires_at[\s\S]{0,60}status|'claim_token', 'lease_expires_at', 'status'/.test(mig),
    'claim_token/lease/status kolon denetimi eksik');
});

check('8. EKONOMİ YOK: migration RP/XP/roses tablolarına yazmaz; sezon sistemi korunur', () => {
  assert(!/insert into public\.(reward_ledger|user_progress|user_season_ranks|rank_events)/.test(mig), 'ekonomi tablosuna yazım var');
  assert(!/update public\.(user_progress|user_season_ranks)/.test(mig), 'ekonomi tablosu güncelleniyor');
  // Sezon başarı sistemine dokunulmaz (silme/drop yok). (Statement-sınırlı: başka bir
  // `drop table` ifadesi ile aynı satırda olmayan season tablosunu yanlış eşlemesin.)
  assert(!/drop\s+table[^;]*season_rank_achievements/i.test(mig + backfill + showcase), 'sezon tablosu drop ediliyor');
});

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ Kariyer başarımları harness: ${passed} kontrol geçti (SQL↔istemci parite + güvenlik yüzeyi).`);
console.log('  (Gerçek RPC davranışı izole PostgreSQL + RLS/JWT authz testlerinde çalıştırıldı.)');

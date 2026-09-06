#!/usr/bin/env node
/**
 * PROFİL KATALOG İKONLARI — ASSET + PAYLAŞILAN BİLEŞEN SÖZLEŞMESİ HARNESS'I
 *
 * Profilin en altındaki katalog satırlarının iki yeni ikonunu doğrular:
 *   · Disiplin → `profile-discipline-helmet.png` (yandan miğfer silueti),
 *   · Arkadaşlar → `profile-friends-rosea.png` (merkez-önde üçlü Rosea).
 *
 * İki katman denetlenir:
 *   1) ASSET: kare 384×384, RGBA (colorType 6), GERÇEK alfa (dış alan tümüyle
 *      şeffaf + iç içerik var), TEK RENK BEYAZ maske (opak pikseller ~beyaz),
 *      makul dosya boyutu. PNG, Node `zlib` ile açılıp ters süzülür — görüntü
 *      kütüphanesi bağımlılığı YOKTUR.
 *   2) ENTEGRASYON: Disiplin ve Arkadaşlar aynı paylaşılan `ProfileCatalogIcon`
 *      bileşenini doğru asset anahtarı + tema tokenı + 22–24 pt ölçüyle kullanır;
 *      ikon daire/disk/çerçeve içine alınmaz; Aktif Program DEĞİŞMEZ.
 *
 * Canlı render YOKTUR: dosyalar ve kaynaklar statik denetlenir.
 */
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (p) => readFileSync(join(ROOT, p), 'utf8');
const ASSET_DIR = 'assets/profile-catalog';

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

// Disiplin miğferi KARE (384²) ve DEĞİŞMEZ. Arkadaşlar, kullanıcının orijinal
// YATAY çoklu Rosea çizimidir — kare DEĞİL (kare kutuya sıkışınca karakterler
// küçülüyordu). Her asset kendi biçim sözleşmesiyle denetlenir.
const ASSET_SPECS = {
  'profile-discipline-helmet.png': { shape: 'square', px: 384 },
  'profile-friends-rosea.png': { shape: 'landscape' },
};
const MAX_FILE_BYTES = 160 * 1024; // ~gerçek maks 53 KB; optimize edilmemiş dönüşü yakalar

/** colorType 6 (RGBA/8-bit/interlace 0) PNG'yi ham RGBA baytlarına çözer. */
function decodeRGBA(buf) {
  assert(buf.toString('hex', 0, 8) === '89504e470d0a1a0a', 'PNG imzası yok');
  let width = 0;
  let height = 0;
  let colorType = -1;
  let bitDepth = -1;
  let interlace = -1;
  const idat = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  assert(colorType === 6 && bitDepth === 8 && interlace === 0, 'yalnız 8-bit RGBA/interlace0 desteklenir');
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[pos + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0; // sol
      const b = y > 0 ? out[(y - 1) * stride + x] : 0; // üst
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0; // sol-üst
      let val;
      switch (filter) {
        case 0: val = rawByte; break;
        case 1: val = rawByte + a; break;
        case 2: val = rawByte + b; break;
        case 3: val = rawByte + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          val = rawByte + pr;
          break;
        }
        default: throw new Error(`bilinmeyen PNG filtresi ${filter}`);
      }
      out[y * stride + x] = val & 0xff;
    }
    pos += stride;
  }
  return { width, height, data: out };
}

for (const [file, spec] of Object.entries(ASSET_SPECS)) {
  check(`ASSET ${file}: imza + IHDR (${spec.shape}) + RGBA`, () => {
    const b = readFileSync(join(ROOT, ASSET_DIR, file));
    assert(b.toString('hex', 0, 8) === '89504e470d0a1a0a', 'PNG imzası yok');
    assert(b.toString('ascii', 12, 16) === 'IHDR', 'IHDR ilk chunk değil');
    const w = b.readUInt32BE(16);
    const h = b.readUInt32BE(20);
    assert(b[25] === 6, `RGBA (colorType 6) değil (${b[25]})`);
    if (spec.shape === 'square') {
      // Disiplin miğferi: kare ve sabit ölçü (beğenildi, değişmez).
      assert(w === spec.px && h === spec.px, `Disiplin ${spec.px}² değil (${w}×${h})`);
    } else {
      // Arkadaşlar: kullanıcının orijinal YATAY çoklu Rosea kompozisyonu — kare DEĞİL.
      assert(w > h, `Arkadaşlar yatay değil (${w}×${h})`);
      assert(w / h >= 1.6, `Arkadaşlar yeterince yatay değil (oran ${(w / h).toFixed(2)})`);
      assert(w >= 256 && w <= 1200 && h >= 96 && h <= 512, `Arkadaşlar boyutu makul aralıkta değil (${w}×${h})`);
      // ai-coach-mascot.png 256×256 KARE'dir; reddedilen o kaynaktan türeme olmamalı.
      assert(!(w === 256 && h === 256), 'Arkadaşlar asset ölçüsü ai-coach-mascot (256²) ile aynı — reddedilen kaynak olabilir');
    }
    assert(b.length <= MAX_FILE_BYTES, `fazla büyük (${(b.length / 1024).toFixed(0)} KB > ${MAX_FILE_BYTES / 1024} KB)`);
  });

  check(`ASSET ${file}: gerçek alfa + şeffaf dış çerçeve + tek renk beyaz maske`, () => {
    const { width, height, data } = decodeRGBA(readFileSync(join(ROOT, ASSET_DIR, file)));
    const A = (x, y) => data[(y * width + x) * 4 + 3];
    // Dış çerçeve (en dış 4 px halka) tümüyle şeffaf olmalı — glow/kare zemin yok.
    let borderMax = 0;
    for (let x = 0; x < width; x += 1) {
      for (const y of [0, 1, 2, 3, height - 1, height - 2, height - 3, height - 4]) borderMax = Math.max(borderMax, A(x, y));
    }
    for (let y = 0; y < height; y += 1) {
      for (const x of [0, 1, 2, 3, width - 1, width - 2, width - 3, width - 4]) borderMax = Math.max(borderMax, A(x, y));
    }
    assert(borderMax === 0, `dış çerçeve şeffaf değil (maks alfa ${borderMax}) — kare zemin/glow olabilir`);
    // Gerçek alfa: hem tümüyle şeffaf hem tümüyle opak pikseller bulunmalı.
    let transparent = 0;
    let opaque = 0;
    let coverage = 0;
    let whiteOpaque = 0;
    for (let i = 0; i < width * height; i += 1) {
      const a = data[i * 4 + 3];
      if (a === 0) transparent += 1;
      if (a >= 250) {
        opaque += 1;
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const bch = data[i * 4 + 2];
        if (r >= 245 && g >= 245 && bch >= 245) whiteOpaque += 1;
      }
      if (a > 76) coverage += 1;
    }
    const total = width * height;
    assert(transparent > total * 0.4, 'yeterli şeffaf alan yok (alfa maske değil)');
    assert(opaque > total * 0.01, 'opak içerik yok (boş maske)');
    const cov = (coverage / total) * 100;
    assert(cov >= 4 && cov <= 40, `kaplama sağlıklı aralıkta değil (${cov.toFixed(1)}%)`);
    // Tek renk beyaz: opak piksellerin ezici çoğunluğu beyaz (tintColor ile boyanacak).
    assert(whiteOpaque / opaque > 0.98, `opak pikseller tek renk beyaz değil (${((whiteOpaque / opaque) * 100).toFixed(1)}%)`);
  });
}

// ---------------------------------------------------------------------------
// PAYLAŞILAN BİLEŞEN SÖZLEŞMESİ
// ---------------------------------------------------------------------------
check('Paylaşılan ProfileCatalogIcon: Image + contain + tint prop + dekoratif + zeminsiz', () => {
  const raw = source('components/profile-catalog-icon.tsx');
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert(/from 'react-native'/.test(code) && /\bImage\b/.test(code), 'react-native Image kullanmıyor');
  assert(/resizeMode="contain"/.test(code), 'resizeMode contain değil');
  assert(/tintColor: color/.test(code), 'tintColor prop tema renginden gelmiyor');
  // Geriye uyumlu ölçü: kare `size` (Disiplin) VEYA ayrı `width`/`height` (yatay Arkadaşlar).
  assert(/width \?\? size/.test(code) && /height \?\? size/.test(code), 'kare `size` ile dikdörtgen `width`/`height` birlikte desteklenmiyor');
  assert(/width: w/.test(code) && /height: h/.test(code), 'çözülen genişlik/yükseklik stile uygulanmıyor');
  // Asset anahtarları doğru dosyalara bağlı; reddedilen ai-coach-mascot KULLANILMAZ.
  assert(/discipline:\s*require\('@\/assets\/profile-catalog\/profile-discipline-helmet\.png'\)/.test(code), 'discipline anahtarı yanlış');
  assert(/friends:\s*require\('@\/assets\/profile-catalog\/profile-friends-rosea\.png'\)/.test(code), 'friends anahtarı yanlış');
  assert(!/ai-coach-mascot/.test(raw), 'Arkadaşlar ikonu reddedilen ai-coach-mascot kaynağına bağlanmış');
  // Dekoratif + a11y'den gizli.
  assert(/accessibilityElementsHidden/.test(code), 'sembol erişilebilirlikten gizlenmemiş');
  assert(/importantForAccessibility="no-hide-descendants"/.test(code), 'sembol a11y ağacından çıkarılmamış');
  // Zemin/çerçeve/daire/gradient/glow/gölge/sabit renk YOK.
  assert(!/backgroundColor/.test(code), 'bileşende arka plan var');
  assert(!/border(Width|Color|Radius)/.test(code), 'bileşende çerçeve/daire var');
  assert(!/gradient|LinearGradient/i.test(code), 'bileşende gradient var');
  assert(!/shadow(Color|Opacity|Radius|Offset)|elevation:|glow/i.test(code), 'bileşende gölge/glow var');
  assert(!/'#[0-9A-Fa-f]{3,8}'/.test(code), 'bileşende sabit hex renk var (tema dışı)');
});

check('Disiplin (kompakt) yeni miğfer ikonunu doğru token + ölçüyle kullanır', () => {
  const raw = source('components/profile-discipline-card.tsx');
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert(/from '@\/components\/profile-catalog-icon'/.test(code), 'ProfileCatalogIcon import edilmemiş');
  const tag = code.match(/<ProfileCatalogIcon\b[^>]*\/>/)?.[0];
  assert(tag, 'Disiplin kartı ProfileCatalogIcon render etmiyor');
  assert(/name="discipline"/.test(tag), 'Disiplin ikonu name="discipline" değil');
  assert(/color=\{colors\.text\}/.test(tag), 'Disiplin ikonu mevcut tema tokenını (colors.text) kullanmıyor');
  const size = Number(tag.match(/size=\{(\d+)\}/)?.[1]);
  assert(size >= 22 && size <= 24, `Disiplin ikon ölçüsü 22–24 pt dışında (${size})`);
  assert(!/name="sunny-outline"/.test(code), 'eski sunny-outline ikonu hâlâ duruyor');
  // İkon kabı daire/disk/çerçeve DEĞİL.
  const box = /compactIcon: \{([\s\S]*?)\}/.exec(code)?.[1] ?? '';
  assert(!/border(Width|Color|Radius)/.test(box), 'Disiplin ikonu hâlâ daire/çerçeve içinde');
  assert(!/backgroundColor/.test(box), 'Disiplin ikon kabında disk/arka plan var');
  assert(/height: 48/.test(box) && /width: 48/.test(box), 'ikon kabı hizası/dokunma alanı (48) korunmamış');
});

check('Aktif Program ikonu DEĞİŞMEZ (bu görevin dışında)', () => {
  const program = source('components/profile-shared-program.tsx');
  // Aktif Program hâlâ kendi Ionicons kompakt ikonunu kullanır; katalog ikonuna geçmemiştir.
  assert(!/ProfileCatalogIcon/.test(program), 'Aktif Program yeni katalog ikonuna geçmiş (kapsam dışı)');
  assert(/from '@expo\/vector-icons'/.test(program), 'Aktif Program Ionicons ikonunu kaybetmiş');
});

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ Profil katalog ikonları harness: ${passed} kontrol geçti.`);
console.log('  (Asset PNG\'leri zlib ile çözüldü; canlı render yok — kaynaklar statik denetlendi.)');

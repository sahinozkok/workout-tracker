import { fetch as expoFetch } from 'expo/fetch';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export const PROFILE_IMAGE_BUCKET = 'avatars';
export const MAX_PROFILE_IMAGE_BYTES = 20 * 1024 * 1024;

export type ProfileImageKind = 'avatar' | 'banner';

export type PickedImage = {
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  uri: string;
};

export type UploadedProfileImage = {
  /** Storage içindeki tam yol: `${userId}/${kind}/${timestamp}.${ext}` */
  path: string;
  publicUrl: string;
};

/** Çalıştırılabilir içerik ve SVG bilerek kabul edilmez. */
const MIME_EXTENSIONS: Record<string, string> = {
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const EXTENSION_MIME: Record<string, string> = {
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/x-gif': 'image/gif',
};

/** UI tarafında çevrilebilmesi için hata kodlarıyla çalışılır. */
export type ProfileMediaErrorCode =
  | 'emptyFile'
  | 'readFailed'
  | 'tooLarge'
  | 'unsupportedType'
  | 'uploadFailed';

export class ProfileMediaError extends Error {
  code: ProfileMediaErrorCode;

  constructor(code: ProfileMediaErrorCode) {
    super(code);
    this.code = code;
    this.name = 'ProfileMediaError';
  }
}

function getExtension(value: string | null | undefined) {
  if (!value) return undefined;
  const cleanValue = value.split('?')[0].split('#')[0];
  const match = cleanValue.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLocaleLowerCase('en-US') : undefined;
}

/** Dosyanın gerçek türünü belirler; GIF'in JPEG'e dönüşmemesi buna bağlıdır. */
export function resolveMimeType(asset: PickedImage) {
  const rawDeclaredMime = asset.mimeType?.toLocaleLowerCase('en-US');
  const declaredMime = rawDeclaredMime ? (MIME_ALIASES[rawDeclaredMime] ?? rawDeclaredMime) : undefined;
  if (declaredMime && MIME_EXTENSIONS[declaredMime]) return declaredMime;

  const extension = getExtension(asset.fileName) ?? getExtension(asset.uri);
  if (extension && EXTENSION_MIME[extension]) return EXTENSION_MIME[extension];

  return declaredMime?.startsWith('image/') ? declaredMime : 'image/jpeg';
}

/** Galeri metadata'sı yanlış olsa bile yaygın görsel türlerini içerikten tanır. */
function detectMimeType(fileData: ArrayBuffer) {
  const bytes = new Uint8Array(fileData, 0, Math.min(fileData.byteLength, 12));
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return undefined;
}

export function isAnimatedImage(asset: PickedImage) {
  return resolveMimeType(asset) === 'image/gif';
}

/** Supabase Storage, React Native'de Blob yerine ArrayBuffer bekler. */
async function readAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const response = Platform.OS === 'web' ? await fetch(uri) : await expoFetch(uri);
  if (!response.ok) throw new ProfileMediaError('readFailed');

  try {
    return await response.arrayBuffer();
  } catch {
    throw new ProfileMediaError('readFailed');
  }
}

/**
 * Görseli kullanıcının kendi klasöründe **benzersiz** bir yola yükler.
 * Eski dosya burada silinmez: temizlik yalnızca yeni URL veritabanına
 * yazıldıktan sonra çağıran tarafından yapılır.
 */
export async function uploadProfileImage(
  userId: string,
  kind: ProfileImageKind,
  asset: PickedImage,
): Promise<UploadedProfileImage> {
  if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_PROFILE_IMAGE_BYTES) {
    throw new ProfileMediaError('tooLarge');
  }

  const fileData = await readAsArrayBuffer(asset.uri);
  if (!fileData.byteLength) throw new ProfileMediaError('emptyFile');
  if (fileData.byteLength > MAX_PROFILE_IMAGE_BYTES) throw new ProfileMediaError('tooLarge');

  const mimeType = detectMimeType(fileData) ?? resolveMimeType(asset);
  const extension = MIME_EXTENSIONS[mimeType];
  if (!extension) throw new ProfileMediaError('unsupportedType');

  // Her yükleme yeni bir dosya adı alır; sabit yol + upsert kaynaklı önbellek
  // karışıklığı ve "yeni yüklendi ama eski görünüyor" durumu ortadan kalkar.
  const path = `${userId}/${kind}/${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from(PROFILE_IMAGE_BUCKET).upload(path, fileData, {
    cacheControl: '3600',
    contentType: mimeType,
    upsert: false,
  });

  if (error) throw new ProfileMediaError('uploadFailed');

  const { data } = supabase.storage.from(PROFILE_IMAGE_BUCKET).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

/**
 * Public URL'den Storage yolunu çıkarır. Yalnızca bu projenin `avatars`
 * bucket adresleri ve **yalnızca ilgili kullanıcının klasörü** kabul edilir;
 * böylece başka kullanıcıların dosyaları hiçbir koşulda hedeflenemez.
 */
export function getStoragePathFromUrl(url: string | undefined, userId: string) {
  if (!url || !/^https?:\/\//i.test(url)) return undefined;

  let pathname: string;
  try {
    // Query parametreleri (ör. ?v=…) URL ayrıştırıcısıyla güvenli biçimde ayrılır.
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }

  const marker = `/storage/v1/object/public/${PROFILE_IMAGE_BUCKET}/`;
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex === -1) return undefined;

  const rawPath = pathname.slice(markerIndex + marker.length);
  if (!rawPath) return undefined;

  const decodedPath = decodeURIComponent(rawPath);
  if (decodedPath.includes('..')) return undefined;
  if (!decodedPath.startsWith(`${userId}/`)) return undefined;

  return decodedPath;
}

/** Belirtilen Storage yollarını siler; hata durumunda sessizce geçilir. */
export async function removeProfileImagePaths(paths: (string | undefined)[], userId: string) {
  const safePaths = paths.filter(
    (path): path is string => Boolean(path) && (path as string).startsWith(`${userId}/`),
  );
  if (safePaths.length === 0) return;

  await supabase.storage.from(PROFILE_IMAGE_BUCKET).remove(safePaths).catch(() => undefined);
}

export function isRemoteImageUrl(value: string | undefined) {
  return Boolean(value && /^https?:\/\//i.test(value));
}

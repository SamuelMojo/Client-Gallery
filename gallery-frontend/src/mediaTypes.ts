// Single source of truth for which files the gallery accepts.
// The upload Lambda must enforce the same allowlist: this file is only a convenience for the browser.

export type MediaKind = 'image' | 'raw' | 'video';

const EXT_TO_MIME: Record<string, { kind: MediaKind; mime: string }> = {
  // Photos
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  png: { kind: 'image', mime: 'image/png' },
  webp: { kind: 'image', mime: 'image/webp' },
  gif: { kind: 'image', mime: 'image/gif' },
  avif: { kind: 'image', mime: 'image/avif' },
  tif: { kind: 'image', mime: 'image/tiff' },
  tiff: { kind: 'image', mime: 'image/tiff' },
  heic: { kind: 'image', mime: 'image/heic' },
  heif: { kind: 'image', mime: 'image/heif' },
  // RAW (stored and downloadable; no browser preview)
  arw: { kind: 'raw', mime: 'image/x-sony-arw' },
  cr2: { kind: 'raw', mime: 'image/x-canon-cr2' },
  cr3: { kind: 'raw', mime: 'image/x-canon-cr3' },
  nef: { kind: 'raw', mime: 'image/x-nikon-nef' },
  dng: { kind: 'raw', mime: 'image/x-adobe-dng' },
  raf: { kind: 'raw', mime: 'image/x-fuji-raf' },
  // Video
  mp4: { kind: 'video', mime: 'video/mp4' },
  mov: { kind: 'video', mime: 'video/quicktime' },
  m4v: { kind: 'video', mime: 'video/x-m4v' },
  webm: { kind: 'video', mime: 'video/webm' },
};
// Deliberately absent: svg (can run script when served from our domain).

export const MAX_BYTES: Record<MediaKind, number> = {
  image: 100 * 1e6,
  raw: 150 * 1e6,
  video: 5 * 1e9, // S3 single-PUT limit
};

export const MAX_FILES_PER_GALLERY = 500;

/**
 * Value for <input accept>. The image/* and video/* wildcards make the OS file dialog (notably macOS)
 * enable every photo and video; the extensions add HEIC and RAW, which browsers often leave untyped.
 * Anything unsupported that slips through (e.g. .svg, .mkv) is rejected by validateFiles with a reason.
 */
export const ACCEPT_ATTR = [
  'image/*',
  'video/*',
  ...Object.keys(EXT_TO_MIME).map((ext) => `.${ext}`),
].join(',');

export function extOf(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i === -1 ? '' : fileName.slice(i + 1).toLowerCase();
}

/** Classify by extension: file.type is unreliable for HEIC and RAW. */
export function kindOf(fileName: string): MediaKind | null {
  return EXT_TO_MIME[extOf(fileName)]?.kind ?? null;
}

/** Prefer the browser's type; fall back to our map when it is empty. */
export function contentTypeFor(file: { name: string; type: string }): string {
  return file.type || EXT_TO_MIME[extOf(file.name)]?.mime || 'application/octet-stream';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

export interface RejectedFile {
  name: string;
  reason: string;
}

export interface ValidationResult {
  accepted: File[];
  rejected: RejectedFile[];
}

/**
 * Splits a selection into acceptable files and rejected ones with a reason.
 * Duplicate names are rejected because the upload API matches presigned URLs by file name.
 */
export function validateFiles(list: File[], alreadySelected: File[] = []): ValidationResult {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];
  const seen = new Set(alreadySelected.map((f) => f.name));

  for (const file of list) {
    const kind = kindOf(file.name);
    if (!kind) {
      rejected.push({ name: file.name, reason: 'Unsupported file type' });
    } else if (file.size === 0) {
      rejected.push({ name: file.name, reason: 'File is empty' });
    } else if (file.size > MAX_BYTES[kind]) {
      rejected.push({
        name: file.name,
        reason: `Too large (${formatBytes(file.size)}, limit ${formatBytes(MAX_BYTES[kind])})`,
      });
    } else if (seen.has(file.name)) {
      rejected.push({ name: file.name, reason: 'Another file with this name is already selected' });
    } else if (alreadySelected.length + accepted.length >= MAX_FILES_PER_GALLERY) {
      rejected.push({ name: file.name, reason: `Limit of ${MAX_FILES_PER_GALLERY} files per gallery` });
    } else {
      seen.add(file.name);
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}

/**
 * Maps a key to something an <img> can show. A video's web version is `<name>_web.mp4`; the poster
 * frame MediaConvert writes next to it is `<name>_poster.0000000.jpg`. Other keys are returned as is.
 */
export function stillKeyFor(key: string): string {
  return key.replace(/_web\.mp4$/i, '_poster.0000000.jpg');
}

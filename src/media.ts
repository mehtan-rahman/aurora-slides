// Images, videos and image sequences: lookup (\graphicspath, implicit
// extensions), conversion (PDF/EPS → PNG) and embedding as data URIs.
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { resolve, extname, relative, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

export const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif' };
export const VIDEO_MIME: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
const GRAPHIC_EXTS = ['.pdf', '.png', '.jpg', '.jpeg', '.svg', '.eps', '.gif', '.webp', '.PNG', '.JPG', '.PDF'];

/** Videos above this size are linked by relative path instead of embedded. */
const EMBED_LIMIT = 40 * 1024 * 1024;

/** Finds a graphic the way graphicx does: as given, with \graphicspath prefixes, with implicit extensions. */
export function findFile(name: string, baseDir: string, searchPath: string[] = [], exts = GRAPHIC_EXTS): string | null {
  const n = name.trim().replace(/^"|"$/g, '');
  for (const dir of ['', ...searchPath]) {
    const base = resolve(baseDir, dir, n);
    if (extname(n) && existsSync(base) && statSync(base).isFile()) return base;
    for (const e of exts) if (existsSync(base + e)) return base + e;
    if (existsSync(base) && statSync(base).isFile()) return base;
  }
  return null;
}

const cacheDir = join(tmpdir(), 'aurora-media-cache');

function tryRun(cmd: string, args: string[]): boolean {
  try { execFileSync(cmd, args, { stdio: 'ignore', timeout: 60000 }); return true; } catch { return false; }
}

/** PDF/EPS page → transparent PNG via Ghostscript (or macOS `sips` for PDF). */
export function rasterize(file: string, page: number): string | null {
  const hash = createHash('sha1').update(readFileSync(file)).update(String(page)).digest('hex').slice(0, 16);
  mkdirSync(cacheDir, { recursive: true });
  const out = join(cacheDir, `${hash}.png`);
  if (existsSync(out)) return out;
  const eps = /\.e?ps$/i.test(file);
  if (tryRun('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=pngalpha', '-r220', '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
    ...(eps ? ['-dEPSCrop'] : [`-dFirstPage=${page}`, `-dLastPage=${page}`, '-dUseCropBox']), `-sOutputFile=${out}`, file]) && existsSync(out)) return out;
  if (!eps && page === 1 && process.platform === 'darwin' && tryRun('sips', ['-s', 'format', 'png', file, '--out', out]) && existsSync(out)) return out;
  return null;
}

/**
 * Natural size of an image in big points (1/72 in), the way pdflatex sizes it: PNG and
 * JPEG use their stored resolution (72 dpi when there is none), SVG px are 0.75 bp, and
 * our PDF/EPS rasters are 220 dpi.
 */
export function naturalSize(buf: Buffer, ext: string, rasterDpi?: number): [number, number] | null {
  try {
    if (ext === '.png' && buf.toString('ascii', 1, 4) === 'PNG') {
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
      let dpiX = rasterDpi ?? 72, dpiY = rasterDpi ?? 72;
      for (let o = 8; o + 8 < buf.length && !rasterDpi;) {
        const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8);
        if (type === 'pHYs' && buf[o + 16] === 1) { dpiX = buf.readUInt32BE(o + 8) * 0.0254; dpiY = buf.readUInt32BE(o + 12) * 0.0254; break; }
        if (type === 'IDAT') break;
        o += 12 + len;
      }
      return [(w * 72) / dpiX, (h * 72) / dpiY];
    }
    if ((ext === '.jpg' || ext === '.jpeg') && buf[0] === 0xff && buf[1] === 0xd8) {
      let dpiX = 72, dpiY = 72;
      for (let o = 2; o + 9 < buf.length;) {
        if (buf[o] !== 0xff) { o++; continue; }
        const marker = buf[o + 1], len = buf.readUInt16BE(o + 2);
        if (marker === 0xe0 && buf.toString('ascii', o + 4, o + 9) === 'JFIF\0') {
          const unit = buf[o + 11], x = buf.readUInt16BE(o + 12), y = buf.readUInt16BE(o + 14);
          if (unit === 1 && x && y) { dpiX = x; dpiY = y; } else if (unit === 2 && x && y) { dpiX = x * 2.54; dpiY = y * 2.54; }
        }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const h = buf.readUInt16BE(o + 5), w = buf.readUInt16BE(o + 7);
          return [(w * 72) / dpiX, (h * 72) / dpiY];
        }
        o += 2 + len;
      }
      return null;
    }
    if (ext === '.gif' && buf.toString('ascii', 0, 3) === 'GIF') return [buf.readUInt16LE(6), buf.readUInt16LE(8)];
    if (ext === '.svg') {
      const head = buf.toString('utf8', 0, 4000);
      const tag = /<svg\b[^>]*>/.exec(head)?.[0] ?? '';
      const len = (a: string) => { const m = new RegExp(`\\b${a}\\s*=\\s*["']([\\d.]+)(px|pt|cm|mm|in)?["']`).exec(tag); if (!m) return null; const f = { px: 0.75, pt: 0.99626, cm: 28.3465, mm: 2.83465, in: 72 }[(m[2] ?? 'px') as 'px']; return +m[1] * f; };
      const w = len('width'), h = len('height');
      if (w && h) return [w, h];
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(tag);
      if (vb) return [+vb[1] * 0.75, +vb[2] * 0.75];
    }
  } catch { /* malformed header */ }
  return null;
}

export type Graphic = { uri: string; file: string; bp: [number, number] | null } | { error: string };

/** A graphic as a data URI; PDF and EPS are rasterized (page = 1-based PDF page). */
export function graphicUri(name: string, baseDir: string, searchPath: string[] = [], page = 1): Graphic {
  const file = findFile(name, baseDir, searchPath);
  if (!file) return { error: 'not found' };
  let src = file, dpi: number | undefined;
  const ext = extname(file).toLowerCase();
  if (ext === '.pdf' || ext === '.eps' || ext === '.ps') {
    dpi = 220;
    const png = rasterize(file, page);
    if (!png) return { error: `cannot convert ${ext.slice(1).toUpperCase()} (install Ghostscript: \`gs\`)` };
    src = png;
  }
  const mime = IMAGE_MIME[extname(src).toLowerCase()];
  if (!mime) return { error: `unsupported format ${ext}` };
  const buf = readFileSync(src);
  return { uri: `data:${mime};base64,${buf.toString('base64')}`, file, bp: naturalSize(buf, extname(src).toLowerCase(), dpi) };
}

/** A video/audio file: embedded when small, else a path relative to the output. */
export function mediaUri(name: string, baseDir: string): { uri: string; mime: string; embedded: boolean } | null {
  const file = findFile(name, baseDir, [], Object.keys(VIDEO_MIME));
  if (!file) return null;
  const mime = VIDEO_MIME[extname(file).toLowerCase()] ?? 'video/mp4';
  if (statSync(file).size > EMBED_LIMIT) return { uri: relative(baseDir, file).split('\\').join('/'), mime, embedded: false };
  return { uri: `data:${mime};base64,${readFileSync(file).toString('base64')}`, mime, embedded: true };
}


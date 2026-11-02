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
function rasterize(file: string, page: number): string | null {
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

export type Graphic = { uri: string; file: string } | { error: string };

/** A graphic as a data URI; PDF and EPS are rasterized (page = 1-based PDF page). */
export function graphicUri(name: string, baseDir: string, searchPath: string[] = [], page = 1): Graphic {
  const file = findFile(name, baseDir, searchPath);
  if (!file) return { error: 'not found' };
  let src = file;
  const ext = extname(file).toLowerCase();
  if (ext === '.pdf' || ext === '.eps' || ext === '.ps') {
    const png = rasterize(file, page);
    if (!png) return { error: `cannot convert ${ext.slice(1).toUpperCase()} (install Ghostscript: \`gs\`)` };
    src = png;
  }
  const mime = IMAGE_MIME[extname(src).toLowerCase()];
  if (!mime) return { error: `unsupported format ${ext}` };
  return { uri: `data:${mime};base64,${readFileSync(src).toString('base64')}`, file };
}

/** A video/audio file: embedded when small, else a path relative to the output. */
export function mediaUri(name: string, baseDir: string): { uri: string; mime: string; embedded: boolean } | null {
  const file = findFile(name, baseDir, [], Object.keys(VIDEO_MIME));
  if (!file) return null;
  const mime = VIDEO_MIME[extname(file).toLowerCase()] ?? 'video/mp4';
  if (statSync(file).size > EMBED_LIMIT) return { uri: relative(baseDir, file).split('\\').join('/'), mime, embedded: false };
  return { uri: `data:${mime};base64,${readFileSync(file).toString('base64')}`, mime, embedded: true };
}


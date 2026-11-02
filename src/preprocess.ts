// Source-level preprocessing, before any parsing:
//  - \input / \include / \subfile / \import are spliced in (recursively),
//  - comments are stripped, but never inside verbatim-like environments or \verb,
//  - `comment` environments and \iffalse … \fi are dropped.
// Both steps keep an offset map so diagnostics can point at file:line.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';

/** Environments whose bodies are taken literally (no comments, no expansion). */
export const VERBATIM_ENVS = ['verbatim', 'verbatim*', 'Verbatim', 'BVerbatim', 'LVerbatim', 'lstlisting', 'minted', 'semiverbatim', 'alltt', 'comment'];

interface Segment { start: number; file: string; line: number }

export interface Source {
  /** Stripped, expanded text ready for parsing. */
  text: string;
  /** Maps an offset in `text` to its origin. `file` is relative to the main file's folder. */
  origin(offset: number): { file: string; line: number };
  /** Files read (main file first), for watch mode. */
  files: string[];
}

function findInputFile(name: string, dir: string): string | null {
  const base = resolve(dir, name.trim());
  for (const f of [base, base + '.tex']) if (existsSync(f) && !f.endsWith('/')) return f;
  return null;
}

/** True when `pos` sits after an unescaped `%` on its line. */
function inComment(src: string, pos: number): boolean {
  const ls = src.lastIndexOf('\n', pos - 1) + 1;
  const line = src.slice(ls, pos);
  return /(^|[^\\])(\\\\)*%/.test(line);
}

const INPUT_RE = /\\(input|include|subfile|import|subimport|inputfrom|subinputfrom)(?![A-Za-z])\s*\{([^}]*)\}(?:\s*\{([^}]*)\})?/g;

function expand(path: string, rootDir: string, depth: number, segs: Segment[], files: string[], out: { s: string }, warn: (m: string) => void) {
  let src = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
  if (depth > 0 && /\\documentclass/.test(src)) {
    // A subfile: keep only its document body.
    const b = src.indexOf('\\begin{document}');
    const e = src.indexOf('\\end{document}');
    if (b >= 0) {
      const bodyStart = b + '\\begin{document}'.length;
      const lineOff = src.slice(0, bodyStart).split('\n').length - 1;
      src = '\n'.repeat(lineOff) + src.slice(bodyStart, e < 0 ? undefined : e);
    }
  }
  files.push(path);
  const file = relative(rootDir, path) || path;
  const dir = dirname(path);
  let last = 0;
  const pushText = (from: number, to: number) => {
    if (to <= from) return;
    const line = src.slice(0, from).split('\n').length;
    segs.push({ start: out.s.length, file, line });
    out.s += src.slice(from, to);
  };
  const re = new RegExp(INPUT_RE.source, 'g');
  let m;
  const verbatimRanges = verbatimSpans(src);
  while ((m = re.exec(src))) {
    if (inComment(src, m.index) || verbatimRanges.some(([a, b]) => m!.index >= a && m!.index < b)) continue;
    const [all, cmd, a, b] = m;
    const isImport = /import|from/.test(cmd);
    if (isImport && b === undefined) continue;
    const target = isImport ? findInputFile(b!, resolve(dir, a)) : findInputFile(a, cmd === 'subfile' ? dir : rootDir) ?? findInputFile(a, dir);
    if (!target) { warn(`\\${cmd}{${isImport ? `${a}}{${b}` : a}}: file not found`); continue; }
    if (depth > 16 || files.includes(target) && depth > 8) { warn(`\\${cmd}{${a}}: nested too deeply`); continue; }
    pushText(last, m.index);
    expand(target, rootDir, depth + 1, segs, files, out, warn);
    last = m.index + all.length;
  }
  pushText(last, src.length);
}

/** [start, end) of every verbatim-like environment body in `src`. */
function verbatimSpans(src: string): [number, number][] {
  const out: [number, number][] = [];
  const re = new RegExp(`\\\\begin\\{(${VERBATIM_ENVS.map((e) => e.replace('*', '\\*')).join('|')})\\}`, 'g');
  let m;
  while ((m = re.exec(src))) {
    const end = src.indexOf(`\\end{${m[1]}}`, m.index + m[0].length);
    const stop = end < 0 ? src.length : end;
    out.push([m.index, stop]);
    re.lastIndex = stop;
  }
  return out;
}

/**
 * Strips comments TeX-style (`foo%\n  bar` → `foobar`) except inside verbatim
 * environments and inline verbatim; drops `comment` environments and `\iffalse…\fi`.
 * Returns the text plus anchors mapping output offsets back to input offsets.
 */
export function stripCommentsMapped(src: string): { text: string; anchors: [number, number][] } {
  let out = '';
  const anchors: [number, number][] = [[0, 0]];
  let i = 0;
  const jumpTo = (j: number) => { i = j; anchors.push([out.length, i]); };
  const verbEnvs = new RegExp(`^\\\\begin\\{(${VERBATIM_ENVS.map((e) => e.replace('*', '\\*')).join('|')})\\}`);
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      const rest = src.slice(i, i + 40);
      const venv = verbEnvs.exec(rest);
      if (venv) {
        const endTag = `\\end{${venv[1]}}`;
        const end = src.indexOf(endTag, i);
        const stop = end < 0 ? src.length : end + endTag.length;
        if (venv[1] === 'comment') { jumpTo(stop); continue; }
        out += src.slice(i, stop);
        i = stop;
        continue;
      }
      const iv = /^\\(verb\*?|lstinline(?:\[[^\]]*\])?|mintinline(?:\[[^\]]*\])?\{[^}]*\})(?![A-Za-z])/.exec(rest);
      if (iv) {
        let j = i + iv[0].length;
        const delim = src[j];
        if (delim && !/\s/.test(delim)) {
          const close = delim === '{' ? '}' : delim;
          const end = src.indexOf(close, j + 1);
          const stop = end < 0 ? src.length : end + 1;
          out += src.slice(i, stop);
          i = stop;
          continue;
        }
      }
      if (/^\\iffalse(?![A-Za-z])/.test(rest)) {
        // Skip to the matching \fi (nested \if… counted).
        let depth = 0, j = i;
        const re = /\\(if[A-Za-z]*|fi)(?![A-Za-z])/g;
        re.lastIndex = i;
        let m;
        while ((m = re.exec(src))) {
          if (m[1] === 'fi') { if (--depth === 0) { j = m.index + 3; break; } }
          else depth++;
        }
        jumpTo(m ? j : src.length);
        continue;
      }
      out += src.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === '%') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = src.length;
      else { j++; while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++; }
      jumpTo(j);
      continue;
    }
    out += c;
    i++;
  }
  return { text: out, anchors };
}

export function loadSource(mainPath: string, warn: (m: string) => void = () => {}): Source {
  const rootDir = dirname(mainPath);
  const segs: Segment[] = [];
  const files: string[] = [];
  const acc = { s: '' };
  expand(mainPath, rootDir, 0, segs, files, acc, warn);
  return fromExpanded(acc.s, segs, files);
}

/** Same as loadSource, for an in-memory string (tests, stdin). */
export function sourceFromString(src: string, file = 'deck.tex'): Source {
  return fromExpanded(src.replace(/\r\n?/g, '\n'), [{ start: 0, file, line: 1 }], []);
}

function fromExpanded(expanded: string, segs: Segment[], files: string[]): Source {
  const { text, anchors } = stripCommentsMapped(expanded);
  const toExpanded = (o: number) => {
    let lo = 0, hi = anchors.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (anchors[mid][0] <= o) lo = mid; else hi = mid - 1; }
    return anchors[lo][1] + (o - anchors[lo][0]);
  };
  return {
    text,
    files,
    origin(offset: number) {
      const e = toExpanded(offset);
      let seg = segs[0] ?? { start: 0, file: 'deck.tex', line: 1 };
      for (const s of segs) { if (s.start <= e) seg = s; else break; }
      const line = seg.line + (expanded.slice(seg.start, e).match(/\n/g)?.length ?? 0);
      return { file: seg.file, line };
    },
  };
}

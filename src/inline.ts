// Inline LaTeX → HTML, plus the per-frame step (overlay) bookkeeping.
import { Reader } from './reader.ts';
import { texToSvg } from './math.ts';

export interface Macro { nargs: number; body: string }

export interface Ctx {
  steps: Steps;
  colors: Record<string, string>;
  macros: Record<string, Macro>;
  warn: (msg: string) => void;
  baseDir: string;
  /** Preamble subset used when a fragment is compiled with real LaTeX. */
  latexPreamble?: string;
  latexTheme?: 'dark' | 'light';
}

/**
 * Beamer's `beamerpauses` model. `cur` is the slide number from which
 * un-annotated content is visible; `counter` feeds `+` in overlay specs.
 * Numbers are beamer-style (1-based) and compacted later by `compact()`.
 */
export class Steps {
  counter = 1;
  cur = 1;
  used = new Set<number>([1]);

  pause() { this.counter++; this.cur = this.counter; this.used.add(this.cur); }

  /** Parses `2-`, `3`, `2-4`, `+-`, `+`, `.-`, `-3`; returns [from, until?). */
  overlay(spec: string): { from: number; until?: number } {
    const first = spec.split(/[,|]/)[0].trim();
    const num = (s: string, dflt: number) => {
      if (s === '+') return this.counter++;
      if (s === '.') return Math.max(1, this.counter - 1);
      if (s === '') return dflt;
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : dflt;
    };
    let from: number, until: number | undefined;
    const dash = first.indexOf('-');
    if (dash < 0) {
      from = num(first, this.cur);
      until = from + 1;
    } else {
      from = num(first.slice(0, dash), 1);
      const end = first.slice(dash + 1).trim();
      until = end === '' ? undefined : num(end, from) + 1;
    }
    this.used.add(from);
    if (until !== undefined) this.used.add(until);
    return { from, until };
  }

  mark(n: number) { this.used.add(n); }

  /** Map of beamer slide number → dense 0-based step index. */
  compaction(): { map: (n: number) => number; count: number } {
    const sorted = [...this.used].sort((a, b) => a - b);
    const idx = new Map(sorted.map((n, i) => [n, i]));
    return { map: (n) => idx.get(n) ?? 0, count: sorted.length };
  }
}

export function stepAttrs(r: { from: number; until?: number }): string {
  return ` data-from="${r.from}"` + (r.until !== undefined ? ` data-until="${r.until}"` : '');
}

/** Rewrites raw beamer step numbers in emitted HTML to compacted indices. */
export function compactHtml(html: string, map: (n: number) => number): string {
  return html.replace(/data-((?:alert-)?(?:from|until))="(\d+)"/g, (_, k, n) => `data-${k}="${map(+n)}"`);
}

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const THEME_COLORS = ['blue', 'orange', 'red', 'teal', 'green', 'purple', 'yellow', 'white', 'black', 'gray', 'grey', 'muted', 'fg'];
const ALIASES: Record<string, string> = { green: 'teal', grey: 'muted', gray: 'muted', black: 'bg', cyan: 'blue', magenta: 'purple', violet: 'purple', brown: 'red' };

/** Beamer/xcolor colour expression → CSS colour. `blue!50` keeps the base. */
export function resolveColor(name: string, ctx: Pick<Ctx, 'colors'>): string {
  const n = name.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(n)) return n;
  const base = n.split('!')[0];
  if (ctx.colors[base]) return ctx.colors[base];
  const theme = ALIASES[base] ?? base;
  if (THEME_COLORS.includes(base) || theme !== base) return `var(--${theme})`;
  return base; // let CSS try it as a named colour
}

const WRAP: Record<string, [string, string]> = {
  textbf: ['<strong>', '</strong>'],
  textit: ['<em>', '</em>'],
  emph: ['<em>', '</em>'],
  textsl: ['<em>', '</em>'],
  underline: ['<u>', '</u>'],
  texttt: ['<code>', '</code>'],
  textsc: ['<span class="sc">', '</span>'],
  textsf: ['<span>', '</span>'],
  textrm: ['<span>', '</span>'],
  textup: ['<span>', '</span>'],
  textnormal: ['<span>', '</span>'],
  mbox: ['<span>', '</span>'],
  text: ['<span>', '</span>'],
  structure: ['<span class="structure">', '</span>'],
  textsuperscript: ['<sup>', '</sup>'],
  textsubscript: ['<sub>', '</sub>'],
};

const DECLS: Record<string, string> = {
  bfseries: 'b', itshape: 'i', slshape: 'i', ttfamily: 'tt', scshape: 'sc',
  tiny: 'sz-tiny', scriptsize: 'sz-script', footnotesize: 'sz-foot', small: 'sz-small',
  normalsize: '', large: 'sz-large', Large: 'sz-Large', LARGE: 'sz-LARGE', huge: 'sz-huge', Huge: 'sz-huge',
  upshape: '', mdseries: '', rmfamily: '', sffamily: '',
};

const SYMBOLS: Record<string, string> = {
  '%': '%', '&': '&amp;', '$': '$', '#': '#', '_': '_', '{': '{', '}': '}',
  ' ': ' ', ',': '&thinsp;', ';': '&ensp;', '!': '', '/': '', '-': '&shy;',
  ldots: '…', dots: '…', textbackslash: '\\', textasciitilde: '~', LaTeX: 'L<sup class="la">a</sup>T<sub class="te">e</sub>X', TeX: 'T<sub class="te">e</sub>X',
  quad: '&emsp;', qquad: '&emsp;&emsp;', enspace: '&ensp;', textbullet: '•', textendash: '–', textemdash: '—',
  copyright: '©', textregistered: '®', dag: '†', ddag: '‡', S: '§', P: '¶', checkmark: '✓',
  today: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
};

const IGNORE_WITH_ARG = new Set(['vspace', 'hspace', 'label', 'index', 'setlength', 'addtolength', 'phantom', 'hphantom', 'vphantom']);
const IGNORE = new Set(['centering', 'raggedright', 'raggedleft', 'noindent', 'indent', 'vfill', 'hfill', 'medskip', 'bigskip', 'smallskip', 'relax', 'protect', 'leavevmode', 'newline', 'linebreak', 'nobreak', 'strut', 'null', 'hline']);

export function mathHtml(tex: string, display = false): string {
  try {
    return `<span class="${display ? 'dm' : 'm'}">${texToSvg(tex.trim(), display)}</span>`;
  } catch (e) {
    return `<span class="err" title="${esc(String(e))}">${esc(tex)}</span>`;
  }
}

/** Substitutes `#1..#9` in a user macro body. */
export function expandMacro(r: Reader, m: Macro): string {
  let body = m.body;
  for (let i = 1; i <= m.nargs; i++) {
    const arg = r.readGroup();
    body = body.split(`#${i}`).join(arg);
  }
  return body;
}

export function inline(src: string, ctx: Ctx): string {
  const r = new Reader(src);
  let out = '';
  while (!r.done) {
    const c = r.peek();
    if (c === '$') {
      if (r.peek(1) === '$') { r.pos += 2; const end = src.indexOf('$$', r.pos); out += mathHtml(src.slice(r.pos, end), true); r.pos = end + 2; continue; }
      r.pos++;
      let end = r.pos;
      while (end < src.length && !(src[end] === '$' && src[end - 1] !== '\\')) end++;
      out += mathHtml(src.slice(r.pos, end));
      r.pos = end + 1;
      continue;
    }
    if (c === '{') { out += inline(r.readBalanced('{', '}'), ctx); continue; }
    if (c === '}') { r.pos++; continue; }
    if (c === '~') { out += '&nbsp;'; r.pos++; continue; }
    if (c === '-' && r.startsWith('---')) { out += '—'; r.pos += 3; continue; }
    if (c === '-' && r.startsWith('--')) { out += '–'; r.pos += 2; continue; }
    if (c === '`' && r.startsWith('``')) { out += '“'; r.pos += 2; continue; }
    if (c === "'" && r.startsWith("''")) { out += '”'; r.pos += 2; continue; }
    if (c === '`') { out += '‘'; r.pos++; continue; }
    if (c === "'") { out += '’'; r.pos++; continue; }
    if (c === '<') { out += '&lt;'; r.pos++; continue; }
    if (c === '>') { out += '&gt;'; r.pos++; continue; }
    if (c === '&') { out += '&amp;'; r.pos++; continue; }
    if (c === '\n') { out += ' '; r.pos++; continue; }
    if (c !== '\\') { out += c; r.pos++; continue; }

    if (r.startsWith('\\(')) { const end = src.indexOf('\\)', r.pos); out += mathHtml(src.slice(r.pos + 2, end)); r.pos = end + 2; continue; }
    if (r.startsWith('\\[')) { const end = src.indexOf('\\]', r.pos); out += mathHtml(src.slice(r.pos + 2, end), true); r.pos = end + 2; continue; }
    if (r.startsWith('\\\\')) { r.pos += 2; r.readStar(); r.readOptional(); out += '<br>'; continue; }

    const name = r.readCommandName();
    if (name === 'verb') {
      r.readStar();
      const delim = r.src[r.pos++];
      const end = src.indexOf(delim, r.pos);
      out += `<code>${esc(src.slice(r.pos, end))}</code>`;
      r.pos = end + 1;
      continue;
    }
    if (name in SYMBOLS) { out += SYMBOLS[name]; if (/^[A-Za-z]/.test(name)) r.skipSpace(false); continue; }
    if (ctx.macros[name]) { out += inline(expandMacro(r, ctx.macros[name]), ctx); continue; }
    if (name in WRAP) {
      const [o, cl] = WRAP[name];
      out += o + inline(r.readGroup(), ctx) + cl;
      continue;
    }
    if (name === 'alert') {
      const ov = r.readOverlay();
      const body = inline(r.readGroup(), ctx);
      // An overlaid \alert is visible throughout; only the highlight is timed.
      out += ov ? `<span class="alert-timed"${stepAttrs(ctx.steps.overlay(ov)).replace(/data-/g, 'data-alert-')}>${body}</span>` : `<span class="alert">${body}</span>`;
      continue;
    }
    if (name === 'textcolor') {
      const model = r.readOptional();
      const col = r.readGroup();
      const color = model ? `#${col.replace(/^#/, '')}` : resolveColor(col, ctx);
      out += `<span style="color:${color}">${inline(r.readGroup(), ctx)}</span>`;
      continue;
    }
    if (name === 'color') {
      const model = r.readOptional();
      const col = r.readGroup();
      const color = model ? `#${col.replace(/^#/, '')}` : resolveColor(col, ctx);
      out += `<span style="color:${color}">${inline(src.slice(r.pos), ctx)}</span>`;
      break;
    }
    if (name in DECLS) {
      const cls = DECLS[name];
      const rest = inline(src.slice(r.pos), ctx);
      out += cls ? `<span class="${cls}">${rest}</span>` : rest;
      break;
    }
    if (name === 'only' || name === 'uncover' || name === 'visible' || name === 'onslide' || name === 'invisible') {
      const ov = r.readOverlay();
      r.skipSpace();
      if (r.peek() !== '{') continue; // bare \onslide<..> switch: not supported inline
      const body = inline(r.readGroup(), ctx);
      if (!ov) { out += body; continue; }
      const range = ctx.steps.overlay(ov);
      out += `<span class="ov${name === 'only' ? ' only' : ''}"${stepAttrs(range)}>${body}</span>`;
      continue;
    }
    if (name === 'href') { const url = r.readGroup(); out += `<a href="${esc(url)}" target="_blank">${inline(r.readGroup(), ctx)}</a>`; continue; }
    if (name === 'url') { const url = r.readGroup(); out += `<a href="${esc(url)}" target="_blank"><code>${esc(url)}</code></a>`; continue; }
    if (name === 'footnote') { out += `<span class="fn">${inline(r.readGroup(), ctx)}</span>`; continue; }
    if (name === 'cite') { r.readOptional(); out += `<span class="cite">[${esc(r.readGroup())}]</span>`; continue; }
    if (name === 'pause') continue; // handled at block level; tolerate stray ones
    if (IGNORE_WITH_ARG.has(name)) { r.readStar(); r.readGroup(); continue; }
    if (IGNORE.has(name)) { r.skipSpace(false); continue; }
    if (name === 'par') { out += '<br>'; continue; }

    ctx.warn(`unsupported inline command \\${name}; rendering its arguments`);
    r.readOverlay();
    r.readOptional();
    r.skipSpace(false);
    while (r.peek() === '{') out += inline(r.readBalanced('{', '}'), ctx);
  }
  return out;
}

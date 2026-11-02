// Inline LaTeX → HTML. The overlay model lives in overlay.ts (re-exported here).
import { Reader } from './reader.ts';
import { texToSvg } from './math.ts';
import { Steps, stepAttrs, compactHtml, hasOverlays, resolveRelative, changePoints, atSlide, type Range } from './overlay.ts';
import { siNum, siUnit, siQty, siRange, siAngle } from './units.ts';

export { Steps, stepAttrs, compactHtml, type Range };

export interface Macro { nargs: number; body: string; dflt?: string }

export interface Footnote { mark: string; html: string; range: Range }

export interface Ctx {
  steps: Steps;
  colors: Record<string, string>;
  macros: Record<string, Macro>;
  warn: (msg: string) => void;
  baseDir: string;
  /** Preamble subset used when a fragment is compiled with real LaTeX. */
  latexPreamble?: string;
  latexTheme?: 'dark' | 'light';
  /** \graphicspath entries, relative to baseDir. */
  graphicsPath?: string[];
  /** Footnotes of the current frame. */
  footnotes?: Footnote[];
  /** Renders a citation command (`cite`, `citet`, `parencite`, …). */
  cite?: (cmd: string, keys: string[], pre: string | null, post: string | null) => string;
  /** Value of \insertsection, \inserttitle, … (HTML) or null if unknown. */
  insert?: (name: string) => string | null;
  /** Inline/standalone image (set by the deck; lives in frame.ts). */
  image?: (opts: string | null, path: string, attrs: string, inline: boolean) => string;
  /** Inline LaTeX fragment such as \tikz (set by the deck). */
  fragment?: (src: string) => string;
  /** Equation counter and label registry shared across the deck. */
  eq?: { n: number; labels: Map<string, string>; fig?: number; tab?: number };
  /** Highlighter for inline code (set by the deck). */
  code?: (src: string, lang: string | null) => string;
  /** Theme-name used for alerts inside maths and fragments. */
  alertColor?: string;
  /** \tableofcontents (set by the deck). */
  toc?: (opts: string | null) => string;
  /** \printbibliography / \bibliography (set by the deck). */
  bibliography?: (opts: string | null) => string;
  /** \newenvironment definitions. */
  envs?: Record<string, { nargs: number; dflt?: string; begin: string; end: string }>;
  /** Theorem-like environments: Beamer's predefined ones plus \newtheorem. */
  theorems?: Record<string, { title: string; counter: string | null; kind: 'theorem' | 'definition' | 'example' | 'proof' }>;
  thmCounters?: Map<string, number>;
  /** \lstset / \setminted defaults from the preamble. */
  lst?: Record<string, string | true>;
}

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const THEME_COLORS = ['blue', 'orange', 'red', 'teal', 'green', 'purple', 'yellow', 'white', 'black', 'gray', 'grey', 'muted', 'fg', 'alert', 'accent'];
const ALIASES: Record<string, string> = { green: 'teal', grey: 'muted', gray: 'muted', black: 'fg', cyan: 'blue', magenta: 'purple', violet: 'purple', brown: 'red', darkgray: 'muted', lightgray: 'dim', olive: 'yellow', lime: 'teal', pink: 'red' };

/** Single colour name → CSS colour (no mixing). */
function baseColor(n: string, ctx: Pick<Ctx, 'colors'>): string {
  n = n.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(n)) return n;
  if (ctx.colors[n]) return ctx.colors[n].includes('!') ? resolveColor(ctx.colors[n], ctx) : ctx.colors[n];
  const theme = ALIASES[n] ?? n;
  if (THEME_COLORS.includes(n) || theme !== n) return `var(--${theme})`;
  return n; // let CSS try it as a named colour
}

/**
 * xcolor expression → CSS colour. `blue!30` is a tint of blue over the page
 * background (so it stays subtle in the dark theme); `red!50!black` mixes.
 */
export function resolveColor(name: string, ctx: Pick<Ctx, 'colors'>): string {
  const parts = name.trim().replace(/^-/, '').split('!').map((s) => s.trim());
  let col = baseColor(parts[0], ctx);
  for (let i = 1; i < parts.length; i += 2) {
    const pct = parseFloat(parts[i]);
    if (!Number.isFinite(pct)) break;
    const other = parts[i + 1] ? baseColor(parts[i + 1], ctx) : 'var(--bg)';
    col = `color-mix(in srgb, ${col} ${pct}%, ${other})`;
  }
  return col;
}

const WRAP: Record<string, [string, string]> = {
  textbf: ['<strong>', '</strong>'],
  textit: ['<em>', '</em>'],
  emph: ['<em>', '</em>'],
  textsl: ['<em>', '</em>'],
  underline: ['<u>', '</u>'],
  uline: ['<u>', '</u>'],
  uwave: ['<u class="wavy">', '</u>'],
  sout: ['<s>', '</s>'],
  st: ['<s>', '</s>'],
  xout: ['<s>', '</s>'],
  hl: ['<mark>', '</mark>'],
  texttt: ['<code>', '</code>'],
  textsc: ['<span class="sc">', '</span>'],
  textsf: ['<span class="sf">', '</span>'],
  textrm: ['<span class="rm">', '</span>'],
  textup: ['<span>', '</span>'],
  textmd: ['<span class="md">', '</span>'],
  textnormal: ['<span>', '</span>'],
  mbox: ['<span class="nowrap">', '</span>'],
  hbox: ['<span class="nowrap">', '</span>'],
  text: ['<span>', '</span>'],
  structure: ['<span class="structure">', '</span>'],
  textsuperscript: ['<sup>', '</sup>'],
  textsubscript: ['<sub>', '</sub>'],
  fbox: ['<span class="fbox">', '</span>'],
  boxed: ['<span class="fbox">', '</span>'],
  MakeUppercase: ['<span class="upper">', '</span>'],
  MakeTextUppercase: ['<span class="upper">', '</span>'],
  uppercase: ['<span class="upper">', '</span>'],
  MakeLowercase: ['<span class="lower">', '</span>'],
  lowercase: ['<span class="lower">', '</span>'],
  textls: ['<span>', '</span>'],
  emoji: ['<span>', '</span>'],
  beamerbutton: ['<span class="button">', '</span>'],
  beamergotobutton: ['<span class="button">→ ', '</span>'],
  beamerreturnbutton: ['<span class="button">↩ ', '</span>'],
  beamerskipbutton: ['<span class="button">» ', '</span>'],
  thanks: ['<sup class="thanks">*</sup><span class="hidden-thanks">', '</span>'],
  inst: ['<sup>', '</sup>'],
};

/** Beamer makes these overlay-aware: `\textbf<2>{x}` is bold on slide 2 only. */
const FX: Record<string, string> = { textbf: 'fx-bold', textit: 'fx-italic', emph: 'fx-italic', textsl: 'fx-italic', alert: 'fx-alert', structure: 'fx-structure', underline: 'fx-under', textsc: 'fx-sc', texttt: 'fx-tt', textrm: '', textsf: '' };

const DECLS: Record<string, string> = {
  bfseries: 'b', itshape: 'i', slshape: 'i', ttfamily: 'tt', scshape: 'sc', em: 'i',
  tiny: 'sz-tiny', scriptsize: 'sz-script', footnotesize: 'sz-foot', small: 'sz-small',
  normalsize: 'sz-normal', large: 'sz-large', Large: 'sz-Large', LARGE: 'sz-LARGE', huge: 'sz-huge', Huge: 'sz-Huge',
  upshape: '', mdseries: 'md', rmfamily: 'rm', sffamily: 'sf', normalfont: '', boldmath: '', unboldmath: '',
  raggedright: '',
};

const today = () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

const SYMBOLS: Record<string, string> = {
  '%': '%', '&': '&amp;', '$': '$', '#': '#', '_': '_', '{': '{', '}': '}', '|': '‖',
  ' ': ' ', ',': '&thinsp;', ';': '&ensp;', ':': '&#8197;', '>': '&#8197;', '!': '', '/': '', '-': '&shy;', '@': '',
  ldots: '…', dots: '…', textellipsis: '…', textbackslash: '\\', textasciitilde: '~', textasciicircum: '^', textunderscore: '_',
  LaTeX: 'L<sup class="la">a</sup>T<sub class="te">e</sub>X', TeX: 'T<sub class="te">e</sub>X', LaTeXe: 'L<sup class="la">a</sup>T<sub class="te">e</sub>X 2<sub>ε</sub>',
  BibTeX: 'B<span class="sc">ib</span>T<sub class="te">e</sub>X', XeTeX: 'XeT<sub class="te">e</sub>X', LuaTeX: 'LuaT<sub class="te">e</sub>X', pdfTeX: 'pdfT<sub class="te">e</sub>X',
  quad: '&emsp;', qquad: '&emsp;&emsp;', enspace: '&ensp;', thinspace: '&thinsp;', negthinspace: '', enskip: '&ensp;', space: ' ', nobreakspace: '&nbsp;',
  textbullet: '•', textendash: '–', textemdash: '—', textperiodcentered: '·', textquoteleft: '‘', textquoteright: '’', textquotedblleft: '“', textquotedblright: '”',
  guillemotleft: '«', guillemotright: '»', guillemetleft: '«', guillemetright: '»', textless: '&lt;', textgreater: '&gt;', textbar: '|',
  copyright: '©', textcopyright: '©', textregistered: '®', texttrademark: '™', dag: '†', ddag: '‡', textdagger: '†', textdaggerdbl: '‡', S: '§', P: '¶', textsection: '§', textparagraph: '¶',
  checkmark: '✓', textdegree: '°', degree: '°', celsius: '°C', pounds: '£', textsterling: '£', euro: '€', texteuro: '€', textdollar: '$', textcent: '¢', textyen: '¥',
  textmu: 'µ', textpm: '±', texttimes: '×', textdiv: '÷', textminus: '−', textonehalf: '½', textonequarter: '¼', textthreequarters: '¾', textperthousand: '‰', textnumero: '№',
  textrightarrow: '→', textleftarrow: '←', textuparrow: '↑', textdownarrow: '↓', textopenbullet: '◦', textasteriskcentered: '∗', textbardbl: '‖',
  ss: 'ß', o: 'ø', O: 'Ø', aa: 'å', AA: 'Å', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ', dh: 'ð', DH: 'Ð', th: 'þ', TH: 'Þ', ng: 'ŋ', NG: 'Ŋ',
  textexclamdown: '¡', textquestiondown: '¿', textordfeminine: 'ª', textordmasculine: 'º',
  xmark: '✗', cmark: '✓', smiley: '☺', frownie: '☹', Smiley: '☺', bigstar: '★', starred: '★',
  today: '', hfill: '<span class="hfill"></span>', hfil: '<span class="hfill"></span>', dotfill: '<span class="hfill dotfill"></span>', hrulefill: '<span class="hfill rulefill"></span>',
  newline: '<br>', linebreak: '<br>', break: '<br>', cr: '<br>', par: '<br>', crcr: '<br>',
  and: ', ', slash: '/', textslash: '/', nobreakdash: '', allowbreak: '<wbr>', '\n': ' ',
};

const ACCENTS: Record<string, string> = {
  "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇',
  u: '̆', v: '̌', H: '̋', c: '̧', k: '̨', r: '̊', d: '̣', b: '̱', t: '͡',
};

const DINGS: Record<string, string> = { 51: '✓', 52: '✔', 55: '✗', 56: '✘', 43: '☞', 72: '★', 108: '●', 110: '■', 115: '▲', 116: '▼', 117: '◆', 182: '❶', 183: '❷', 184: '❸', 192: '①', 193: '②', 194: '③', 212: '→', 213: '→', 220: '➜', 228: '➤', 233: '➩', 34: '✂', 36: '☎', 41: '✉', 45: '✍', 46: '✎', 168: '♣', 169: '♦', 170: '♥', 171: '♠' };

const IGNORE_WITH_ARG = new Set(['vspace', 'label', 'index', 'setcounter', 'addtocounter', 'stepcounter', 'refstepcounter', 'pagestyle', 'thispagestyle', 'usebeamercolor', 'usebeamerfont', 'usebeamertemplate', 'hypersetup', 'graphicspath', 'nocite', 'bibliographystyle', 'addbibresource', 'pgfdeclareimage', 'selectlanguage', 'resetcounteronoverlays', 'enlargethispage', 'vskip', 'pdfbookmark', 'phantomsection', 'addcontentsline', 'framezoom', 'lstset', 'setminted', 'usemintedstyle', 'sisetup', 'tcbset', 'definecolor', 'colorlet', 'setbeamersize', 'logo', 'titlegraphic', 'AtBeginSection', 'AtBeginSubsection', 'AtBeginPart', 'tikzset', 'pgfplotsset', 'usetikzlibrary', 'transduration']);
const IGNORE = new Set(['raggedright', 'noindent', 'indent', 'vfill', 'vfil', 'medskip', 'bigskip', 'smallskip', 'relax', 'protect', 'leavevmode', 'nobreak', 'strut', 'null', 'hline', 'selectfont', 'pause', 'clearpage', 'newpage', 'pagebreak', 'nopagebreak', 'ignorespaces', 'unskip', 'noalign', 'appendix', 'bigbreak', 'medbreak', 'smallbreak', 'item', 'centerline', 'mode', 'onslide', 'usefont', 'fontseries', 'fontshape', 'fontfamily', 'expandafter', 'noexpand', 'makeatletter', 'makeatother', 'frenchspacing', 'nonfrenchspacing', 'sloppy', 'fussy', 'displaystyle', 'textstyle', 'justifying', 'RaggedRight', 'tableofcontents', 'transfade', 'transdissolve', 'transblindshorizontal', 'transblindsvertical', 'transboxin', 'transboxout', 'transglitter', 'transsplitverticalin', 'transsplitverticalout', 'transsplithorizontalin', 'transsplithorizontalout', 'transwipe', 'transcover', 'transpush', 'transreplace', 'beamertemplatenavigationsymbolsempty', 'printbibliography', 'normalcolor', 'arraybackslash', 'centering']);

/** Length → CSS (px on the 1920 px stage). `\textwidth` fractions become %. */
export function cssLength(len: string, axis: 'x' | 'y' = 'x'): string {
  const s = len.trim().replace(/\s+/g, '');
  const rel = /^(-?[\d.]*)\\(textwidth|linewidth|columnwidth|hsize|paperwidth|textheight|paperheight|vsize)$/.exec(s);
  if (rel) {
    const f = rel[1] === '' ? 1 : rel[1] === '-' ? -1 : parseFloat(rel[1]);
    if (/height|vsize/.test(rel[2])) return `${Math.round(f * (rel[2] === 'paperheight' ? 1080 : 800))}px`;
    if (rel[2] === 'paperwidth') return `${Math.round(f * 1920)}px`;
    return `${(f * 100).toFixed(1)}%`;
  }
  const abs = /^(-?[\d.]+)(cm|mm|in|pt|bp|em|ex|pc|px|dd|sp)$/.exec(s);
  if (abs) {
    // Beamer's 16:9 page is 160 mm wide; our stage is 1920 px → 12 px/mm. Text is ~29 px/em.
    const px = { cm: 120, mm: 12, in: 304.8, pt: 4.22, bp: 4.23, pc: 50.6, dd: 4.5, sp: 4.22 / 65536, px: 1 }[abs[2] as 'cm'];
    if (abs[2] === 'em') return `${abs[1]}em`;
    if (abs[2] === 'ex') return `${(parseFloat(abs[1]) * 0.45).toFixed(2)}em`;
    return `${Math.round(parseFloat(abs[1]) * px)}px`;
  }
  void axis;
  return 'auto';
}

// ---------------------------------------------------------------------------
// Maths

const MATH_COLOR_RE = /fill="([A-Za-z][\w-]*)" stroke="\1"/g;

/** Theme colours in maths (`\color{red}`) follow the deck palette. */
function themeMath(svg: string, colors?: Record<string, string>): string {
  return svg.replace(MATH_COLOR_RE, (all, name: string) => {
    if (colors?.[name]) return `fill="${colors[name]}" stroke="${colors[name]}"`;
    const t = ALIASES[name] ?? name;
    if (!THEME_COLORS.includes(name) && t === name) return all;
    return `style="fill:var(--${t});stroke:var(--${t})"`;
  });
}

let mathColors: Record<string, string> | undefined;
export function setMathColors(c: Record<string, string>) { mathColors = c; }

export function mathHtml(tex: string, display = false): string {
  try {
    return `<span class="${display ? 'dm' : 'm'}">${themeMath(texToSvg(tex.trim(), display), mathColors)}</span>`;
  } catch (e) {
    return `<span class="err" title="${esc(String(e))}">${esc(tex)}</span>`;
  }
}

const NUMBERED = new Set(['equation', 'align', 'gather', 'multline', 'flalign', 'alignat', 'eqnarray']);

/**
 * Display maths, written stroke by stroke. Unstarred environments are numbered
 * (`\label` registers, `\notag`/`\nonumber` skip). Overlay commands inside
 * (`\only<2>`, `\uncover<3->`, `\alert<2>`, `\pause`, …) become per-step layers.
 */
export function mathBlock(body: string, ctx: Ctx, env: string | null = null): string {
  const bare = env?.replace('*', '') ?? null;
  const numbered = numberEquations(body, env, ctx);
  const tex = !bare || bare === 'equation' || bare === 'displaymath' || bare === 'math' ? numbered : `\\begin{${bare}*}${numbered}\\end{${bare}*}`;
  const here = ctx.steps.here();
  if (!hasOverlays(tex)) return `<div class="dmath" data-anim="write"${stepAttrs(here)}>${mathHtml(tex, true)}</div>`;
  const resolved = resolveRelative(tex, ctx.steps);
  const pts = changePoints(resolved);
  const starts = [here.from, ...pts.filter((n) => n > here.from)];
  const layers: { k: number; tex: string }[] = [];
  for (const k of starts) {
    const t = atSlide(resolved, k, 'math', ctx.alertColor ?? 'alert');
    if (layers.length && layers[layers.length - 1].tex === t) continue;
    ctx.steps.mark(k);
    layers.push({ k, tex: t });
  }
  const html = layers.map((l, i) => {
    const until = layers[i + 1]?.k;
    const r: Range = until === undefined ? { from: l.k } : { from: l.k, until };
    return `<div class="layer"${stepAttrs(r)} data-anim="${i === 0 ? 'write' : 'swap'}">${mathHtml(l.tex, true)}</div>`;
  }).join('');
  return `<div class="dmath mstack"${stepAttrs(here)}>${html}</div>`;
}

function numberEquations(tex: string, env: string | null, ctx: Ctx): string {
  // Labels are recorded whether or not the environment is numbered.
  const bare = env?.replace('*', '') ?? '';
  const numbered = !!env && !env.endsWith('*') && NUMBERED.has(bare) && !!ctx.eq;
  const rows = bare === 'equation' || bare === 'multline' ? [tex] : splitRows(tex);
  const out = rows.map((row) => {
    let label: string | null = null;
    row = row.replace(/\\label\{([^}]*)\}/g, (_, l) => { label = l; return ''; });
    const skip = /\\(notag|nonumber)\b/.test(row) || /\\tag\*?\{/.test(row) || !row.trim();
    row = row.replace(/\\(notag|nonumber)\b/g, '');
    if (numbered && !skip) {
      const n = String(++ctx.eq!.n);
      if (label) ctx.eq!.labels.set(label, n);
      return `${row}\\tag{${n}}`;
    }
    const tag = /\\tag\*?\{([^}]*)\}/.exec(row);
    if (label && tag && ctx.eq) ctx.eq.labels.set(label, tag[1]);
    return row;
  });
  return out.join('\\\\');
}

/** Splits on top-level `\\` (rows of align/gather). */
function splitRows(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (s.startsWith('\\begin{', i)) depth++;
    else if (s.startsWith('\\end{', i)) depth--;
    if (c === '\\' && s[i + 1] === '\\' && depth === 0) { out.push(cur); cur = ''; i++; continue; }
    if (c === '\\') { cur += c + (s[i + 1] ?? ''); i++; continue; }
    if (c === '{') depth++;
    if (c === '}') depth--;
    cur += c;
  }
  out.push(cur);
  return out;
}

/** Inline maths; overlays inside become swapping spans. */
function mathInline(tex: string, ctx: Ctx): string {
  if (!hasOverlays(tex)) return mathHtml(tex);
  const resolved = resolveRelative(tex, ctx.steps);
  const here = ctx.steps.here();
  const starts = [here.from, ...changePoints(resolved).filter((n) => n > here.from)];
  for (const k of starts) ctx.steps.mark(k);
  return `<span class="mstack-inline">${starts.map((k, i) => {
    const until = starts[i + 1];
    return `<span class="ov only"${stepAttrs(until === undefined ? { from: k } : { from: k, until })}>${mathHtml(atSlide(resolved, k, 'math', ctx.alertColor ?? 'alert'))}</span>`;
  }).join('')}</span>`;
}

// ---------------------------------------------------------------------------

/** Substitutes `#1..#9` in a user macro body (optional first argument supported). */
export function expandMacro(r: Reader, m: Macro): string {
  let body = m.body;
  let first = 1;
  if (m.dflt !== undefined) {
    const opt = r.readOptional();
    body = body.split('#1').join(opt ?? m.dflt);
    first = 2;
  }
  for (let i = first; i <= m.nargs; i++) {
    const arg = r.readGroup();
    body = body.split(`#${i}`).join(arg);
  }
  return body;
}

function ovSpan(cls: string, range: Range, body: string): string {
  return `<span class="ov${cls ? ' ' + cls : ''}"${stepAttrs(range)}>${body}</span>`;
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
      out += mathInline(src.slice(r.pos, end), ctx);
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
    if (c === '"' && (r.startsWith('"`') || r.startsWith("\"'"))) { out += r.peek(1) === '`' ? '„' : '“'; r.pos += 2; continue; }
    if (c === '!' && r.startsWith('!`')) { out += '¡'; r.pos += 2; continue; }
    if (c === '?' && r.startsWith('?`')) { out += '¿'; r.pos += 2; continue; }
    if (c === '`') { out += '‘'; r.pos++; continue; }
    if (c === "'") { out += '’'; r.pos++; continue; }
    if (c === '<') { out += r.startsWith('<<') ? (r.pos++, '«') : '&lt;'; r.pos++; continue; }
    if (c === '>') { out += r.startsWith('>>') ? (r.pos++, '»') : '&gt;'; r.pos++; continue; }
    if (c === '&') { out += '&amp;'; r.pos++; continue; }
    if (c === '\n') { out += ' '; r.pos++; continue; }
    if (c !== '\\') { out += c; r.pos++; continue; }

    if (r.startsWith('\\(')) { const end = src.indexOf('\\)', r.pos); out += mathInline(src.slice(r.pos + 2, end), ctx); r.pos = end + 2; continue; }
    if (r.startsWith('\\[')) { const end = src.indexOf('\\]', r.pos); out += mathHtml(src.slice(r.pos + 2, end), true); r.pos = end + 2; continue; }
    if (r.startsWith('\\\\')) { r.pos += 2; r.readStar(); const sp = r.readOptional(); out += sp ? `<br><span class="vsp" style="height:${cssLength(sp)}"></span>` : '<br>'; continue; }

    out += command(r.readCommandName(), r, ctx, src);
  }
  return out;
}

/** One inline command at the reader (name already read). Declarations consume the rest of `src`. */
function command(name: string, r: Reader, ctx: Ctx, src: string): string {
  if (name === 'verb' || name === 'lstinline' || name === 'mintinline') {
    r.readStar();
    let lang: string | null = null;
    if (name === 'lstinline') { const o = r.readOptional(); lang = /language=\{?([^,}\]]+)/.exec(o ?? '')?.[1] ?? null; }
    if (name === 'mintinline') { r.readOptional(); lang = r.readGroup(); }
    const delim = r.src[r.pos++];
    const close = delim === '{' ? '}' : delim;
    const end = src.indexOf(close, r.pos);
    const code = src.slice(r.pos, end);
    r.pos = end + 1;
    return `<code>${ctx.code && lang ? ctx.code(code, lang) : esc(code)}</code>`;
  }
  if (ctx.macros[name]) return inline(expandMacro(r, ctx.macros[name]), ctx);
  if (name in ACCENTS) {
    // \'e  \'{e}  \v{s}  \"\i
    if (/[A-Za-z]/.test(name)) r.skipSpace(false);
    let base = r.peek() === '{' ? r.readBalanced('{', '}') : r.peek() === '\\' ? (r.readCommandName(), r.src.slice(r.pos - 2, r.pos)) : r.src[r.pos++] ?? '';
    base = base.replace(/^\\i$/, 'i').replace(/^\\j$/, 'j').trim();
    const html = base.length === 1 ? base : inline(base, ctx);
    return (html.length === 1 ? html + ACCENTS[name] : html.replace(/^(\p{L})/u, `$1${ACCENTS[name]}`)).normalize('NFC');
  }
  if (name === 'today') { r.skipSpace(false); return today(); }
  if (name in SYMBOLS) { if (/^[A-Za-z]/.test(name)) r.skipSpace(false); return SYMBOLS[name]; }

  if (name in FX || name in WRAP) {
    const ov = r.readOverlay();
    if (ov) {
      const spec = ctx.steps.spec(ov);
      const fx = FX[name] ?? '';
      const body = inline(r.readGroup(), ctx);
      const range = spec.alert ?? spec.vis ?? ctx.steps.here();
      return `<span class="fx ${fx}"${stepAttrs(range, 'fx-')}>${body}</span>`;
    }
    if (name === 'alert') return `<span class="alert">${inline(r.readGroup(), ctx)}</span>`;
    if (name === 'thanks') { r.readGroup(); return ''; }
    const [o, cl] = WRAP[name];
    return o + inline(r.readGroup(), ctx) + cl;
  }
  if (name === 'alert') { const b = inline(r.readGroup(), ctx); return `<span class="alert">${b}</span>`; }

  if (name === 'textcolor' || name === 'color') {
    const ov = r.readOverlay();
    const model = r.readOptional();
    const col = r.readGroup();
    const color = model ? modelColor(model, col) : resolveColor(col, ctx);
    const body = name === 'textcolor' ? r.readGroup() : r.src.slice(r.pos);
    if (name === 'color') r.pos = r.src.length;
    const html = inline(body, ctx);
    if (ov) return `<span class="fx fx-color" style="--fx:${color}"${stepAttrs(ctx.steps.overlay(ov), 'fx-')}>${html}</span>`;
    return `<span style="color:${color}">${html}</span>`;
  }
  if (name === 'colorbox' || name === 'fcolorbox') {
    const model = r.readOptional();
    const c1 = r.readGroup();
    const c2 = name === 'fcolorbox' ? r.readGroup() : null;
    const body = inline(r.readGroup(), ctx);
    const col = (x: string) => (model ? modelColor(model, x) : resolveColor(x, ctx));
    return c2 !== null
      ? `<span class="cbox" style="border:2px solid ${col(c1)};background:${col(c2)}">${body}</span>`
      : `<span class="cbox" style="background:${col(c1)}">${body}</span>`;
  }
  if (name in DECLS) {
    const cls = DECLS[name];
    const rest = inline(src.slice(r.pos), ctx);
    r.pos = src.length;
    return cls ? `<span class="${cls}">${rest}</span>` : rest;
  }

  // Beamer overlay commands (inline forms; block forms are handled in frame.ts).
  if (name === 'only' || name === 'uncover' || name === 'visible' || name === 'onslide' || name === 'invisible') {
    r.readStar();
    const ov = r.readOverlay();
    r.skipSpace();
    if (r.peek() !== '{') return ''; // bare \onslide<..> switch: handled at block level
    const body = inline(r.readGroup(), ctx);
    if (!ov) return name === 'invisible' ? `<span class="invisible">${body}</span>` : body;
    const range = name === 'invisible' ? ctx.steps.overlay(`invisible@${ov}`) : ctx.steps.overlay(ov);
    return ovSpan(name === 'only' ? 'only' : '', range, body);
  }
  if (name === 'alt') {
    const ov = r.readOverlay() ?? '1-';
    const range = ctx.steps.overlay(ov);
    const a = inline(r.readGroup(), ctx), b = inline(r.readGroup(), ctx);
    const not = ctx.steps.overlay(`invisible@${rangeSpec(range)}`);
    return ovSpan('only', range, a) + ovSpan('only', not, b);
  }
  if (name === 'temporal') {
    const ov = r.readOverlay() ?? '1-';
    const range = ctx.steps.overlay(ov);
    const a = inline(r.readGroup(), ctx), b = inline(r.readGroup(), ctx), c = inline(r.readGroup(), ctx);
    const parts: string[] = [];
    if (range.from > 1) parts.push(ovSpan('only', { from: 1, until: range.from }, a));
    parts.push(ovSpan('only', range, b));
    const end = range.on ? range.on[range.on.length - 1][1] : range.until;
    if (end !== undefined) parts.push(ovSpan('only', { from: end }, c));
    return parts.join('');
  }
  if (name === 'action') { const ov = r.readOverlay(); const b = inline(r.readGroup(), ctx); return ov ? ovSpan('', ctx.steps.overlay(ov), b) : b; }

  if (name === 'href') { const url = r.readGroup(); return `<a href="${esc(url.replace(/\\([#%&_~])/g, '$1'))}" target="_blank">${inline(r.readGroup(), ctx)}</a>`; }
  if (name === 'url' || name === 'nolinkurl') { const url = r.readGroup().replace(/\\([#%&_~])/g, '$1'); return `<a href="${esc(url)}" target="_blank"><code>${esc(url)}</code></a>`; }
  if (name === 'email') { const a = r.readGroup(); return `<a href="mailto:${esc(a)}"><code>${esc(a)}</code></a>`; }
  if (name === 'hyperlink' || name === 'hyperref') {
    const ov = r.readOverlay();
    let target: string;
    if (name === 'hyperref') { const opt = r.readOptional(); target = opt ?? ''; if (!opt) { r.readGroup(); r.readGroup(); r.readGroup(); target = r.readGroup(); } }
    else target = r.readGroup();
    const body = inline(r.readGroup(), ctx);
    const a = `<a class="jump" data-goto="${esc(target.trim())}">${body}</a>`;
    return ov ? ovSpan('', ctx.steps.overlay(ov), a) : a;
  }
  if (name === 'hypertarget') { const t = r.readGroup(); return `<span class="target" data-target="${esc(t.trim())}">${inline(r.readGroup(), ctx)}</span>`; }
  if (name === 'ref' || name === 'eqref' || name === 'autoref' || name === 'cref' || name === 'Cref' || name === 'pageref') {
    r.readStar();
    const key = r.readGroup().trim();
    return `<span class="ref" data-ref="${esc(key)}" data-kind="${name}">??</span>`;
  }

  if (name === 'footnote' || name === 'footnotetext') {
    const ov = r.readOverlay();
    const opt = r.readOptional();
    const fns = ctx.footnotes ?? [];
    const mark = opt ?? String(fns.length + 1);
    const html = inline(r.readGroup(), ctx);
    fns.push({ mark, html, range: ov ? ctx.steps.overlay(ov) : ctx.steps.here() });
    ctx.footnotes = fns;
    return name === 'footnote' ? `<sup class="fnmark">${esc(mark)}</sup>` : '';
  }
  if (name === 'footnotemark') { const opt = r.readOptional(); return `<sup class="fnmark">${esc(opt ?? String((ctx.footnotes?.length ?? 0) + 1))}</sup>`; }

  if (/^(cite|citep|citet|citealp|citealt|citeauthor|citeyear|citeyearpar|parencite|textcite|autocite|footcite|fullcite|smartcite|supercite|Cite|Citet|Citep|Textcite|Parencite|Autocite|citetitle|nocite)\*?$/.test(name)) {
    r.readStar();
    const o1 = r.readOptional();
    const o2 = r.readOptional();
    const keys = r.readGroup().split(',').map((k) => k.trim()).filter(Boolean);
    const [pre, post] = o2 !== null ? [o1, o2] : [null, o1];
    if (name === 'nocite') { ctx.cite?.('nocite', keys, null, null); return ''; }
    if (!ctx.cite) return `<span class="cite">[${esc(keys.join(', '))}]</span>`;
    const html = ctx.cite(name.toLowerCase(), keys, pre, post);
    if (name === 'footcite') {
      const fns = ctx.footnotes ?? [];
      const mark = String(fns.length + 1);
      fns.push({ mark, html: ctx.cite('fullcite', keys, pre, post), range: ctx.steps.here() });
      ctx.footnotes = fns;
      return `<sup class="fnmark">${mark}</sup>`;
    }
    return html;
  }

  if (/^insert[a-z]+$/.test(name)) {
    const v = ctx.insert?.(name);
    if (v !== null && v !== undefined) { r.skipSpace(false); return v; }
  }

  // siunitx
  if (name === 'SI' || name === 'qty') { r.readOptional(); const n = r.readGroup(); r.readOptional(); const u = r.readGroup(); return si(siQty(n, u)); }
  if (name === 'si' || name === 'unit') { r.readOptional(); return si(siUnit(r.readGroup())); }
  if (name === 'num') { r.readOptional(); return si(siNum(r.readGroup())); }
  if (name === 'ang') { r.readOptional(); return si(siAngle(r.readGroup())); }
  if (name === 'SIrange' || name === 'qtyrange' || name === 'numrange') {
    r.readOptional();
    const a = r.readGroup(), b = r.readGroup();
    const u = name === 'numrange' ? undefined : r.readGroup();
    return si(siRange(a, b, u));
  }
  if (name === 'SIlist' || name === 'qtylist' || name === 'numlist') {
    r.readOptional();
    const items = r.readGroup().split(';');
    const u = name === 'numlist' ? '' : r.readGroup();
    return items.map((n) => si(u ? siQty(n, u) : siNum(n))).join(', ');
  }
  if (name === 'ensuremath') return mathInline(r.readGroup(), ctx);
  if (name === 'ce') return mathHtml(`\\ce{${r.readGroup()}}`);

  if (name === 'ding') { const n = r.readGroup().trim(); return DINGS[n] ?? '•'; }
  if (name === 'hspace') {
    r.readStar();
    const len = r.readGroup();
    if (/\\fill|\\stretch/.test(len)) return '<span class="hfill"></span>';
    return `<span class="hsp" style="width:${cssLength(len)}"></span>`;
  }
  if (name === 'phantom' || name === 'hphantom') return `<span class="invisible">${inline(r.readGroup(), ctx)}</span>`;
  if (name === 'vphantom') { r.readGroup(); return ''; }
  if (name === 'rule') {
    r.readOptional();
    const w = cssLength(r.readGroup()), h = cssLength(r.readGroup());
    return `<span class="rule" style="width:${w};height:${h}"></span>`;
  }
  if (name === 'raisebox') { const h = cssLength(r.readGroup()); r.readOptional(); r.readOptional(); return `<span style="position:relative;bottom:${h}">${inline(r.readGroup(), ctx)}</span>`; }
  if (name === 'scalebox') { const s = parseFloat(r.readGroup()) || 1; r.readOptional(); return `<span style="display:inline-block;font-size:${s}em">${inline(r.readGroup(), ctx)}</span>`; }
  if (name === 'rotatebox') { r.readOptional(); const a = parseFloat(r.readGroup()) || 0; return `<span style="display:inline-block;transform:rotate(${-a}deg)">${inline(r.readGroup(), ctx)}</span>`; }
  if (name === 'reflectbox') return `<span style="display:inline-block;transform:scaleX(-1)">${inline(r.readGroup(), ctx)}</span>`;
  if (name === 'resizebox') { r.readStar(); r.readGroup(); r.readGroup(); return inline(r.readGroup(), ctx); }
  if (name === 'makebox' || name === 'framebox') {
    const w = r.readOptional(); const pos = r.readOptional();
    const style = w ? `display:inline-block;width:${cssLength(w)};text-align:${pos === 'r' ? 'right' : pos === 'l' ? 'left' : 'center'}` : '';
    return `<span class="${name === 'framebox' ? 'fbox' : ''}" style="${style}">${inline(r.readGroup(), ctx)}</span>`;
  }
  if (name === 'parbox') { r.readOptional(); r.readOptional(); r.readOptional(); const w = cssLength(r.readGroup()); return `<span style="display:inline-block;vertical-align:middle;width:${w}">${inline(r.readGroup(), ctx)}</span>`; }
  if (name === 'textcircled') return `<span class="circled">${inline(r.readGroup(), ctx)}</span>`;
  if (name === 'includegraphics' && ctx.image) {
    const ov = r.readOverlay();
    const opts = r.readOptional();
    return ctx.image(opts, r.readGroup(), stepAttrs(ov ? ctx.steps.overlay(ov) : ctx.steps.here()), true);
  }
  if (name === 'tikz' && ctx.fragment) {
    const start = r.pos;
    r.readOverlay();
    r.readOptional();
    r.skipSpace();
    if (r.peek() === '{') r.readBalanced('{', '}');
    else { const end = src.indexOf(';', r.pos); r.pos = end < 0 ? src.length : end + 1; }
    return ctx.fragment(`\\tikz${src.slice(start, r.pos)}`);
  }
  if (name === 'chemfig' && ctx.fragment) { const start = r.pos; r.readStar(); r.readOptional(); r.readGroup(); return ctx.fragment(`\\chemfig${src.slice(start, r.pos)}`); }
  if (name === 'pause') { r.readOptional(); return ''; }
  if (name === 'item') { r.readOverlay(); const l = r.readOptional(); return l ? inline(l, ctx) + ' ' : ''; }
  if (IGNORE_WITH_ARG.has(name)) { r.readStar(); r.readOverlay(); r.readOptional(); r.readGroup(); if (name === 'definecolor' || name === 'setbeamersize') { r.readGroup(); r.readGroup(); } return ''; }
  if (/^(setbeamer\w+|usetheme|use\w+theme|newcommand|renewcommand|providecommand|setlength|addtolength|settowidth|newlength|newcounter|setcounter)$/.test(name)) {
    r.readStar();
    while (true) { r.readOverlay(); const o = r.readOptional(); r.skipSpace(false); if (r.peek() === '{' || r.peek() === '\\') { r.readGroup(); continue; } if (o === null) break; }
    return '';
  }
  if (IGNORE.has(name)) { r.readOverlay(); r.skipSpace(false); return ''; }
  if (/^(fa[A-Z]\w*|faIcon)$/.test(name)) { if (name === 'faIcon') { r.readOptional(); r.readGroup(); } return '<span class="icon">◆</span>'; }

  ctx.warn(`unsupported inline command \\${name}; rendering its arguments`);
  r.readOverlay();
  r.readOptional();
  r.skipSpace(false);
  let out = '';
  while (r.peek() === '{') out += inline(r.readBalanced('{', '}'), ctx);
  return out;
}

const si = (tex: string) => mathHtml(tex);

/** `[HTML]{FF8800}`, `[rgb]{1,0.5,0}`, `[RGB]{255,128,0}`, `[gray]{0.5}`. */
export function modelColor(model: string, v: string): string {
  const m = model.trim();
  if (m === 'HTML') return `#${v.trim().replace(/^#/, '')}`;
  const n = v.split(',').map((x) => parseFloat(x));
  if (m === 'rgb') return `rgb(${n.map((x) => Math.round(x * 255)).join(',')})`;
  if (m === 'RGB') return `rgb(${n.join(',')})`;
  if (m === 'gray') return `hsl(0 0% ${n[0] * 100}%)`;
  if (m === 'cmyk') { const [c, mm, y, k] = n; return `rgb(${[c, mm, y].map((x) => Math.round(255 * (1 - x) * (1 - k))).join(',')})`; }
  return v;
}

function rangeSpec(r: Range): string {
  const ivs = r.on ?? [[r.from, r.until]];
  return ivs.map(([a, b]) => (b === undefined ? `${a}-` : b === a + 1 ? `${a}` : `${a}-${b - 1}`)).join(',');
}

// Whole document: preamble metadata, sections, frames → Deck.
import { readFileSync } from 'node:fs';
import { Reader, parseKeyVals } from './reader.ts';
import { Steps, inline, compactHtml, esc, stepAttrs, modelColor, resolveColor, setMathColors, type Ctx, type Macro, type Footnote } from './inline.ts';
import { blocks, imageHtml, latexFigure, type FrameState } from './frame.ts';
import { texToSvg } from './math.ts';
import type { SceneSpec } from './scene.ts';
import { fragmentPreamble } from './latexsvg.ts';
import { sourceFromString, type Source } from './preprocess.ts';
import { parseBib, formatEntry, authorShort, year as bibYear, type BibEntry } from './bib.ts';
import { highlight, normalizeLang } from './highlight.ts';
import { findFile } from './media.ts';

export interface Slide {
  kind: 'title' | 'frame' | 'section';
  section?: string;
  subsection?: string;
  /** Index (1-based) of the section this slide belongs to; 0 before the first. */
  sectionIdx: number;
  title?: string;
  subtitle?: string;
  html: string;
  steps: number;
  notes: string[];
  covered: boolean;
  plain: boolean;
  /** Frame number shown in the corner (null = not numbered). */
  frameNo: number | null;
  label?: string;
  align?: 't' | 'c' | 'b';
  footnotes: string;
  transition?: string;
  standout?: boolean;
  /** For section pages: 'section' | 'subsection' | 'part'. */
  pageKind?: string;
  /** \usebackgroundtemplate content in effect for this frame (HTML). */
  background?: string;
}

export interface Diagnostic { slide?: number; line?: number; file?: string; message: string }

export interface DeckMeta {
  title: string; subtitle: string; author: string; institute: string; date: string; theme: 'dark' | 'light';
  shortTitle: string; shortAuthor: string; shortDate: string;
  titlegraphic: string; logo: string;
  /** Stage size in px (height is always 1080). */
  width: number;
  /** CSS custom properties overriding the theme (from \setbeamercolor etc.). */
  vars: Record<string, string>;
  serif: boolean;
  footline: 'number' | 'infolines' | 'none';
  progress: boolean;
  totalFrames: number;
  handout: boolean;
}

export interface Deck {
  meta: DeckMeta;
  slides: Slide[];
  scenes: SceneSpec[];
  warnings: Diagnostic[];
}

export const formatDiagnostic = (d: Diagnostic) => {
  const loc = [d.file && d.line ? `${d.file}:${d.line}` : d.line ? `line ${d.line}` : '', d.slide ? `slide ${d.slide}` : ''].filter(Boolean).join(', ');
  return `${loc}${loc ? ': ' : ''}${d.message}`;
};

/** Value of the last `\cmd[short]{long}` in the preamble, read brace-aware. */
function preambleArg(pre: string, cmd: string): { short: string | null; long: string } | null {
  let found: { short: string | null; long: string } | null = null;
  const re = new RegExp(`\\\\${cmd}(?![A-Za-z])`, 'g');
  let m;
  while ((m = re.exec(pre))) {
    const r = new Reader(pre);
    r.pos = m.index + m[0].length;
    const short = r.readOptional();
    r.skipSpace();
    if (r.peek() === '{') found = { short, long: r.readBalanced('{', '}') };
  }
  return found;
}

/** Every `\cmd…` occurrence's reader, positioned right after the name. */
function* occurrences(src: string, cmd: RegExp): Generator<{ name: string; r: Reader; start: number }> {
  const re = new RegExp(cmd.source, 'g');
  let m;
  while ((m = re.exec(src))) {
    const r = new Reader(src);
    r.pos = m.index + m[0].length;
    yield { name: m[0], r, start: m.index };
  }
}

interface Defs {
  macros: Record<string, Macro>;
  mathDefs: string;
  envs: Record<string, { nargs: number; dflt?: string; begin: string; end: string }>;
  theorems: NonNullable<Ctx['theorems']>;
}

const BEAMER_THEOREMS: [string, string][] = [['theorem', 'Theorem'], ['corollary', 'Corollary'], ['definition', 'Definition'], ['definitions', 'Definitions'], ['fact', 'Fact'], ['example', 'Example'], ['examples', 'Examples'], ['lemma', 'Lemma'], ['proof', 'Proof'], ['problem', 'Problem'], ['solution', 'Solution']];
const thmKind = (name: string, title: string): 'theorem' | 'definition' | 'example' | 'proof' =>
  /proof/i.test(name) ? 'proof' : /example/i.test(name + title) ? 'example' : /defin|remark|note|notation|assumption/i.test(name + title) ? 'definition' : 'theorem';

function collectDefs(src: string, numbered: boolean): Defs {
  const macros: Record<string, Macro> = {};
  const defs: string[] = [];
  const envs: Defs['envs'] = {};
  const theorems: Defs['theorems'] = {};
  for (const [n, t] of BEAMER_THEOREMS) theorems[n] = { title: t, counter: numbered && n !== 'proof' ? 'theorem' : null, kind: thmKind(n, t) };
  for (const { name, r, start } of occurrences(src, /\\(?:re)?newcommand\*?|\\providecommand\*?|\\DeclareMathOperator\*?|\\def(?![A-Za-z])|\\(?:re)?newenvironment\*?|\\newtheorem\*?|\\NewDocumentCommand|\\DeclareRobustCommand\*?/)) {
    try {
      r.skipSpace();
      if (name.startsWith('\\def')) {
        const cname = r.readCommandName();
        const params = /^[^{]*/.exec(r.src.slice(r.pos))![0];
        r.pos += params.length;
        const body = r.readGroup();
        macros[cname] = { nargs: (params.match(/#\d/g) ?? []).length, body };
        defs.push(src.slice(start, r.pos));
        continue;
      }
      if (/newenvironment/.test(name)) {
        const env = r.readGroup().trim();
        const n = r.readOptional();
        const dflt = r.readOptional();
        const begin = r.readGroup(), end = r.readGroup();
        envs[env] = { nargs: n ? parseInt(n, 10) : 0, dflt: dflt ?? undefined, begin, end };
        continue;
      }
      if (name.startsWith('\\newtheorem')) {
        const env = r.readGroup().trim();
        const shared = r.readOptional();
        const title = r.readGroup();
        r.readOptional();
        const star = name.endsWith('*');
        theorems[env] = { title, counter: star ? null : shared?.trim() ?? env, kind: thmKind(env, title) };
        continue;
      }
      if (name === '\\NewDocumentCommand') {
        const cname = r.readGroup().trim().replace(/^\\/, '');
        const argspec = r.readGroup();
        const body = r.readGroup();
        macros[cname] = { nargs: (argspec.match(/[mO]/g) ?? []).length, body, dflt: /^\s*O\{([^}]*)\}/.exec(argspec)?.[1] };
        continue;
      }
      const nameRaw = r.peek() === '{' ? r.readBalanced('{', '}') : (r.readCommandName(), src.slice(start + name.length, r.pos).trim());
      const cname = nameRaw.trim().replace(/^\\/, '');
      if (name.startsWith('\\Declare') && name.includes('MathOperator')) {
        const op = r.readGroup();
        defs.push(src.slice(start, r.pos));
        macros[cname] = { nargs: 0, body: `$\\operatorname{${op}}$` };
        continue;
      }
      const n = r.readOptional();
      const dflt = r.readOptional();
      const body = r.readGroup();
      if (name.startsWith('\\provide') && macros[cname]) continue;
      macros[cname] = { nargs: n ? parseInt(n, 10) : 0, body, dflt: dflt ?? undefined };
      defs.push(src.slice(start, r.pos));
    } catch { /* malformed definition: skip */ }
  }
  return { macros, mathDefs: defs.join('\n'), envs, theorems };
}

function collectColors(src: string): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const { name, r } of occurrences(src, /\\(?:define|provide)color(?![A-Za-z])|\\colorlet(?![A-Za-z])/)) {
    try {
      r.readOptional();
      const n = r.readGroup().trim();
      if (name === '\\colorlet') { colors[n] = r.readGroup().trim(); continue; }
      r.readOptional();
      const model = r.readGroup().trim();
      const val = r.readGroup().trim();
      colors[n] = model === 'named' ? val : modelColor(model.split('/')[0], val.split('/')[0]);
    } catch { /* skip */ }
  }
  return colors;
}

const ASPECT: Record<string, number> = { '169': 16 / 9, '1610': 16 / 10, '149': 14 / 9, '141': 1.41, '54': 5 / 4, '43': 4 / 3, '32': 3 / 2, '11': 1, '2013': 2 };
const INFOLINES = /^(Madrid|AnnArbor|Boadilla|CambridgeUS|EastLansing|Singapore|Szeged|Copenhagen|Luebeck|Malmoe|Warsaw|Berlin|Ilmenau|Dresden|Frankfurt|Darmstadt|JuanLesPins|Montpellier|Berkeley|PaloAlto|Goettingen|Marburg|Hannover|Rochester|Antibes|Bergen|Pittsburgh|Hamburg)$/;

export interface ParseOptions { handout?: boolean; mainFile?: string }

export function parseDeck(input: string | Source, baseDir: string, opts: ParseOptions = {}): Deck {
  const source = typeof input === 'string' ? sourceFromString(input) : input;
  const mainFile = opts.mainFile ?? source.origin(0).file;
  let src = source.text;
  const bd = src.indexOf('\\begin{document}');
  const ed = src.indexOf('\\end{document}');
  if (bd < 0) throw new Error('no \\begin{document} found');
  const pre = src.slice(0, bd);
  const bodyStart = bd + '\\begin{document}'.length;
  let body = src.slice(bodyStart, ed < 0 ? undefined : ed);
  body = stripModes(body);

  const warnings: Diagnostic[] = [];
  const seen = new Set<string>();
  let where: { slide?: number; line?: number; file?: string } = {};
  const locate = (offset: number | null) => {
    if (offset === null) return {};
    const o = source.origin(bodyStart + offset);
    return { line: o.line, file: o.file === mainFile ? undefined : o.file };
  };

  // ---- document class
  const cls = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(pre);
  const clsOpts = parseKeyVals(cls?.[1] ?? null);
  const handout = opts.handout ?? !!clsOpts.handout;
  const aspect = ASPECT[String(clsOpts.aspectratio ?? '169')] ?? 16 / 9;
  const width = Math.round(1080 * aspect);

  // ---- theme
  const themeName = /\\usetheme(?:\[([^\]]*)\])?\{([^}]*)\}/.exec(pre);
  const metropolis = !!themeName && /metropolis|moloch/.test(themeName[2]);
  const metroOpts = parseKeyVals([themeName?.[1] ?? '', ...[...pre.matchAll(/\\metroset\{([^}]*)\}/g)].map((m) => m[1])].join(','));
  const auroraTheme = preambleArg(pre, 'auroratheme')?.long.trim();
  const theme: 'dark' | 'light' = auroraTheme === 'light' ? 'light' : 'dark';
  const numberedThm = /\\setbeamertemplate\{theorems?\}\s*\[(numbered|ams style)\]/.test(pre);
  const defs = collectDefs(pre + '\n' + body.replace(/\\begin\{frame\}[\s\S]*?\\end\{frame\}/g, (f) => (/\\(re)?newcommand|\\def\\|\\newenvironment/.test(f) ? f : '')), numberedThm);
  const colors = collectColors(pre + body);
  setMathColors(Object.fromEntries(Object.entries(colors).filter(([, v]) => v.startsWith('#') || v.startsWith('rgb'))));
  // MathJax keeps \newcommand definitions for the lifetime of the document.
  if (defs.mathDefs) { try { texToSvg(defs.mathDefs); } catch (e) { warnings.push({ message: `math macros: ${e}` }); } }

  const vars: Record<string, string> = {};
  const colorOf = (spec: string) => {
    const kv = parseKeyVals(spec);
    return { fg: typeof kv.fg === 'string' ? resolveColor(kv.fg, { colors }) : null, bg: typeof kv.bg === 'string' ? resolveColor(kv.bg, { colors }) : null };
  };
  for (const m of pre.matchAll(/\\setbeamercolor\*?\{([^}]*)\}\{([^}]*)\}/g)) {
    const { fg, bg } = colorOf(m[2]);
    const what = m[1].trim();
    if (what === 'alerted text' && fg) vars['--alert'] = fg;
    if ((what === 'structure' || what === 'palette primary' || what === 'frametitle' || what === 'title') && fg) vars['--accent'] = fg;
    if ((what === 'item' || what === 'itemize item') && fg) vars['--bullet'] = fg;
    if (what === 'block title' && bg) vars['--block'] = bg;
  }
  const named = /\\usecolortheme\[(?:named|RGB|rgb|HTML)=\{?([^}\]]*)\}?\]\{structure\}/.exec(pre);
  if (named) vars['--accent'] = /,/.test(named[1]) ? `rgb(${named[1]})` : resolveColor(named[1], { colors });
  const serif = /\\usefonttheme(\[[^\]]*\])?\{serif\}/.test(pre);
  const outer = /\\useoutertheme(?:\[[^\]]*\])?\{([^}]*)\}/.exec(pre)?.[1];
  let footline: DeckMeta['footline'] = (themeName && INFOLINES.test(themeName[2].trim())) || outer === 'infolines' ? 'infolines' : 'number';
  if (/\\setbeamertemplate\{footline\}\s*\{\s*\}/.test(pre)) footline = 'none';
  if (/\\setbeamertemplate\{footline\}\s*\[(frame number|page number)\]/.test(pre)) footline = 'number';
  const progress = metropolis && /progressbar\s*=\s*(frametitle|foot|head)/.test(String(themeName?.[1] ?? '') + pre.match(/\\metroset\{[^}]*\}/g)?.join(''));
  const covered = /\\setbeamercovered\{\s*(transparent|dynamic|highly dynamic)/.test(pre);
  const appendixNumbering = /\\usepackage(\[[^\]]*\])?\{appendixnumberbeamer\}/.test(pre);

  // ---- graphics, listings, bibliography
  const graphicsPath = [...(preambleArg(pre, 'graphicspath')?.long.matchAll(/\{([^}]*)\}/g) ?? [])].map((m) => m[1]);
  const lst: Record<string, string | true> = {};
  for (const m of (pre + body).matchAll(/\\(?:lstset|setminted)(?:\[[^\]]*\])?\{((?:[^{}]|\{[^{}]*\})*)\}/g)) Object.assign(lst, parseKeyVals(m[1]));
  const bibFiles = [...(pre + body).matchAll(/\\(?:addbibresource|bibliography)(?:\[[^\]]*\])?\{([^}]*)\}/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
  const bib = new Map<string, BibEntry>();
  for (const f of bibFiles) {
    const file = findFile(f, baseDir, [], ['', '.bib']);
    if (!file) { warnings.push({ message: `bibliography ${f}: file not found` }); continue; }
    for (const e of parseBib(readFileSync(file, 'utf8'))) bib.set(e.key, e);
  }
  const biblatexOpts = /\\usepackage\[([^\]]*)\]\{biblatex\}/.exec(pre)?.[1] ?? '';
  const natbib = /\\usepackage(\[([^\]]*)\])?\{natbib\}/.exec(pre);
  const bibstyle = /\\bibliographystyle\{([^}]*)\}/.exec(pre + body)?.[1] ?? '';
  const authorYear = /style\s*=\s*(authoryear|apa|chicago|mla|ext-authoryear|authortitle)/.test(biblatexOpts) ||
    (!!natbib && !/numbers/.test(natbib[2] ?? '') && !/^(plain|abbrv|unsrt|ieeetr|alpha|siam|acm|IEEEtran)$/.test(bibstyle));
  const bibitems = [...body.matchAll(/\\bibitem(?:\[([^\]]*)\])?\{([^}]*)\}/g)];
  const citeOrder: string[] = bibitems.map((m) => m[2].trim());
  const bibitemLabel = new Map(bibitems.filter((m) => m[1]).map((m) => [m[2].trim(), m[1]]));
  for (const m of body.matchAll(/\\(?:[a-zA-Z]*cite[a-z]*|nocite)\*?(?:\[[^\]]*\]){0,2}\{([^}]*)\}/g)) {
    for (const k of m[1].split(',').map((s) => s.trim())) {
      if (k === '*') { for (const key of bib.keys()) if (!citeOrder.includes(key)) citeOrder.push(key); continue; }
      if (k && !citeOrder.includes(k)) citeOrder.push(k);
    }
  }
  const nocited = /\\nocite\{\*\}/.test(body);

  // ---- metadata
  const baseCtx = {
    colors, macros: defs.macros, baseDir, graphicsPath, lst, envs: defs.envs, theorems: defs.theorems,
    latexPreamble: fragmentPreamble(pre), latexTheme: theme,
    eq: { n: 0, labels: new Map<string, string>() },
    code: (s: string, lang: string | null) => highlight(s, normalizeLang(lang)),
    alertColor: 'orange',
  };
  let metaRef: DeckMeta | null = null;
  let section = '', subsection = '', sectionIdx = 0, subsectionIdx = 0, frameNo = 0;
  let curTitle = '';
  const sections: { title: string; short: string; subs: string[] }[] = [];
  for (const { name, r } of occurrences(body, /\\(sub)?section(?![A-Za-z])/)) {
    if (r.readStar()) continue;
    const short = r.readOptional();
    const t = r.readGroup();
    if (name === '\\section') sections.push({ title: t, short: short ?? t, subs: [] });
    else if (sections.length) sections[sections.length - 1].subs.push(short ?? t);
  }

  const mkCtx = (steps = new Steps(handout)): Ctx => {
    const ctx: Ctx = {
      ...baseCtx,
      steps,
      footnotes: [] as Footnote[],
      warn: (msg) => {
        const key = `${where.slide}|${msg}`;
        if (!seen.has(key)) { seen.add(key); warnings.push({ ...where, message: msg }); }
      },
      cite: (cmd, keys, preNote, post) => cite(cmd, keys, preNote, post, ctx),
      insert: (name) => insertValue(name),
      image: (o, p, attrs, inl) => imageHtml(o, p, ctx, attrs, inl),
      fragment: (s) => latexFigure(s, ctx, false),
      toc: (o) => toc(o, ctx),
      bibliography: (o) => bibliography(o, ctx),
    };
    return ctx;
  };
  const metaCtx = mkCtx();
  const field = (cmd: string) => { const v = preambleArg(pre, cmd); return v === null ? { long: '', short: '' } : { long: inline(v.long, metaCtx), short: v.short !== null ? inline(v.short, metaCtx) : '' }; };
  const authorRaw = preambleArg(pre, 'author');
  const authorHtml = authorRaw ? authorRaw.long.split(/\\and(?![A-Za-z])/).map((a) => `<span class="t-person">${inline(a.trim(), metaCtx)}</span>`).join('') : '';
  const instRaw = preambleArg(pre, 'institute');
  const instHtml = instRaw ? instRaw.long.split(/\\and(?![A-Za-z])/).map((a) => `<span class="t-person">${inline(a.trim(), metaCtx)}</span>`).join('') : '';
  const t = field('title'), st = field('subtitle'), dt = preambleArg(pre, 'date');
  const date = dt === null ? { long: inline('\\today', metaCtx), short: '' } : { long: inline(dt.long, metaCtx), short: dt.short ? inline(dt.short, metaCtx) : '' };
  const tg = preambleArg(pre, 'titlegraphic');
  const lg = preambleArg(pre, 'logo');
  const plainText = (h: string) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const meta: DeckMeta = {
    title: t.long, subtitle: st.long, author: authorHtml, institute: instHtml, date: date.long, theme,
    shortTitle: t.short || plainText(t.long), shortAuthor: authorRaw?.short ? inline(authorRaw.short.replace(/\s*\\and(?![A-Za-z])\s*/g, ', '), metaCtx) : plainText(inline((authorRaw?.long ?? '').replace(/\s*\\and(?![A-Za-z])\s*/g, ', ').replace(/\\inst\{[^}]*\}|\\thanks\{[^}]*\}/g, ''), metaCtx)),
    shortDate: date.short || date.long,
    titlegraphic: tg ? blocks(tg.long, metaCtx, { notes: [], scenes: [], titlepage: false }).replace(/ data-(from|until)="\d+"/g, '') : '',
    logo: lg ? inline(lg.long, metaCtx).replace(/ data-(from|until)="\d+"/g, '') : '',
    width, vars, serif, footline, progress, totalFrames: 0, handout,
  };
  metaRef = meta;

  function insertValue(name: string): string | null {
    const m = metaRef!;
    switch (name) {
      case 'insertsection': case 'insertsectionhead': case 'insertsectionnavigation': return section;
      case 'insertsubsection': case 'insertsubsectionhead': return subsection;
      case 'insertsectionnumber': return String(sectionIdx);
      case 'insertsubsectionnumber': return String(subsectionIdx);
      case 'inserttitle': return m.title;
      case 'insertshorttitle': return m.shortTitle;
      case 'insertsubtitle': return m.subtitle;
      case 'insertauthor': return m.author;
      case 'insertshortauthor': return m.shortAuthor;
      case 'insertinstitute': case 'insertshortinstitute': return m.institute;
      case 'insertdate': case 'insertshortdate': return m.shortDate;
      case 'insertframenumber': case 'insertpagenumber': return String(frameNo);
      case 'inserttotalframenumber': case 'insertmainframenumber': case 'insertpresentationendpage': return '<span class="ins-total"></span>';
      case 'insertframetitle': return curTitle;
      case 'insertlogo': return m.logo;
      default: return null;
    }
  }

  // ---- citations
  const numberOf = (k: string) => citeOrder.indexOf(k) + 1;
  function cite(cmd: string, keys: string[], preNote: string | null, post: string | null, ctx: Ctx): string {
    if (cmd === 'nocite') return '';
    const parts = keys.map((k) => {
      const e = bib.get(k);
      const n = numberOf(k);
      if (!e && !n) { ctx.warn(`citation "${k}" not found`); return { k, label: '?', author: k, year: '', e }; }
      if (!e && !bibitems.length) ctx.warn(`citation "${k}" not found in the bibliography`);
      const label = bibitemLabel.get(k) ?? String(n);
      return { k, label, author: e ? inline(authorShort(e), ctx) : k, year: e ? bibYear(e) : '', e };
    });
    const notes = (s: string) => (preNote ? `${inline(preNote, ctx)} ` : '') + s + (post ? `, ${inline(post, ctx)}` : '');
    const wrap = (s: string) => `<span class="cite">${s}</span>`;
    if (cmd === 'fullcite') return parts.map((p) => (p.e ? formatEntry(p.e, (s) => inline(s, ctx)) : esc(p.k))).join('; ');
    if (cmd === 'citeauthor') return parts.map((p) => p.author).join(', ');
    if (cmd === 'citeyear' || cmd === 'citeyearpar') return parts.map((p) => p.year).join(', ');
    if (cmd === 'citetitle') return parts.map((p) => (p.e?.fields.title ? `<em>${inline(p.e.fields.title, ctx)}</em>` : p.k)).join(', ');
    const textual = /^(citet|textcite|citealt)$/.test(cmd) || (authorYear && cmd === 'cite' && !!natbib);
    if (authorYear && bib.size) {
      if (textual) return wrap(parts.map((p, i) => `${p.author} (${i === parts.length - 1 ? notes(p.year) : p.year})`).join('; '));
      const inner = notes(parts.map((p) => `${p.author}${cmd === 'citealp' ? ' ' : ', '}${p.year}`).join('; '));
      return wrap(cmd === 'citealp' ? inner : `(${inner})`);
    }
    if (textual) return wrap(parts.map((p) => `${p.author} [${p.label}]`).join(', '));
    return wrap(`[${notes(parts.map((p) => p.label).join(', '))}]`);
  }

  function bibliography(_opts: string | null, ctx: Ctx): string {
    let keys = citeOrder.filter((k) => bib.has(k));
    if (nocited) keys = [...bib.keys()];
    if (!keys.length) { ctx.warn('bibliography is empty (no \\cite found, or the .bib file is missing)'); return ''; }
    if (authorYear) keys.sort((a, b) => authorShort(bib.get(a)!).localeCompare(authorShort(bib.get(b)!)) || bibYear(bib.get(a)!).localeCompare(bibYear(bib.get(b)!)));
    const items = keys.map((k) => {
      const e = bib.get(k)!;
      const label = authorYear ? '' : `<span class="bib-label">[${numberOf(k)}]</span>`;
      return `<li>${label}<span class="bib-text">${formatEntry(e, (s) => inline(s, ctx))}</span></li>`;
    });
    return `<ol class="bib${authorYear ? ' authoryear' : ''}">${items.join('')}</ol>`;
  }

  // ---- table of contents
  function toc(opts: string | null, ctx: Ctx): string {
    const kv = parseKeyVals(opts);
    const current = !!kv.currentsection || !!kv.currentsubsection;
    const hideAllSubs = !!kv.hideallsubsections || !!kv.hidesubsections;
    const hideOtherSubs = !!kv.hideothersubsections;
    const first = typeof kv.firstsection === 'string' ? parseInt(kv.firstsection, 10) : 1;
    const pause = !!kv.pausesections || !!kv.pausesubsections;
    let html = '';
    sections.forEach((s, i) => {
      const idx = i + 1;
      if (idx < first) return;
      if (typeof kv.sections === 'string' && !kv.sections.split(',').some((p) => { const [a, b] = p.split('-').map(Number); return idx >= a && idx <= (b || a); })) return;
      if (pause && html) ctx.steps.pause();
      const shaded = current && idx !== sectionIdx;
      const subs = hideAllSubs || (hideOtherSubs && idx !== sectionIdx) || (current && idx !== sectionIdx && kv.subsectionstyle !== 'show') ? [] : s.subs;
      const subHtml = subs.length ? `<ul>${subs.map((sub) => `<li>${inline(sub, ctx)}</li>`).join('')}</ul>` : '';
      html += `<li class="${shaded ? 'shaded' : current ? 'current' : ''}"${stepAttrs(ctx.steps.here())}><a class="jump" data-goto="sec:${idx}">${inline(s.short, ctx)}</a>${subHtml}</li>`;
    });
    return `<ol class="toc">${html.replace(/ class=""/g, '')}</ol>`;
  }

  const deck: Deck = { meta, slides: [], scenes: [], warnings };
  const labels = new Map<string, number>();
  const atBegin: Record<string, string | null> = { section: null, subsection: null, part: null };
  const titleSlide = (): Slide => ({ kind: 'title', html: '', steps: 1, notes: [], covered: false, plain: true, frameNo: null, sectionIdx, footnotes: '' });
  let inAppendix = false;
  let mainFrames = 0;

  const pageSlide = (kind: 'section' | 'subsection' | 'part', title: string): Slide => {
    const n = kind === 'section' ? String(sectionIdx) : '';
    const html = `<div class="secpage secpage-${kind}">${n && kind === 'section' ? `<div class="secnum">${n}</div>` : ''}<h1>${title}</h1><div class="t-rule"></div>${kind === 'subsection' && section ? `<p class="secparent">${section}</p>` : ''}</div>`;
    return { kind: 'section', pageKind: kind, html, steps: 1, notes: [], covered: false, plain: true, frameNo: null, sectionIdx, section: section || undefined, footnotes: '' };
  };

  function frame(opts: string | null, title: string | null, subtitle: string | null, content: string, offset: number | null) {
    const kv = parseKeyVals(opts);
    where = { slide: deck.slides.length + 1, ...locate(offset) };
    if (!kv.noframenumbering) frameNo++;
    const steps = new Steps(handout);
    const ctx = mkCtx(steps);
    const fs: FrameState = { notes: [], scenes: [], titlepage: false };
    curTitle = '';
    if (title !== null) { fs.title = inline(title, ctx); curTitle = fs.title; }
    if (subtitle !== null) fs.subtitle = inline(subtitle, ctx);
    let html: string;
    try { html = blocks(content, ctx, fs); }
    catch (e) { ctx.warn(`frame could not be parsed: ${(e as Error).message}`); html = `<p class="err">${esc((e as Error).message)}</p>`; }
    where = {};
    if (fs.titlepage) { const s = titleSlide(); s.notes = fs.notes; deck.slides.push(s); return; }
    if (fs.page) { const s = pageSlide(fs.page, fs.page === 'section' ? section : fs.page === 'subsection' ? subsection : section); s.notes = fs.notes; deck.slides.push(s); return; }

    const { map, count } = steps.compaction();
    html = compactHtml(html, map, count);
    const offsetScenes = deck.scenes.length;
    html = html.replace(/data-scene="(\d+)"/g, (_, i) => `data-scene="${offsetScenes + Number(i)}"`);
    for (const sc of fs.scenes) {
      for (const ev of sc.events) ev.step = map(ev.step);
      deck.scenes.push(sc);
    }
    const footnotes = (ctx.footnotes ?? []).map((f) => compactHtml(`<div class="fnote"${stepAttrs(f.range)}><sup>${esc(f.mark)}</sup> ${f.html}</div>`, map, count)).join('');
    const label = typeof kv.label === 'string' ? kv.label.trim() : undefined;
    if (label) labels.set(label, deck.slides.length);
    const align = kv.t || kv.T ? 't' : kv.c ? 'c' : kv.b ? 'b' : undefined;
    deck.slides.push({
      kind: 'frame', section: section || undefined, subsection: subsection || undefined, sectionIdx, title: fs.title, subtitle: fs.subtitle,
      html, steps: count, notes: fs.notes, covered, plain: !!kv.plain || !!kv.standout, frameNo: kv.noframenumbering ? null : frameNo, label, align,
      footnotes, transition: fs.transition, standout: !!kv.standout, background: background || undefined,
    });
    if (!inAppendix) mainFrames = frameNo;
  }

  // \usebackgroundtemplate / \setbeamertemplate{background}: preamble-wide, or scoped to a { … } group.
  const bgHtml = (src: string) => inline(src, metaCtx).replace(/ data-(from|until)="\d+"/g, '');
  const bgPre = preambleArg(pre, 'usebackgroundtemplate');
  let background = bgPre ? bgHtml(bgPre.long) : '';
  const bgStack: string[] = [];
  function walk(text: string, base: number | null) {
    const r = new Reader(text);
    while (!r.done) {
      if (r.peek() === '{') { bgStack.push(background); r.pos++; continue; }
      if (r.peek() === '}') { if (bgStack.length) background = bgStack.pop()!; r.pos++; continue; }
      if (r.peek() !== '\\') { r.pos++; continue; }
      const at = r.pos;
      let name: string;
      try { name = r.readCommandName(); } catch { r.pos++; continue; }
      const off = base === null ? null : base + at;
      try {
        if (name === 'section' || name === 'subsection' || name === 'subsubsection' || name === 'part') {
          const star = r.readStar();
          r.readOptional();
          const t = inline(r.readGroup(), metaCtx);
          if (name === 'section') {
            section = t; subsection = ''; subsectionIdx = 0;
            if (!star) sectionIdx++;
            if (!star && atBegin.section !== null) walk(atBegin.section, null);
            else if (!star && metropolis && metroOpts.sectionpage !== 'none') deck.slides.push(pageSlide('section', t));
          } else if (name === 'subsection') {
            subsection = t;
            if (!star) subsectionIdx++;
            if (!star && atBegin.subsection !== null) walk(atBegin.subsection, null);
            else if (!star && metropolis && metroOpts.subsectionpage === 'progressbar') deck.slides.push(pageSlide('subsection', t));
          } else if (name === 'part') {
            if (atBegin.part !== null) walk(atBegin.part, null);
          }
          continue;
        }
        if (name === 'AtBeginSection' || name === 'AtBeginSubsection' || name === 'AtBeginPart') {
          r.readOptional();
          atBegin[name.slice(7).toLowerCase()] = r.readGroup();
          continue;
        }
        if (name === 'appendix') { inAppendix = true; continue; }
        if (name === 'titlepage' || name === 'maketitle') { deck.slides.push(titleSlide()); continue; }
        if (name === 'note') {
          r.readStar(); r.readOverlay();
          const o = r.readOptional();
          const b = r.readGroup();
          const last = deck.slides[deck.slides.length - 1];
          if (last) last.notes.push(o && /item/.test(o) ? `<ul class="note-items"><li>${inline(b, metaCtx)}</li></ul>` : blocks(b, metaCtx, { notes: [], scenes: [], titlepage: false }).replace(/ data-(from|until|on)="[^"]*"/g, ''));
          continue;
        }
        if (name === 'againframe') {
          r.readOptional(); const ov = r.readOverlay(); r.readOptional();
          const lab = r.readGroup().trim();
          const i = labels.get(lab);
          if (i === undefined) { warnings.push({ ...locate(off), message: `\\againframe{${lab}}: no frame with that label` }); continue; }
          const orig = deck.slides[i];
          let html = orig.html, steps = orig.steps;
          if (ov) {
            // Show only the requested part: start at its first step.
            const from = Math.max(0, (parseInt(ov, 10) || 1) - 1);
            html = html.replace(/data-from="(\d+)"/g, (_, n) => `data-from="${Math.max(0, +n - from)}"`).replace(/data-until="(\d+)"/g, (_, n) => `data-until="${Math.max(0, +n - from)}"`);
            steps = Math.max(1, steps - from);
          }
          deck.slides.push({ ...orig, html, steps, label: undefined, notes: [...orig.notes] });
          continue;
        }
        if (name === 'logo') { meta.logo = inline(r.readGroup(), metaCtx); continue; }
        if (name === 'usebackgroundtemplate') { background = bgHtml(r.readGroup()); continue; }
        if (name === 'setbeamertemplate') {
          const save = r.pos;
          const what = r.readGroup().trim();
          if (what === 'background' || what === 'background canvas') { r.readOptional(); background = bgHtml(r.readGroup()); continue; }
          r.pos = save;
          continue;
        }
        if (name === 'frame' || (name === 'begin' && peekEnv(r) === 'frame')) {
          let opts: string | null = null, title: string | null = null, subtitle: string | null = null, content: string;
          if (name === 'frame') {
            r.readOverlay();
            opts = r.readOptional();
            r.readOverlay();
            r.skipSpace();
            if (r.peek() !== '{') continue; // \frame used as text
            content = r.readGroup();
          } else {
            r.readGroup();
            r.readOverlay();
            opts = r.readOptional();
            r.readOverlay();
            // `\begin{frame}{Title}{Subtitle}`: groups must follow on the same logical line.
            const tryGroup = () => {
              const save = r.pos;
              r.skipSpace(false);
              if (r.peek() === '\n') { r.pos++; r.skipSpace(false); if (r.peek() !== '{') { r.pos = save; return null; } }
              if (r.peek() === '{') return r.readBalanced('{', '}');
              r.pos = save;
              return null;
            };
            title = tryGroup();
            if (title !== null) subtitle = tryGroup();
            content = r.readEnvBody('frame');
          }
          frame(opts, title, subtitle, content, off);
          continue;
        }
      } catch (e) {
        warnings.push({ ...locate(off), message: (e as Error).message });
      }
    }
  }

  // \AtBeginSection etc. usually sit in the preamble.
  for (const { name, r } of occurrences(pre, /\\AtBegin(Section|Subsection|Part)(?![A-Za-z])/)) {
    try { r.readOptional(); atBegin[name.slice(8).toLowerCase()] = r.readGroup(); } catch { /* malformed */ }
  }
  walk(body, 0);
  meta.totalFrames = appendixNumbering && inAppendix ? mainFrames : frameNo;

  // ---- cross references and totals
  const refFor = (key: string, kind: string): string => {
    const eq = baseCtx.eq.labels.get(key);
    if (eq !== undefined) return kind === 'eqref' ? `(${eq})` : eq;
    const s = labels.get(key);
    if (s !== undefined) return String(deck.slides[s].frameNo ?? s + 1);
    warnings.push({ message: `\\${kind}{${key}}: undefined label` });
    return '??';
  };
  for (const s of deck.slides) {
    s.html = s.html
      .replace(/<span class="ref" data-ref="([^"]*)" data-kind="([^"]*)">\?\?<\/span>/g, (_, k, kind) => `<span class="ref">${refFor(k, kind)}</span>`)
      .replace(/<span class="ins-total"><\/span>/g, String(meta.totalFrames));
    s.footnotes = s.footnotes.replace(/<span class="ins-total"><\/span>/g, String(meta.totalFrames));
  }
  if (!deck.slides.length) warnings.push({ message: 'no frames found' });
  return deck;
}

function peekEnv(r: Reader): string {
  const save = r.pos;
  r.skipSpace();
  const env = r.peek() === '{' ? r.readBalanced('{', '}').trim() : '';
  r.pos = save;
  return env;
}

/** `\mode<article>{…}` is dropped, `\mode<presentation>{…}` unwrapped, bare `\mode<…>` switches ignored. */
function stripModes(src: string): string {
  let out = '';
  const r = new Reader(src);
  let last = 0;
  const re = /\\mode(?![A-Za-z])/g;
  let m;
  while ((m = re.exec(src))) {
    r.pos = m.index + m[0].length;
    const star = r.readStar();
    const ov = star ? null : r.readOverlay();
    out += src.slice(last, m.index);
    const save = r.pos;
    r.skipSpace(false);
    if (ov !== null && r.peek() === '{') {
      const inner = r.readBalanced('{', '}');
      const keep = /beamer|presentation|all/.test(ov) && !/^\s*article\s*$/.test(ov);
      out += keep ? inner : '';
    } else if (ov !== null && /article/.test(ov) && !/beamer|presentation/.test(ov)) {
      // \mode<article> switch: skip until the next \mode switch.
      const next = src.indexOf('\\mode', r.pos);
      r.pos = next < 0 ? src.length : next;
    } else r.pos = save;
    last = r.pos;
    re.lastIndex = r.pos;
  }
  return out + src.slice(last);
}

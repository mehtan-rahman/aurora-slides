// Block-level structure of a frame body → HTML with step attributes.
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { Reader, parseKeyVals } from './reader.ts';
import { inline, mathBlock, stepAttrs, esc, expandMacro, cssLength, resolveColor, modelColor, type Ctx, type Range } from './inline.ts';
import { hasOverlays, resolveRelative, changePoints, atSlide } from './overlay.ts';
import { parseScene, type SceneSpec } from './scene.ts';
import { latexAvailable, renderLatex } from './latexsvg.ts';
import { graphicUri, mediaUri, findFile } from './media.ts';
import { highlight, normalizeLang } from './highlight.ts';

export interface FrameState {
  title?: string;
  subtitle?: string;
  notes: string[];
  scenes: SceneSpec[];
  titlepage: boolean;
  /** \sectionpage, \subsectionpage, \partpage inside the frame. */
  page?: 'section' | 'subsection' | 'part';
  /** \transfade etc. */
  transition?: string;
}

const MATH_ENVS = new Set(['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'flalign', 'flalign*', 'alignat', 'alignat*', 'eqnarray', 'eqnarray*', 'displaymath', 'math', 'dmath', 'dmath*']);
const LISTS: Record<string, string> = { itemize: 'ul', enumerate: 'ol', description: 'dl', compactitem: 'ul', compactenum: 'ol', inparaenum: 'ol', asparaitem: 'ul', asparaenum: 'ol', compactdesc: 'dl' };
const BOXES: Record<string, string> = { block: 'box', alertblock: 'box box-alert', exampleblock: 'box box-example' };
const LATEX_ENVS = new Set(['tikzpicture', 'circuitikz', 'tikzcd', 'forest', 'chemfig', 'schemestart', 'algorithmic', 'algorithm', 'algorithm2e', 'algorithmicx', 'pgfpicture', 'picture', 'feynman', 'feynmandiagram', 'quantikz', 'dynkinDiagram', 'axis', 'smartdiagram', 'pspicture', 'tikztimingtable', 'bytefield', 'chemmacros', 'tcolorbox*', 'qcircuit', 'tabu', 'karnaugh-map', 'circuit', 'mol', 'sequencediagram', 'umlsystem', 'genealogypicture', 'dot2tex', 'ganttchart', 'neuralnetwork']);
const SPACERS = new Set(['vfill', 'vfil', 'vspace', 'medskip', 'bigskip', 'smallskip', 'vskip']);
const QUOTES = new Set(['quote', 'quotation', 'verse']);
const VERBATIM = new Set(['verbatim', 'verbatim*', 'Verbatim', 'BVerbatim', 'LVerbatim', 'lstlisting', 'minted', 'alltt']);
const OVERLAY_CMDS = new Set(['only', 'uncover', 'visible', 'invisible', 'onslide', 'alt', 'temporal', 'action']);
const OVERLAY_ENVS: Record<string, string> = { onlyenv: 'only', uncoverenv: 'uncover', visibleenv: 'visible', invisibleenv: 'invisible', actionenv: 'uncover' };

/** Content that cannot live inside a <span>. */
const BLOCKY = /\n[ \t]*\n|\\begin\s*\{|\\item(?![A-Za-z])|\\includegraphics|\\\[|\$\$|\\par(?![A-Za-z])|\\(movie|includemedia|animategraphics|tableofcontents|vspace|centering|column|framezoom|video)(?![A-Za-z])/;

// ---------------------------------------------------------------- images & media

/** Stage pixels per PostScript point: Beamer's 16:9 page is 160 mm wide on a 1920 px stage. */
const PX_PER_BP = 1920 / (160 / 25.4 * 72);

/** A TeX length in big points (bare numbers are bp, as in graphicx's trim/viewport). */
function bpLength(s: string): number {
  const m = /^(-?[\d.]+)\s*(bp|pt|cm|mm|in|px)?$/.exec(s.trim());
  if (!m) return 0;
  return +m[1] * { bp: 1, pt: 0.99626, cm: 28.3465, mm: 2.83465, in: 72, px: 0.75 }[(m[2] ?? 'bp') as 'bp'];
}

export function imageHtml(opts: string | null, path: string, ctx: Ctx, attrs: string, inlineImg = false): string {
  const kv = parseKeyVals(opts);
  const page = typeof kv.page === 'string' ? parseInt(kv.page, 10) || 1 : 1;
  const g = graphicUri(path, ctx.baseDir, ctx.graphicsPath, page);
  if ('error' in g) {
    ctx.warn(`image ${path.trim()}: ${g.error}`);
    return `<div class="img-missing"${attrs}>${esc(path)}</div>`;
  }
  const keys = Object.keys(kv);
  let w = typeof kv.width === 'string' ? cssLength(kv.width) : null;
  let h = typeof kv.height === 'string' ? cssLength(kv.height, 'y') : typeof kv.totalheight === 'string' ? cssLength(kv.totalheight, 'y') : null;
  if (w === 'auto') w = null;
  if (h === 'auto') h = null;
  const angle = typeof kv.angle === 'string' ? parseFloat(kv.angle) || 0 : 0;
  const quarter = Math.abs(angle) % 180 === 90;
  // graphicx applies keys in order: a size given after angle= sizes the rotated box.
  const sizeAt = ['width', 'height', 'totalheight'].map((k) => keys.indexOf(k)).filter((i) => i >= 0);
  if (quarter && sizeAt.length && keys.indexOf('angle') < Math.min(...sizeAt)) [w, h] = [h, w];
  const nat = g.bp;
  // trim=l b r t, or viewport=llx lly urx ury, in bp of the natural size.
  let trim: number[] | null = null;
  if (typeof kv.trim === 'string') trim = kv.trim.trim().split(/[\s,]+/).map(bpLength);
  else if (typeof kv.viewport === 'string' && nat) {
    const [x0, y0, x1, y1] = kv.viewport.trim().split(/[\s,]+/).map(bpLength);
    trim = [x0, y0, nat[0] - x1, nat[1] - y1];
  }
  if (trim && (trim.length !== 4 || !nat)) trim = null;
  const fw = trim && nat ? 1 - (trim[0] + trim[2]) / nat[0] : 1, fh = trim && nat ? 1 - (trim[1] + trim[3]) / nat[1] : 1;
  const scale = typeof kv.scale === 'string' ? parseFloat(kv.scale) || 1 : 1;
  // No size given: Beamer's natural size (pixels at the image's dpi), times scale.
  if (!w && !h && nat) w = `${Math.round(nat[0] * fw * PX_PER_BP * scale)}px`;
  const style: string[] = [];
  if (w) style.push(`width:${w}`);
  if (h) style.push(`height:${h}`);
  if (!w && !h && scale !== 1) style.push(`--scale:${scale}`);
  if (angle) style.push(`rotate:${-angle}deg`);
  const rot = quarter ? ' data-rot' : '';
  const cls = `fig${inlineImg ? ' inl' : ''}${!w && !h && scale !== 1 ? ' scaled' : ''}`;
  const alt = esc(path.trim());
  if (trim && nat && fw > 0 && fh > 0) {
    // Crop window: the wrapper has the trimmed aspect; the image is enlarged and shifted inside it.
    if (!(w && h)) style.push(`aspect-ratio:${(nat[0] * fw).toFixed(2)}/${(nat[1] * fh).toFixed(2)}`);
    if (kv.clip || kv.clip === '') style.push('overflow:hidden');
    const inner = `position:absolute;max-width:none;max-height:none;width:${(100 / fw).toFixed(3)}%;height:${(100 / fh).toFixed(3)}%;` +
      `left:${(-(trim[0] / nat[0]) / fw * 100).toFixed(3)}%;top:${(-(trim[3] / nat[1]) / fh * 100).toFixed(3)}%`;
    return `<span class="${cls} crop"${attrs}${rot} style="${style.join(';')}"><img style="${inner}" src="${g.uri}" alt="${alt}"></span>`;
  }
  if (w && h && kv.keepaspectratio !== undefined) style.push('object-fit:contain');
  return `<img class="${cls}"${attrs}${rot} style="${style.join(';')}" src="${g.uri}" alt="${alt}">`;
}

function mediaHtml(opts: string | null, file: string, ctx: Ctx, attrs: string): string {
  const kv = parseKeyVals(opts);
  const m = mediaUri(file, ctx.baseDir);
  if (!m) { ctx.warn(`media ${file.trim()}: not found`); return `<div class="img-missing"${attrs}>${esc(file)}</div>`; }
  if (!m.embedded) ctx.warn(`media ${file.trim()}: larger than 40 MB, linked (keep it next to the HTML file)`);
  const style: string[] = [];
  if (typeof kv.width === 'string') style.push(`width:${cssLength(kv.width)}`);
  if (typeof kv.height === 'string') style.push(`height:${cssLength(kv.height, 'y')}`);
  const auto = kv.autostart || kv.autoplay || /pageopen|pagevisible/.test(String(kv.activate ?? ''));
  const flags = [auto ? ' data-autoplay' : '', kv.loop || kv.palindrome ? ' loop' : '', kv.showcontrols || kv.controls || !auto ? ' controls' : '', kv.mute || kv.muted ? ' muted' : ''].join('');
  const posterUri = typeof kv.poster === 'string' ? graphicUri(kv.poster, ctx.baseDir, ctx.graphicsPath) : null;
  const posterAttr = posterUri && 'uri' in posterUri ? ` poster="${posterUri.uri}"` : '';
  const tag = m.mime.startsWith('audio') ? 'audio' : 'video';
  return `<div class="figwrap"${attrs}><${tag} class="media" playsinline preload="auto"${flags}${posterAttr} style="${style.join(';')}" src="${m.uri}"></${tag}></div>`;
}

/** \animategraphics[opts]{fps}{prefix}{first}{last}: an embedded image sequence. */
function animateGraphics(opts: string | null, fps: string, prefix: string, first: string, last: string, ctx: Ctx, attrs: string): string {
  const kv = parseKeyVals(opts);
  const a = parseInt(first, 10), b = parseInt(last, 10);
  const pad = /^0\d/.test(first.trim()) ? first.trim().length : 0;
  const frames: string[] = [];
  if (Number.isFinite(a) && Number.isFinite(b)) {
    for (let i = a; i <= b && frames.length < 600; i++) {
      const g = graphicUri(prefix.trim() + String(i).padStart(pad, '0'), ctx.baseDir, ctx.graphicsPath);
      if ('uri' in g) frames.push(g.uri);
    }
  }
  if (!frames.length) { ctx.warn(`animategraphics ${prefix}: no frames found`); return `<div class="img-missing"${attrs}>${esc(prefix)}</div>`; }
  const style: string[] = [];
  if (typeof kv.width === 'string') style.push(`width:${cssLength(kv.width)}`);
  if (typeof kv.height === 'string') style.push(`height:${cssLength(kv.height, 'y')}`);
  const flags = `${kv.autoplay ? ' data-autoplay' : ''}${kv.loop ? ' data-loop' : ''}${kv.palindrome ? ' data-palindrome' : ''}`;
  return `<div class="figwrap"${attrs}><div class="anim" data-fps="${parseFloat(fps) || 12}"${flags} style="${style.join(';')}">${frames.map((f, i) => `<img src="${f}"${i ? ' hidden' : ''}>`).join('')}</div></div>`;
}

// ---------------------------------------------------------------- LaTeX fragments

/**
 * Compiles a fragment with LaTeX. Overlays inside it (`\draw<2->`, `\only<3>`,
 * `\pause`, `\visible<2->`) become stacked, step-timed layers that share one
 * bounding box (hidden TikZ content is drawn transparent, not removed).
 */
export function latexFigure(src: string, ctx: Ctx, display = true): string {
  const cls = display ? 'latex-fig' : 'latex-inline';
  const here = ctx.steps.here();
  if (!latexAvailable()) {
    ctx.warn('a LaTeX fragment (TikZ/chemfig/…) needs `latex` and `dvisvgm` on PATH; showing a placeholder');
    return display ? `<div class="img-missing"${stepAttrs(here)}>LaTeX figure</div>` : '<span class="img-missing">LaTeX</span>';
  }
  const render = (body: string) => {
    try { return renderLatex(body, ctx.latexPreamble ?? '', 3, ctx.latexTheme, { baseDir: ctx.baseDir, graphicsPath: ctx.graphicsPath }); }
    catch (e) { ctx.warn(`LaTeX fragment failed: ${(e as Error).message}`); return `<span class="err">LaTeX error: ${esc((e as Error).message)}</span>`; }
  };
  if (!display || !hasOverlays(src)) return `<${display ? 'div' : 'span'} class="${cls}"${display ? stepAttrs(here) : ''}>${render(src)}</${display ? 'div' : 'span'}>`;
  const tikz = /\\begin\{(tikzpicture|circuitikz|axis)\}|\\tikz(?![A-Za-z])/.test(src);
  const resolved = resolveRelative(src, ctx.steps);
  const starts = [here.from, ...changePoints(resolved).filter((n) => n > here.from)];
  const layers: { k: number; body: string }[] = [];
  for (const k of starts) {
    const body = atSlide(resolved, k, tikz ? 'tikz' : 'text', ctx.alertColor ?? 'orange');
    if (layers.length && layers[layers.length - 1].body === body) continue;
    ctx.steps.mark(k);
    layers.push({ k, body });
  }
  if (layers.length === 1) return `<div class="${cls}"${stepAttrs(here)}>${render(layers[0].body)}</div>`;
  const html = layers.map((l, i) => {
    const until = layers[i + 1]?.k;
    const range: Range = until === undefined ? { from: l.k } : { from: l.k, until };
    return `<div class="${cls} layer"${stepAttrs(range)}${i ? ' data-anim="swap"' : ''}>${render(l.body)}</div>`;
  }).join('');
  return `<div class="latex-stack"${stepAttrs(here)}>${html}</div>`;
}

// ---------------------------------------------------------------- lists

/** Splits a list body on top-level `\item`s. */
function splitItems(body: string): string[] {
  const items: string[] = [];
  const r = new Reader(body);
  let depth = 0, start = -1;
  while (!r.done) {
    if (r.startsWith('\\begin{')) { depth++; r.pos += 7; continue; }
    if (r.startsWith('\\end{')) { depth--; r.pos += 5; continue; }
    if (r.peek() === '{') { try { r.readBalanced('{', '}'); } catch { r.pos++; } continue; }
    if (depth === 0 && r.startsWith('\\item') && !/[A-Za-z]/.test(r.peek(5) ?? '')) {
      if (start >= 0) items.push(body.slice(start, r.pos));
      r.pos += 5;
      start = r.pos;
      continue;
    }
    if (r.peek() === '\\') r.pos++;
    r.pos++;
  }
  if (start >= 0) items.push(body.slice(start));
  return items;
}

const toAlpha = (n: number) => { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; };
const toRoman = (n: number) => {
  const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return s;
};

/** Label template for an enumerate: enumitem `label=(\alph*)` or enumerate-package `[(a)]`. */
function enumFormat(opt: string | null): ((n: number) => string) | null {
  if (!opt) return null;
  const kv = parseKeyVals(opt);
  let tpl: string | null = typeof kv.label === 'string' ? kv.label : null;
  if (tpl) {
    return (n) => tpl!.replace(/\\arabic\*/g, String(n)).replace(/\\alph\*/g, toAlpha(n)).replace(/\\Alph\*/g, toAlpha(n).toUpperCase())
      .replace(/\\roman\*/g, toRoman(n)).replace(/\\Roman\*/g, toRoman(n).toUpperCase());
  }
  if (/=/.test(opt)) return null;
  // enumerate package: the first of 1 a A i I is the counter.
  const m = /(?<![\\A-Za-z])([1aAiI])(?![A-Za-z])/.exec(opt);
  if (!m) return null;
  const pre = opt.slice(0, m.index).replace(/[{}]/g, ''), post = opt.slice(m.index + 1).replace(/[{}]/g, '');
  const f = { '1': String, a: toAlpha, A: (n: number) => toAlpha(n).toUpperCase(), i: toRoman, I: (n: number) => toRoman(n).toUpperCase() }[m[1] as '1'];
  return (n) => pre + f(n) + post;
}

// ---------------------------------------------------------------- tables

/** Splits on a separator at brace depth 0, outside $…$. */
function splitCells(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, math = false, cur = '', env = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (s.startsWith('\\begin{', i)) env++;
    else if (s.startsWith('\\end{', i)) env--;
    if (c === '\\' && sep.startsWith('\\') && s.startsWith(sep, i) && depth === 0 && !math && env === 0) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
    if (c === '\\') { cur += c + (s[i + 1] ?? ''); i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '$') math = !math;
    if (c === sep && depth === 0 && !math && env === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

interface Col { align: string; width?: string; left: number; right: number; flex?: boolean }

function parseColSpec(spec: string): Col[] {
  const cols: Col[] = [];
  const sr = new Reader(spec.replace(/\s/g, ''));
  let pendingLeft = 0, pendingAlign: string | null = null;
  const push = (align: string, width?: string, flex = false) => { cols.push({ align: pendingAlign ?? align, width, left: pendingLeft, right: 0, flex }); pendingLeft = 0; pendingAlign = null; };
  while (!sr.done) {
    const c = sr.peek();
    if ('lcr'.includes(c)) { sr.pos++; push({ l: 'left', c: 'center', r: 'right' }[c]!); }
    else if ('pmb'.includes(c)) { sr.pos++; push('left', cssLength(sr.readGroup())); }
    else if (c === 'X' || c === 'L' || c === 'C' || c === 'R' || c === 'Y') { sr.pos++; push(c === 'C' ? 'center' : c === 'R' ? 'right' : 'left', undefined, c === 'X' || c === 'Y'); }
    else if (c === 'S') { sr.pos++; if (sr.peek() === '[') sr.readOptional(); push('center'); }
    else if (c === '|') { sr.pos++; if (cols.length) cols[cols.length - 1].right++; else pendingLeft++; }
    else if (c === '>') { sr.pos++; const g = sr.readGroup(); if (/\\centering/.test(g)) pendingAlign = 'center'; else if (/\\raggedleft/.test(g)) pendingAlign = 'right'; else if (/\\raggedright/.test(g)) pendingAlign = 'left'; }
    else if (c === '@' || c === '<' || c === '!') { sr.pos++; sr.readGroup(); }
    else if (c === '*') {
      sr.pos++;
      const n = parseInt(sr.readGroup(), 10);
      const inner = sr.readGroup();
      for (let i = 0; i < n; i++) for (const col of parseColSpec(inner)) cols.push(col);
    }
    else sr.pos++;
  }
  return cols;
}

function tableHtml(spec: string, body: string, ctx: Ctx): string {
  const cols = parseColSpec(spec);
  // Rule state carried between rows.
  let rows = '';
  let pendingRule = '';
  let rowColors: [string, string, number] | null = null;
  let rowIndex = 0;
  const covered: number[] = []; // remaining rowspan per column
  const rawRows = splitCells(body, '\\\\');
  // Header rows: everything before the first \midrule / \hline that follows content.
  let headerEnd = -1;
  {
    let seen = false;
    for (let i = 0; i < rawRows.length; i++) {
      const t = rawRows[i].replace(/\\(toprule|hline)(\[[^\]]*\])?/g, '').trim();
      if (/^\s*\\(midrule|hline|cmidrule)/.test(rawRows[i].replace(/^\s*\[[^\]]*\]/, '')) && seen) { headerEnd = i; break; }
      if (t.replace(/\\(midrule|cmidrule(\([^)]*\))?\{[^}]*\}|cline\{[^}]*\}|addlinespace(\[[^\]]*\])?)/g, '').trim()) seen = true;
    }
  }
  rawRows.forEach((rawRow, ri) => {
    let raw = rawRow.replace(/^\s*\[[^\]]*\]/, '');
    let range: Range = ctx.steps.here();
    let rowStyle = '';
    // Leading commands: rules, \pause, \onslide<..>, \rowcolor.
    for (;;) {
      const m = /^\s*(\\(toprule|midrule|bottomrule|hline|cline\{[^}]*\}|cmidrule(?:\([^)]*\))?\{[^}]*\}|addlinespace(?:\[[^\]]*\])?|specialrule\{[^}]*\}\{[^}]*\}\{[^}]*\}|noalign\{[^}]*\})(\[[^\]]*\])?)/.exec(raw);
      if (m) { const k = m[2].replace(/[{(\[].*$/, ''); pendingRule = k === 'toprule' ? 'top' : k === 'bottomrule' ? 'bottom' : k === 'addlinespace' ? pendingRule : k === 'cline' || k === 'cmidrule' ? pendingRule || 'thin' : 'mid'; raw = raw.slice(m[0].length); continue; }
      const p = /^\s*\\pause(?![A-Za-z])/.exec(raw);
      if (p) { ctx.steps.pause(); range = ctx.steps.here(); raw = raw.slice(p[0].length); continue; }
      const o = /^\s*\\onslide\s*<([^>]*)>/.exec(raw);
      if (o) { range = ctx.steps.overlay(o[1]); raw = raw.slice(o[0].length); continue; }
      const rc = /^\s*\\rowcolor(?:\[([^\]]*)\])?\{([^}]*)\}/.exec(raw);
      if (rc) { rowStyle = `background:${rc[1] ? modelColor(rc[1], rc[2]) : resolveColor(rc[2], ctx)}`; raw = raw.slice(rc[0].length); continue; }
      const rcs = /^\s*\\rowcolors\*?\{(\d+)\}\{([^}]*)\}\{([^}]*)\}/.exec(raw);
      if (rcs) { rowColors = [rcs[2], rcs[3], +rcs[1]]; raw = raw.slice(rcs[0].length); continue; }
      break;
    }
    // Trailing rules belong to the next row (e.g. "a & b \\ \midrule").
    const text = raw.trim();
    if (!text) return;
    if (/\\\\pause\s*$/.test(text)) { /* handled by next row */ }
    const cells = splitCells(text, '&');
    let col = 0;
    let tds = '';
    if (!rowStyle && rowColors && rowIndex + 1 >= rowColors[2]) {
      const c = (rowIndex + 1 - rowColors[2]) % 2 === 0 ? rowColors[0] : rowColors[1];
      if (c.trim()) rowStyle = `background:${resolveColor(c, ctx)}`;
    }
    const header = ri < headerEnd;
    for (const cell of cells) {
      // A \multirow above covers this column: LaTeX wants an empty placeholder cell here.
      if (covered[col] > 0) { covered[col]--; col++; if (!cell.trim()) continue; }
      let span = 1, rowspan = 1, align = cols[col]?.align ?? 'left';
      let content = cell.trim();
      const cstyle: string[] = [];
      const mc = /^\\multicolumn\s*\{(\d+)\}\s*\{([^}]*)\}\s*\{([\s\S]*)\}$/.exec(content);
      if (mc) {
        span = +mc[1];
        const cs = parseColSpec(mc[2])[0];
        if (cs) { align = cs.align; if (cs.left) cstyle.push('border-left:1px solid var(--muted)'); if (cs.right) cstyle.push('border-right:1px solid var(--muted)'); }
        content = mc[3];
      }
      const mr = /^\\multirow\s*(?:\[[^\]]*\])?\s*\{(-?\d+)\}\s*(?:\[[^\]]*\])?\s*\{[^}]*\}\s*(?:\[[^\]]*\])?\s*\{([\s\S]*)\}$/.exec(content);
      if (mr) { rowspan = Math.abs(+mr[1]); content = mr[2]; for (let k = 0; k < span; k++) covered[col + k] = (covered[col + k] ?? 0) + rowspan - 1; }
      content = content.replace(/\\cellcolor(?:\[([^\]]*)\])?\{([^}]*)\}/, (_, model, c) => { cstyle.push(`background:${model ? modelColor(model, c) : resolveColor(c, ctx)}`); return ''; });
      const colDef = cols[col];
      if (colDef?.width && !mc) cstyle.push(`width:${colDef.width}`);
      if (colDef?.left && !mc) cstyle.push(`border-left:${colDef.left > 1 ? '3px double' : '1px solid'} var(--muted)`);
      if (colDef?.right && !mc) cstyle.push(`border-right:${colDef.right > 1 ? '3px double' : '1px solid'} var(--muted)`);
      cstyle.push(`text-align:${align}`);
      const tag = header ? 'th' : 'td';
      tds += `<${tag}${span > 1 ? ` colspan="${span}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''} style="${cstyle.join(';')}">${inline(content.trim(), ctx)}</${tag}>`;
      col += span;
    }
    rowIndex++;
    const cls = pendingRule ? ` class="rule-${pendingRule}"` : '';
    rows += `<tr${cls}${rowStyle ? ` style="${rowStyle}"` : ''}${stepAttrs(range)}>${tds}</tr>`;
    pendingRule = '';
  });
  const bottom = pendingRule ? ` data-bottom="${pendingRule}"` : '';
  return `<table class="tbl"${bottom}>${rows}</table>`;
}

// ---------------------------------------------------------------- code

function rangeSet(spec: string | true | undefined): Set<number> {
  const out = new Set<number>();
  if (typeof spec !== 'string') return out;
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map((x) => parseInt(x, 10));
    if (!Number.isFinite(a)) continue;
    for (let i = a; i <= (Number.isFinite(b) ? b : a); i++) out.add(i);
  }
  return out;
}

function dedent(code: string): string {
  const lines = code.replace(/\t/g, '    ').split('\n');
  const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length));
  return Number.isFinite(ind) && ind > 0 ? lines.map((l) => l.slice(ind)).join('\n') : lines.join('\n');
}

const EXT_LANG: Record<string, string> = { '.py': 'python', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp', '.js': 'javascript', '.ts': 'typescript', '.rs': 'rust', '.go': 'go', '.java': 'java', '.sh': 'bash', '.m': 'matlab', '.r': 'r', '.R': 'r', '.jl': 'julia', '.sql': 'sql', '.hs': 'haskell', '.tex': 'tex', '.html': 'html', '.xml': 'xml', '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.rb': 'ruby', '.f90': 'fortran', '.lua': 'lua', '.kt': 'kotlin', '.swift': 'swift', '.cs': 'csharp', '.php': 'php', '.css': 'css', '.toml': 'toml', '.scala': 'scala', '.ml': 'ocaml' };

export function codeHtml(code: string, langName: string | null, opts: Record<string, string | true>, ctx: Ctx, range: Range): string {
  const lang = normalizeLang(langName);
  let text = code.replace(/^[ \t]*\n/, '').replace(/\s+$/, '');
  let lines = text.split('\n');
  const first = typeof opts.firstline === 'string' ? Math.max(1, parseInt(opts.firstline, 10)) : 1;
  const last = typeof opts.lastline === 'string' ? parseInt(opts.lastline, 10) : lines.length;
  lines = lines.slice(first - 1, last);
  if (typeof opts.gobble === 'string') { const g = parseInt(opts.gobble, 10); lines = lines.map((l) => l.slice(g)); }
  text = dedent(lines.join('\n'));
  const numbers = opts.numbers === 'left' || opts.numbers === 'right' || opts.linenos === true || opts.linenos === 'true' || opts.numbers === true;
  const start = typeof opts.firstnumber === 'string' ? parseInt(opts.firstnumber, 10) || first : first;
  const hl = rangeSet(opts.highlightlines);
  const html = lang ? highlight(text, lang) : esc(text);
  const body = html.split('\n').map((l, i) => `<span class="line${hl.has(start + i) ? ' hl' : ''}"${numbers ? ` data-n="${start + i}"` : ''}>${l || ' '}</span>`).join('\n');
  const caption = typeof opts.caption === 'string' ? opts.caption : typeof opts.title === 'string' ? opts.title : null;
  const pre = `<pre class="code${numbers ? ' numbered' : ''}${lang ? ` lang-${lang}` : ''}"><code>${body}</code></pre>`;
  return `<figure class="codewrap"${stepAttrs(range)}>${caption ? `<figcaption>${inline(caption, ctx)}</figcaption>` : ''}${pre}</figure>`;
}

/** `semiverbatim`: verbatim text where \alert<2>{…}, \only, \uncover, \pause, \\ \{ \} still work. */
function semiverbatim(body: string, ctx: Ctx): string {
  const text = dedent(body.replace(/^[ \t]*\n/, '').replace(/\s+$/, ''));
  const run = (s: string): string => {
    const r = new Reader(s);
    let out = '';
    while (!r.done) {
      const c = r.peek();
      if (c === '{' || c === '}') { r.pos++; continue; }
      if (c !== '\\') { out += esc(c); r.pos++; continue; }
      const next = s[r.pos + 1];
      if (next === '\\' || next === '{' || next === '}') { out += next; r.pos += 2; continue; }
      const save = r.pos;
      const name = r.readCommandName();
      if (name === 'pause') { ctx.steps.pause(); out += `</span><span${stepAttrs(ctx.steps.here())}>`; continue; }
      const ov = r.readOverlay();
      const arg = () => { r.skipSpace(false); return r.peek() === '{' ? r.readBalanced('{', '}') : ''; };
      switch (name) {
        case 'alert': case 'structure': case 'textbf': case 'textit': case 'emph': {
          const cls = name === 'alert' ? 'fx-alert' : name === 'structure' ? 'fx-structure' : name === 'textbf' ? 'fx-bold' : 'fx-italic';
          const b = run(arg());
          out += ov ? `<span class="fx ${cls}"${stepAttrs(ctx.steps.spec(ov).alert ?? ctx.steps.overlay(ov), 'fx-')}>${b}</span>` : `<span class="${name === 'alert' ? 'alert' : cls.replace('fx-', '')}">${b}</span>`;
          continue;
        }
        case 'only': case 'uncover': case 'visible': case 'onslide': {
          const b = arg();
          out += ov ? `<span class="ov${name === 'only' ? ' only' : ''}"${stepAttrs(ctx.steps.overlay(ov))}>${run(b)}</span>` : run(b);
          continue;
        }
        case 'textcolor': { const col = arg(); const b = run(arg()); out += `<span style="color:${resolveColor(col, ctx)}">${b}</span>`; continue; }
        case 'color': { const col = arg(); out += `<span style="color:${resolveColor(col, ctx)}">${run(s.slice(r.pos))}</span>`; r.pos = s.length; continue; }
        default: out += esc(s.slice(save, r.pos)) + (ov ? esc(`<${ov}>`) : '');
      }
    }
    return out;
  };
  const range = ctx.steps.here();
  return `<pre class="code"${stepAttrs(range)}><code><span>${run(text)}</span></code></pre>`;
}

// ---------------------------------------------------------------- blocks

/** True when the rest of the paragraph after `pos` holds nothing but spacing (or a caption). */
function aloneInPara(src: string, pos: number): boolean {
  const rest = src.slice(pos);
  const m = /\n[ \t]*\n|\\end\s*\{|\\begin\s*\{/.exec(rest);
  const para = m ? rest.slice(0, m.index) : rest;
  return para.replace(/\\\\(\[[^\]]*\])?|\\par\b|\\label\{[^}]*\}|\\(vspace|vskip)\*?\{[^}]*\}|\\(medskip|bigskip|smallskip|centering|vfill)\b|\s/g, '').replace(/^\\caption[\s\S]*$/, '') === '';
}

function wrapHfill(inner: string): { html: string; cls: string } {
  const H = '<span class="hfill"></span>';
  if (!inner.includes(H)) return { html: inner, cls: '' };
  return { html: inner.split(H).map((p) => `<span>${p}</span>`).join(H), cls: 'hf' };
}

const IMG_ONLY = /^(\s|<img [^>]*>|<span class="hfill"><\/span>|<span>|<\/span>|&nbsp;|&emsp;|<span class="hsp"[^>]*><\/span>|<span class="latex-inline">[\s\S]*?<\/svg><\/span>)*$/;

export function blocks(src: string, ctx: Ctx, fs: FrameState): string {
  const r = new Reader(src);
  let out = '';
  // A paragraph is a run of inline segments; `\pause` mid-paragraph splits it.
  let segs: { raw: string; range: Range }[] = [];
  let raw = '';
  let alignAt: { at: number; cls: string } | null = null;

  const sameRange = (a: Range, b: Range) => a.from === b.from && a.until === b.until && JSON.stringify(a.on) === JSON.stringify(b.on);
  const flushSeg = () => {
    if (raw.trim()) segs.push({ raw, range: ctx.steps.here() });
    raw = '';
  };
  const flushPara = () => {
    flushSeg();
    if (!segs.length) return;
    const first = segs[0].range;
    let inner = segs.map((s, i) => {
      const html = inline(s.raw.trim(), ctx);
      return i === 0 || sameRange(s.range, first) ? html : `<span${stepAttrs(s.range)}> ${html}</span>`;
    }).join(' ');
    const hf = wrapHfill(inner);
    inner = hf.html;
    const imgs = IMG_ONLY.test(inner) && /<img |latex-inline/.test(inner);
    const cls = [hf.cls, imgs ? 'imgs' : ''].filter(Boolean).join(' ');
    if (inner.trim()) out += `<p${cls ? ` class="${cls}"` : ''}${stepAttrs(first)}>${inner}</p>`;
    segs = [];
  };
  /** Renders `body` as blocks with every element sharing `range`. */
  const scoped = (body: string, range: Range) => {
    const save = ctx.steps.override;
    ctx.steps.override = range;
    const html = blocks(body, ctx, fs);
    ctx.steps.override = save;
    return html;
  };

  while (!r.done) {
    const c = r.peek();

    if (c === '\n' && /^\n[ \t]*\n/.test(src.slice(r.pos, r.pos + 64))) { flushPara(); r.pos++; continue; }
    if (c === '{') {
      const start = r.pos;
      const inner = r.readBalanced('{', '}');
      // A group holding block content ({\centering \includegraphics…}) is rendered as blocks.
      if (BLOCKY.test(inner) && !raw.trim()) { flushPara(); out += `<div class="group">${blocks(inner, ctx, fs)}</div>`; continue; }
      raw += src.slice(start, r.pos);
      continue;
    }
    if (c === '$') {
      if (r.peek(1) === '$') {
        flushPara();
        const end = src.indexOf('$$', r.pos + 2);
        out += mathBlock(src.slice(r.pos + 2, end), ctx);
        r.pos = end + 2;
        continue;
      }
      const start = r.pos++;
      while (!r.done && !(r.peek() === '$' && src[r.pos - 1] !== '\\')) r.pos++;
      r.pos++;
      raw += src.slice(start, r.pos);
      continue;
    }
    if (c !== '\\') { raw += c; r.pos++; continue; }

    if (r.startsWith('\\[')) {
      flushPara();
      const end = src.indexOf('\\]', r.pos);
      out += mathBlock(src.slice(r.pos + 2, end), ctx);
      r.pos = end + 2;
      continue;
    }
    if (r.startsWith('\\(')) { const end = src.indexOf('\\)', r.pos); raw += src.slice(r.pos, end + 2); r.pos = end + 2; continue; }
    if (r.startsWith('\\\\')) { raw += '\\\\'; r.pos += 2; continue; }

    const save = r.pos;
    const name = r.readCommandName();

    if (name === 'pause') { r.readOptional(); flushSeg(); ctx.steps.pause(); continue; }
    if (name === 'par') { flushPara(); continue; }
    if (name === 'frametitle') { r.readStar(); r.readOverlay(); r.readOptional(); fs.title = inline(r.readGroup(), ctx); continue; }
    if (name === 'framesubtitle') { r.readOverlay(); fs.subtitle = inline(r.readGroup(), ctx); continue; }
    if (name === 'titlepage' || name === 'maketitle') { r.readOptional(); fs.titlepage = true; continue; }
    if (name === 'sectionpage' || name === 'subsectionpage' || name === 'partpage') { fs.page = name.replace('page', '') as 'section'; continue; }
    if (/^trans[a-z]+$/.test(name)) { r.readOverlay(); r.readOptional(); fs.transition = name.slice(5); continue; }
    if (name === 'centering' || name === 'raggedleft' || name === 'raggedright') {
      flushPara();
      if (!alignAt) alignAt = { at: out.length, cls: name === 'centering' ? 'centered' : name === 'raggedleft' ? 'flushright' : 'flushleft' };
      continue;
    }
    if (name === 'chemfig' || name === 'schemestart') {
      if (raw.trim()) { r.pos = save; raw += '\\'; r.pos++; continue; }
      flushPara();
      const start = save;
      if (name === 'chemfig') { r.readStar(); r.readOptional(); r.readGroup(); }
      else { const end = src.indexOf('\\schemestop', r.pos); r.pos = end < 0 ? src.length : end + '\\schemestop'.length; }
      out += latexFigure(src.slice(start, r.pos), ctx);
      continue;
    }
    if (name === 'tikz' && !raw.trim() && aloneAfterTikz(src, r.pos)) {
      flushPara();
      const start = save;
      r.readOverlay(); r.readOptional(); r.skipSpace();
      if (r.peek() === '{') r.readBalanced('{', '}'); else { const end = src.indexOf(';', r.pos); r.pos = end < 0 ? src.length : end + 1; }
      out += latexFigure(src.slice(start, r.pos), ctx);
      continue;
    }
    if (name === 'caption' || name === 'subcaption') { flushPara(); r.readStar(); r.readOptional(); out += `<div class="caption"${stepAttrs(ctx.steps.here())}>${inline(r.readGroup(), ctx)}</div>`; continue; }
    if (name === 'note') {
      r.readStar(); r.readOverlay();
      const opt = r.readOptional();
      const body = r.readGroup();
      fs.notes.push(noteHtml(body, opt, ctx));
      continue;
    }
    if (name === 'includegraphics') {
      const ov = r.readOverlay();
      const opts = r.readOptional();
      const path = r.readGroup();
      if (raw.trim() || !aloneInPara(src, r.pos)) { raw += src.slice(save, r.pos); continue; }
      flushPara();
      const range = ov ? ctx.steps.overlay(ov) : ctx.steps.here();
      out += `<div class="figwrap">${imageHtml(opts, path, ctx, stepAttrs(range))}</div>`;
      continue;
    }
    if (name === 'movie' || name === 'includemedia' || name === 'includemovie' || name === 'video' || name === 'sound' || name === 'audio') {
      flushPara();
      const ov = r.readOverlay();
      const opts = r.readOptional();
      const range = ov ? ctx.steps.overlay(ov) : ctx.steps.here();
      let file: string;
      if (name === 'movie' || name === 'includemedia' || name === 'sound') { r.readGroup(); file = r.readGroup(); }
      else if (name === 'includemovie') { r.readGroup(); r.readGroup(); file = r.readGroup(); }
      else file = r.readGroup();
      out += mediaHtml(opts, file, ctx, stepAttrs(range));
      continue;
    }
    if (name === 'animategraphics') {
      flushPara();
      const ov = r.readOverlay();
      const opts = r.readOptional();
      const fps = r.readGroup(), prefix = r.readGroup(), first = r.readGroup(), last = r.readGroup();
      out += animateGraphics(opts, fps, prefix, first, last, ctx, stepAttrs(ov ? ctx.steps.overlay(ov) : ctx.steps.here()));
      continue;
    }
    if (name === 'lstinputlisting' || name === 'inputminted' || name === 'VerbatimInput' || name === 'verbatiminput') {
      flushPara();
      const opts = parseKeyVals(r.readOptional());
      const lang = name === 'inputminted' ? r.readGroup() : null;
      const path = r.readGroup().trim();
      const file = findFile(path, ctx.baseDir, [], ['', '.txt']);
      if (!file) { ctx.warn(`listing ${path}: not found`); out += `<div class="img-missing">${esc(path)}</div>`; continue; }
      const l = lang ?? (typeof opts.language === 'string' ? opts.language : null) ?? EXT_LANG[extname(file)] ?? (typeof ctx.lst?.language === 'string' ? ctx.lst.language : null);
      out += codeHtml(readFileSync(file, 'utf8'), l, { ...ctx.lst, ...opts }, ctx, ctx.steps.here());
      continue;
    }
    if (name === 'tableofcontents') { flushPara(); const opts = r.readOptional(); out += ctx.toc ? `<div class="toc-wrap"${stepAttrs(ctx.steps.here())}>${ctx.toc(opts)}</div>` : ''; continue; }
    if (name === 'printbibliography' || name === 'bibliography') {
      flushPara();
      const opts = r.readOptional();
      if (name === 'bibliography') r.readGroup();
      if (ctx.bibliography) out += `<div class="bib-wrap"${stepAttrs(ctx.steps.here())}>${ctx.bibliography(opts)}</div>`;
      continue;
    }
    if (name === 'resizebox' || name === 'scalebox' || name === 'adjustbox') {
      // Block form when it wraps a table or figure.
      r.readStar();
      let scale = 1, fitWidth = false, rw = '!', rh = '!';
      if (name === 'resizebox') { rw = r.readGroup().trim(); rh = r.readGroup().trim(); fitWidth = /width/.test(rw); }
      else if (name === 'scalebox') { scale = parseFloat(r.readGroup()) || 1; r.readOptional(); }
      else { r.readGroup(); fitWidth = true; }
      r.skipSpace();
      const body = r.peek() === '{' ? r.readBalanced('{', '}') : '';
      // Around a single image, the box just sets the image's size.
      const one = name !== 'adjustbox' && /^\s*\\includegraphics(<[^>]*>)?(?:\[([^\]]*)\])?\{([^}]*)\}\s*$/.exec(body);
      if (one) {
        const o = one[2] ? [one[2]] : [];
        if (name === 'resizebox') { if (rw !== '!') o.push(`width=${rw}`); if (rh !== '!') o.push(`height=${rh}`); }
        else o.push(`scale=${scale}`);
        const img = `\\includegraphics${one[1] ?? ''}[${o.join(',')}]{${one[3]}}`;
        if (!raw.trim() && aloneInPara(src, r.pos)) {
          flushPara();
          const range = one[1] ? ctx.steps.overlay(one[1].slice(1, -1)) : ctx.steps.here();
          out += `<div class="figwrap">${imageHtml(o.join(','), one[3], ctx, stepAttrs(range))}</div>`;
        } else raw += img;
        continue;
      }
      if (BLOCKY.test(body) && !raw.trim()) {
        flushPara();
        out += `<div class="${fitWidth ? 'fitwidth' : 'scalebox'}"${scale !== 1 ? ` style="zoom:${scale}"` : ''}>${blocks(body, ctx, fs)}</div>`;
        continue;
      }
      raw += src.slice(save, r.pos);
      continue;
    }
    if (name === 'subfloat' || name === 'subcaptionbox') {
      flushPara();
      r.readStar();
      const cap = name === 'subfloat' ? r.readOptional() : r.readGroup();
      r.readOptional();
      const body = r.readGroup();
      out += `<div class="subfig">${blocks(body, ctx, fs)}${cap ? `<div class="caption">${inline(cap, ctx)}</div>` : ''}</div>`;
      continue;
    }
    if (SPACERS.has(name)) {
      flushPara();
      if (name === 'vspace' || name === 'vskip') {
        r.readStar();
        const len = name === 'vskip' ? /^\s*(-?[\d.]+\s*[a-z]+|\\[a-z]+)/i.exec(src.slice(r.pos))?.[0] ?? '' : r.readGroup();
        if (name === 'vskip') r.pos += len.length;
        if (/\\fill|\\stretch/.test(len)) { out += '<div class="vfill"></div>'; continue; }
        const css = cssLength(len, 'y');
        out += css === 'auto' ? '' : css.startsWith('-') ? `<div style="margin-top:${css}"></div>` : `<div style="height:${css};flex:none"></div>`;
      }
      else out += name === 'vfill' || name === 'vfil' ? '<div class="vfill"></div>' : `<div class="${name}"></div>`;
      continue;
    }
    if (name === 'column') { r.readOptional(); r.readGroup(); continue; } // stray, outside columns
    if (ctx.macros[name]) {
      // Expand user macros here so block content inside them is seen.
      const expanded = expandMacro(r, ctx.macros[name]);
      src = src.slice(0, save) + expanded + src.slice(r.pos);
      r.src = src;
      r.pos = save;
      continue;
    }
    if (OVERLAY_CMDS.has(name)) {
      r.readStar(); r.readStar();
      const ovPos = r.pos;
      const ov = r.readOverlay();
      const afterOv = r.pos;
      r.skipSpace(false);
      if (r.peek() !== '{') {
        // Bare switch: \onslide<2-> (or \onslide alone to reset).
        if (name === 'onslide') { flushSeg(); ctx.steps.override = ov ? ctx.steps.overlay(ov) : null; r.pos = afterOv; continue; }
        r.pos = ovPos; raw += src.slice(save, r.pos); continue;
      }
      const args = [r.readGroup()];
      const nArgs = name === 'alt' ? 2 : name === 'temporal' ? 3 : 1;
      for (let i = 1; i < nArgs; i++) args.push(r.readGroup());
      if (!args.some((a) => BLOCKY.test(a)) || raw.trim()) { raw += src.slice(save, r.pos); continue; }
      flushPara();
      out += overlayBlock(name, ov, args, ctx, scoped);
      continue;
    }
    if (name === 'begin') {
      const env = r.readGroup().trim();
      const html = environment(env, r, ctx, fs, flushPara, scoped);
      if (html !== null) { out += html; continue; }
      // Unknown environment: render its body as blocks.
      flushPara();
      ctx.warn(`unsupported environment {${env}}; rendering its contents`);
      r.readOverlay(); r.readOptional();
      out += `<div class="env-${esc(env)}">${blocks(r.readEnvBody(env), ctx, fs)}</div>`;
      continue;
    }
    // Inline command: keep raw for inline() — copy the name and let `{` groups follow.
    raw += src.slice(save, r.pos);
  }
  flushPara();
  if (alignAt) out = out.slice(0, alignAt.at) + `<div class="${alignAt.cls}">${out.slice(alignAt.at)}</div>`;
  return out;
}

function aloneAfterTikz(src: string, pos: number): boolean {
  const r = new Reader(src);
  r.pos = pos;
  r.readOverlay(); r.readOptional(); r.skipSpace();
  if (r.peek() === '{') r.readBalanced('{', '}'); else { const end = src.indexOf(';', r.pos); r.pos = end < 0 ? src.length : end + 1; }
  return aloneInPara(src, r.pos);
}

function noteHtml(body: string, opt: string | null, ctx: Ctx): string {
  // Notes never add steps: render them with a throwaway step counter.
  const saved = ctx.steps;
  ctx.steps = new (saved.constructor as new () => typeof saved)();
  const fs: FrameState = { notes: [], scenes: [], titlepage: false };
  let html = blocks(body, ctx, fs);
  ctx.steps = saved;
  html = html.replace(/ data-(from|until|on)="[^"]*"/g, '');
  return opt && /item/.test(opt) ? `<ul class="note-items"><li>${html}</li></ul>` : html;
}

function overlayBlock(name: string, ov: string | null, args: string[], ctx: Ctx, scoped: (b: string, r: Range) => string): string {
  const div = (cls: string, range: Range, body: string) => `<div class="ovb${cls ? ' ' + cls : ''}"${stepAttrs(range)}>${scoped(body, range)}</div>`;
  if (!ov) return name === 'invisible' ? `<div class="invisible">${scoped(args[0], ctx.steps.here())}</div>` : scoped(args[0], ctx.steps.here());
  if (name === 'alt') {
    const range = ctx.steps.overlay(ov);
    const not = ctx.steps.overlay(`invisible@${specOf(range)}`);
    return `<div class="altstack">${div('only', range, args[0])}${div('only', not, args[1])}</div>`;
  }
  if (name === 'temporal') {
    const range = ctx.steps.overlay(ov);
    const end = range.on ? range.on[range.on.length - 1][1] : range.until;
    return (range.from > 1 ? div('only', { from: 1, until: range.from }, args[0]) : '') + div('only', range, args[1]) + (end !== undefined ? div('only', { from: end }, args[2]) : '');
  }
  const range = name === 'invisible' ? ctx.steps.overlay(`invisible@${ov}`) : ctx.steps.overlay(ov);
  return div(name === 'only' ? 'only' : '', range, args[0]);
}

function specOf(r: Range): string {
  const ivs = r.on ?? [[r.from, r.until]];
  return ivs.map(([a, b]) => (b === undefined ? `${a}-` : `${a}-${b - 1}`)).join(',');
}

function environment(env: string, r: Reader, ctx: Ctx, fs: FrameState, flushPara: () => void, scoped: (b: string, r: Range) => string): string | null {
  const here = () => ctx.steps.here();
  if (MATH_ENVS.has(env)) {
    flushPara();
    const body = r.readEnvBody(env);
    return mathBlock(body, ctx, env === 'dmath' ? 'equation' : env === 'dmath*' ? 'equation*' : env);
  }
  if (env in LISTS) {
    flushPara();
    const ov = r.readOverlay();
    const opt = r.readOptional();
    const dflt = /^<(.*)>$/.exec(opt?.trim() ?? '')?.[1] ?? ov ?? null;
    const listOpt = opt && !/^<.*>$/.test(opt.trim()) ? opt : null;
    const body = r.readEnvBody(env);
    const tag = LISTS[env];
    const listRange = here();
    const fmt = tag === 'ol' ? enumFormat(listOpt) : null;
    const kv = parseKeyVals(listOpt);
    const startN = typeof kv.start === 'string' ? parseInt(kv.start, 10) || 1 : 1;
    const bullet = tag === 'ul' && typeof kv.label === 'string' ? inline(kv.label, ctx) : null;
    let html = '';
    let n = startN - 1;
    for (const item of splitItems(body)) {
      const ir = new Reader(item);
      const iov = ir.readOverlay() ?? dflt;
      const label = ir.readOptional();
      n++;
      const spec = iov ? ctx.steps.spec(iov) : null;
      const range = spec?.vis ?? here();
      const fx = spec?.alert ? ` data-fxclass="fx-alert"${stepAttrs(spec.alert, 'fx-')}` : '';
      const fxCls = spec?.alert ? ' fx fx-alert' : '';
      const content = scoped(item.slice(ir.pos), range);
      if (tag === 'dl') {
        html += `<dt class="${fxCls.trim()}"${stepAttrs(range)}${fx}>${label ? inline(label, ctx) : ''}</dt><dd${stepAttrs(range)}>${content}</dd>`;
      } else {
        const lab = label !== null ? inline(label, ctx) : fmt ? esc(fmt(n)) : bullet;
        const labAttr = lab !== null ? ` data-label="${esc(lab.replace(/<[^>]+>/g, ''))}"` : '';
        const labSpan = lab !== null ? `<span class="lab">${lab}</span>` : '';
        html += `<li class="${[lab !== null ? 'custom' : '', fxCls.trim()].filter(Boolean).join(' ')}"${labAttr}${stepAttrs(range)}${fx}>${labSpan}${content}</li>`;
      }
    }
    const startAttr = tag === 'ol' && startN !== 1 ? ` start="${startN}"` : '';
    const inl = env.startsWith('inpara') ? ' class="inpara"' : '';
    return `<${tag}${inl}${startAttr}${stepAttrs(listRange)}>${html.replace(/ class=""/g, '')}</${tag}>`;
  }
  if (env in BOXES || ctx.theorems?.[env] || env === 'tcolorbox' || env === 'beamercolorbox' || env === 'mdframed' || env === 'framed' || env === 'shaded' || env === 'tcbraster') {
    flushPara();
    const ov = r.readOverlay();
    let title = '';
    let cls = BOXES[env] ?? 'box';
    let style = '';
    let qed = false;
    if (env.endsWith('block')) { title = r.readGroup(); }
    else if (env === 'tcolorbox' || env === 'mdframed') {
      const kv = parseKeyVals(r.readOptional());
      title = typeof kv.title === 'string' ? kv.title : typeof kv.frametitle === 'string' ? kv.frametitle : '';
      const back = kv.colback ?? kv.backgroundcolor;
      const frame = kv.colframe ?? kv.linecolor;
      if (typeof back === 'string') style += `background:${resolveColor(back, ctx)};`;
      if (typeof frame === 'string') style += `border-color:${resolveColor(frame, ctx)};`;
      cls = 'box box-tcb';
    }
    else if (env === 'beamercolorbox') { r.readOptional(); r.readGroup(); cls = 'box box-plain'; }
    else if (env === 'framed' || env === 'shaded' || env === 'tcbraster') { cls = 'box box-plain'; r.readOptional(); }
    else {
      const thm = ctx.theorems![env];
      const opt = r.readOptional();
      let t = thm.title;
      if (thm.counter) {
        const m = ctx.thmCounters ?? new Map<string, number>();
        const n = (m.get(thm.counter) ?? 0) + 1;
        m.set(thm.counter, n);
        ctx.thmCounters = m;
        t += ` ${n}`;
      }
      title = opt ? `${t} (${opt})` : t;
      if (thm.kind === 'proof') { title = opt ?? thm.title; qed = true; cls = 'box box-proof'; }
      if (thm.kind === 'example') cls = 'box box-example';
      if (thm.kind === 'definition') cls = 'box box-def';
    }
    const range = ov ? ctx.steps.overlay(ov) : here();
    const body = scoped(r.readEnvBody(env), range);
    return `<div class="${cls}"${style ? ` style="${style}"` : ''}${stepAttrs(range)}>${title ? `<div class="box-title">${inline(title, ctx)}</div>` : ''}<div class="box-body${qed ? ' qed' : ''}">${body}</div></div>`;
  }
  if (env === 'columns') {
    flushPara();
    const opt = r.readOptional();
    const body = r.readEnvBody(env);
    let cols = '';
    for (const col of splitColumns(body)) {
      const range = col.ov ? ctx.steps.overlay(col.ov) : here();
      const width = cssLength(col.width);
      const al = col.opt?.match(/[tTcb]/)?.[0];
      const self = al === 't' || al === 'T' ? 'flex-start' : al === 'b' ? 'flex-end' : al === 'c' ? 'center' : '';
      cols += `<div class="col" style="flex:0 1 ${width === 'auto' ? '48%' : width}${self ? `;align-self:${self}` : ''}"${stepAttrs(range)}>${scoped(col.body, range)}</div>`;
    }
    const align = opt?.includes('T') || opt?.includes('t') ? ' top' : opt?.includes('b') ? ' bottom' : '';
    return `<div class="cols${align}">${cols}</div>`;
  }
  if (env === 'center' || env === 'flushleft' || env === 'flushright' || env === 'figure' || env === 'figure*' || env === 'minipage' || env === 'table' || env === 'table*' || env === 'subfigure' || env === 'subtable' || env === 'wrapfigure' || env === 'adjustbox' || env === 'landscape' || env === 'raggedright' || env === 'Center' || env === 'FlushRight') {
    flushPara();
    let style = '';
    let cls = { figure: 'figure', 'figure*': 'figure', table: 'figure', 'table*': 'figure', subfigure: 'subfig', subtable: 'subfig', wrapfigure: 'figure', adjustbox: 'fitwidth', landscape: '', raggedright: 'flushleft', Center: 'center', FlushRight: 'flushright' }[env as 'figure'] ?? env;
    if (env === 'figure' || env === 'figure*' || env === 'table' || env === 'table*') r.readOptional();
    if (env === 'adjustbox') r.readGroup();
    if (env === 'wrapfigure') { r.readOptional(); r.readGroup(); r.readOptional(); r.readGroup(); }
    if (env === 'minipage' || env === 'subfigure' || env === 'subtable') {
      const pos = r.readOptional(); r.readOptional(); r.readOptional();
      const w = cssLength(r.readGroup());
      style = ` style="width:${w}${pos === 't' ? ';align-self:flex-start' : pos === 'b' ? ';align-self:flex-end' : ''}"`;
      if (env === 'minipage') cls = 'minipage';
    }
    const envBody = r.readEnvBody(env);
    if (/^(figure|table)\*?$/.test(env) && /\\caption(?![A-Za-z])/.test(envBody) && ctx.eq) {
      // Number captioned figures/tables so \ref works (subfigures get 1a, 1b, …).
      const kind = env.startsWith('table') ? 'tab' : 'fig';
      const n = (ctx.eq[kind] = (ctx.eq[kind] ?? 0) + 1);
      let k = 0;
      const rest = envBody.replace(/\\begin\{sub(figure|table)\}[\s\S]*?\\end\{sub\1\}/g, (m) => {
        const letter = 'abcdefghijklmnop'[k++] ?? '';
        for (const l of m.matchAll(/\\label\{([^}]*)\}/g)) ctx.eq!.labels.set(l[1].trim(), `${n}${letter}`);
        return '';
      });
      for (const l of rest.matchAll(/\\label\{([^}]*)\}/g)) ctx.eq.labels.set(l[1].trim(), String(n));
    }
    return `<div class="${cls}"${style}>${blocks(envBody, ctx, fs)}</div>`;
  }
  if (env === 'multicols' || env === 'multicols*') {
    flushPara();
    const n = parseInt(r.readGroup(), 10) || 2;
    r.readOptional();
    return `<div class="multicols" style="column-count:${n}"${stepAttrs(here())}>${blocks(r.readEnvBody(env), ctx, fs)}</div>`;
  }
  if (QUOTES.has(env) || env === 'abstract' || env === 'displayquote') {
    flushPara();
    const body = blocks(r.readEnvBody(env), ctx, fs);
    if (env === 'abstract') return `<div class="abstract"${stepAttrs(here())}><div class="box-title">Abstract</div>${body}</div>`;
    return `<blockquote class="${env}"${stepAttrs(here())}>${body}</blockquote>`;
  }
  if (env === 'overprint') {
    flushPara();
    r.readOptional();
    const body = r.readEnvBody(env);
    const parts = body.split(/\\onslide\s*[+*]?\s*(?=<)/).slice(1);
    let html = '';
    for (const p of parts) {
      const pr = new Reader(p);
      const ov = pr.readOverlay() ?? '1-';
      const range = ctx.steps.overlay(ov);
      html += `<div class="layer"${stepAttrs(range)} data-anim="swap">${scoped(p.slice(pr.pos), range)}</div>`;
    }
    return `<div class="overprint">${html}</div>`;
  }
  if (env in OVERLAY_ENVS) {
    flushPara();
    const ov = r.readOverlay();
    return overlayBlock(OVERLAY_ENVS[env], ov, [r.readEnvBody(env)], ctx, scoped);
  }
  if (env === 'altenv') {
    flushPara();
    const ov = r.readOverlay() ?? '1-';
    const b1 = r.readGroup(), e1 = r.readGroup(), b2 = r.readGroup(), e2 = r.readGroup();
    const body = r.readEnvBody(env);
    return overlayBlock('alt', ov, [b1 + body + e1, b2 + body + e2], ctx, scoped);
  }
  if (env === 'scene') {
    flushPara();
    const opts = r.readOptional();
    const from = ctx.steps.cur;
    const spec = parseScene(opts, r.readEnvBody(env), ctx);
    fs.scenes.push(spec);
    return `<div class="scene"${stepAttrs({ from })} data-scene="${fs.scenes.length - 1}"></div>`;
  }
  if (LATEX_ENVS.has(env)) {
    flushPara();
    const body = r.readEnvBody(env);
    return latexFigure(`\\begin{${env}}${body}\\end{${env}}`, ctx);
  }
  if (env === 'latex') {
    // Escape hatch: anything inside is compiled with real LaTeX.
    flushPara();
    return latexFigure(r.readEnvBody(env), ctx);
  }
  if (env === 'tabular' || env === 'tabularx' || env === 'tabular*' || env === 'longtable' || env === 'tabulary' || env === 'array' || env === 'tblr' || env === 'longtblr' || env === 'NiceTabular') {
    flushPara();
    if (env === 'tabularx' || env === 'tabular*' || env === 'tabulary') r.readGroup();
    r.readOptional();
    const spec = r.readGroup();
    const range = here();
    const body = r.readEnvBody(env).replace(/\\(endhead|endfirsthead|endfoot|endlastfoot)\b/g, '');
    const full = env === 'tabularx' || env === 'tabular*' ? ' full' : '';
    return `<div class="tblwrap${full}"${stepAttrs(range)}>${tableHtml(env === 'tblr' ? tblrSpec(spec) : spec, body, ctx)}</div>`;
  }
  if (env === 'semiverbatim') { flushPara(); return semiverbatim(r.readEnvBody(env), ctx); }
  if (VERBATIM.has(env)) {
    flushPara();
    let opts: Record<string, string | true> = {};
    let lang: string | null = null;
    if (env === 'lstlisting') { opts = { ...ctx.lst, ...parseKeyVals(r.readOptional()) }; lang = typeof opts.language === 'string' ? opts.language : null; }
    else if (env === 'minted') { opts = { ...ctx.lst, ...parseKeyVals(r.readOptional()) }; lang = r.readGroup(); }
    else if (env === 'Verbatim' || env === 'BVerbatim' || env === 'LVerbatim') opts = parseKeyVals(r.readOptional());
    const code = r.readEnvBody(env);
    return codeHtml(code, lang, opts, ctx, here());
  }
  if (env === 'thebibliography') {
    flushPara();
    r.readGroup();
    const body = r.readEnvBody(env);
    const items = body.split(/\\bibitem/).slice(1).map((it) => {
      const ir = new Reader(it);
      ir.readOptional();
      const key = ir.readGroup().trim();
      const label = ctx.cite ? ctx.cite('cite', [key], null, null) : `<span class="cite">[${esc(key)}]</span>`;
      return `<li><span class="bib-label">${label}</span><span class="bib-text">${inline(it.slice(ir.pos).replace(/\\newblock/g, ' ').trim(), ctx)}</span></li>`;
    });
    return `<ol class="bib"${stepAttrs(here())}>${items.join('')}</ol>`;
  }
  if (env === 'frame') { ctx.warn('nested frame ignored'); r.readEnvBody(env); return ''; }
  if (ctx.envs?.[env]) {
    const def = ctx.envs[env];
    const er = new Reader(r.src);
    er.pos = r.pos;
    const args: string[] = [];
    if (def.dflt !== undefined) args.push(er.readOptional() ?? def.dflt);
    while (args.length < def.nargs) args.push(er.readGroup());
    r.pos = er.pos;
    const body = r.readEnvBody(env);
    let begin = def.begin, end = def.end;
    args.forEach((a, i) => { begin = begin.split(`#${i + 1}`).join(a); end = end.split(`#${i + 1}`).join(a); });
    flushPara();
    return blocks(`${begin}\n${body}\n${end}`, ctx, fs);
  }
  return null;
}

/** tabularray `colspec={Q[l]X[c]}` or plain `{lcr}`. */
function tblrSpec(spec: string): string {
  const kv = parseKeyVals(spec);
  const cs = typeof kv.colspec === 'string' ? kv.colspec : spec;
  return cs.replace(/Q\[([^\]]*)\]/g, (_, o) => (/c/.test(o) ? 'c' : /r/.test(o) ? 'r' : 'l')).replace(/X\[[^\]]*\]/g, 'X');
}

/** `\begin{column}{w}…\end{column}` or `\column{w}…` parts of a columns body. */
function splitColumns(body: string): { width: string; ov: string | null; opt: string | null; body: string }[] {
  const out: { width: string; ov: string | null; opt: string | null; body: string }[] = [];
  const r = new Reader(body);
  let cur: { width: string; ov: string | null; opt: string | null; start: number } | null = null;
  let depth = 0;
  const close = (end: number) => { if (cur) out.push({ width: cur.width, ov: cur.ov, opt: cur.opt, body: body.slice(cur.start, end) }); cur = null; };
  while (!r.done) {
    if (r.startsWith('\\begin{column}')) {
      close(r.pos);
      r.pos += '\\begin{column}'.length;
      const ov = r.readOverlay();
      const opt = r.readOptional();
      const width = r.readGroup();
      const inner = r.readEnvBody('column');
      out.push({ width, ov, opt, body: inner });
      continue;
    }
    if (r.startsWith('\\begin{')) { depth++; r.pos += 7; continue; }
    if (r.startsWith('\\end{')) { depth--; r.pos += 5; continue; }
    if (depth === 0 && r.startsWith('\\column') && !/[A-Za-z]/.test(r.peek(7) ?? '')) {
      close(r.pos);
      r.pos += 7;
      const ov = r.readOverlay();
      const opt = r.readOptional();
      const width = r.readGroup();
      cur = { width, ov, opt, start: r.pos };
      continue;
    }
    if (r.peek() === '\\') r.pos++;
    r.pos++;
  }
  close(body.length);
  return out;
}

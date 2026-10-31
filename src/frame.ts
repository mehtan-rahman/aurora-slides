// Block-level structure of a frame body → HTML with step attributes.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { Reader, parseKeyVals } from './reader.ts';
import { inline, mathHtml, stepAttrs, esc, expandMacro, type Ctx } from './inline.ts';
import { parseScene, type SceneSpec } from './scene.ts';
import { latexAvailable, renderLatex, overlaySpecs, atSlide } from './latexsvg.ts';

export interface FrameState {
  title?: string;
  subtitle?: string;
  notes: string[];
  scenes: SceneSpec[];
  titlepage: boolean;
}

const MATH_ENVS = new Set(['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'eqnarray', 'eqnarray*', 'displaymath', 'math']);
const LISTS: Record<string, string> = { itemize: 'ul', enumerate: 'ol', description: 'dl' };
const BOXES: Record<string, string> = { block: 'box', alertblock: 'box box-alert', exampleblock: 'box box-example', theorem: 'box', definition: 'box', lemma: 'box', proof: 'box', corollary: 'box', example: 'box box-example' };
const BOX_TITLES: Record<string, string> = { theorem: 'Theorem', definition: 'Definition', lemma: 'Lemma', proof: 'Proof', corollary: 'Corollary', example: 'Example' };
const LATEX_ENVS = new Set(['tikzpicture', 'circuitikz', 'tikzcd', 'forest', 'chemfig', 'schemestart', 'algorithmic', 'algorithm', 'pgfpicture', 'picture', 'feynman', 'feynmandiagram', 'quantikz', 'dynkinDiagram']);
const SPACERS = new Set(['vfill', 'vspace', 'medskip', 'bigskip', 'smallskip']);

/** Converts a length like `0.5\textwidth` or `6cm` to a CSS width. */
function cssWidth(len: string): string {
  const rel = /^([\d.]*)\s*\\(text|line|column)width/.exec(len.trim());
  if (rel) return `${(parseFloat(rel[1] || '1') * 100).toFixed(1)}%`;
  const abs = /^([\d.]+)\s*(cm|mm|in|pt|em)$/.exec(len.trim());
  if (abs) {
    // Beamer's page is 128mm wide; our stage is 1920px.
    const mm = { cm: 10, mm: 1, in: 25.4, pt: 0.3515, em: 3.9 }[abs[2]]!;
    return `${Math.round(parseFloat(abs[1]) * mm * 15)}px`;
  }
  return 'auto';
}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

function imageHtml(opts: string | null, path: string, ctx: Ctx, attrs: string): string {
  const kv = parseKeyVals(opts);
  let file = resolve(ctx.baseDir, path.trim());
  if (!extname(file)) file = ['.png', '.jpg', '.jpeg', '.svg', '.pdf'].map((e) => file + e).find(existsSync) ?? file;
  const mime = MIME[extname(file).toLowerCase()];
  if (!existsSync(file) || !mime) {
    ctx.warn(`image ${path}: ${existsSync(file) ? 'unsupported format (PDF images are planned for M1)' : 'not found'}`);
    return `<div class="img-missing"${attrs}>${esc(path)}</div>`;
  }
  const style: string[] = [];
  if (typeof kv.width === 'string') style.push(`width:${cssWidth(kv.width)}`);
  if (typeof kv.height === 'string') style.push(`height:${cssWidth(kv.height).replace('%', 'vh')}`);
  if (typeof kv.scale === 'string') style.push(`zoom:${kv.scale}`);
  const data = readFileSync(file).toString('base64');
  return `<img class="fig"${attrs} style="${style.join(';')}" src="data:${mime};base64,${data}">`;
}

/** Splits a list body on top-level `\item`s. */
function splitItems(body: string): string[] {
  const items: string[] = [];
  const r = new Reader(body);
  let depth = 0, start = -1;
  while (!r.done) {
    if (r.startsWith('\\begin{')) { depth++; r.pos += 7; continue; }
    if (r.startsWith('\\end{')) { depth--; r.pos += 5; continue; }
    if (r.peek() === '{') { r.readBalanced('{', '}'); continue; }
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

/** Compiles a fragment with LaTeX; overlays inside it become stacked, step-timed variants. */
export function latexFigure(src: string, ctx: Ctx, display = true): string {
  const cls = display ? 'latex-fig' : 'latex-inline';
  if (!latexAvailable()) {
    ctx.warn('a LaTeX fragment (TikZ/chemfig/…) needs `latex` and `dvisvgm` on PATH; showing a placeholder');
    return `<div class="img-missing"${stepAttrs({ from: ctx.steps.cur })}>LaTeX figure</div>`;
  }
  const specs = [...overlaySpecs(src)].filter((n) => n > 1).sort((a, b) => a - b);
  const render = (body: string) => {
    try { return renderLatex(body, ctx.latexPreamble ?? '', 3, ctx.latexTheme); }
    catch (e) { ctx.warn(`LaTeX fragment failed: ${(e as Error).message}`); return `<span class="err">LaTeX error: ${esc((e as Error).message)}</span>`; }
  };
  if (!specs.length || !display) return `<div class="${cls}"${display ? stepAttrs({ from: ctx.steps.cur }) : ''}>${render(src)}</div>`;
  const starts = [ctx.steps.cur, ...specs.filter((n) => n > ctx.steps.cur)];
  const layers = starts.map((k, i) => {
    ctx.steps.mark(k);
    const until = starts[i + 1];
    const range = until === undefined ? { from: k } : { from: k, until };
    return `<div class="${cls} layer"${stepAttrs(range)} data-swap>${render(atSlide(src, k))}</div>`;
  });
  return `<div class="latex-stack">${layers.join('')}</div>`;
}

/** Splits on a separator at brace depth 0, outside $…$. */
function splitCells(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, math = false, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s.startsWith(sep, i) && sep.startsWith('\\')) { if (depth === 0 && !math) { out.push(cur); cur = ''; i += sep.length - 1; continue; } }
    if (c === '\\') { cur += c + (s[i + 1] ?? ''); i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '$') math = !math;
    if (c === sep && depth === 0 && !math) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function tableHtml(spec: string, body: string, ctx: Ctx): string {
  const aligns: string[] = [];
  const sr = new Reader(spec.replace(/\s/g, ''));
  while (!sr.done) {
    const c = sr.peek();
    if ('lcr'.includes(c)) { aligns.push({ l: 'left', c: 'center', r: 'right' }[c]!); sr.pos++; }
    else if ('pmbX'.includes(c)) { sr.pos++; if (c !== 'X') sr.readGroup(); aligns.push('left'); }
    else if (c === '@' || c === '>' || c === '<' || c === '!') { sr.pos++; sr.readGroup(); }
    else if (c === '*') { sr.pos++; const n = parseInt(sr.readGroup(), 10); const inner = sr.readGroup(); for (let i = 0; i < n; i++) for (const ch of inner) if ('lcr'.includes(ch)) aligns.push({ l: 'left', c: 'center', r: 'right' }[ch]!); }
    else sr.pos++;
  }
  let rows = '';
  let ruleNext = false;
  for (let raw of splitCells(body, '\\\\')) {
    raw = raw.replace(/^\s*\[[^\]]*\]/, '');
    if (/\\pause/.test(raw)) { raw = raw.replace(/\\pause/g, ''); ctx.steps.pause(); }
    const rules = /\\(hline|toprule|midrule|bottomrule|cline\{[^}]*\})/.test(raw);
    const text = raw.replace(/\\(hline|toprule|midrule|bottomrule)|\\cline\{[^}]*\}/g, '').trim();
    if (!text) { if (rules) ruleNext = true; continue; }
    const cells = splitCells(text, '&');
    let col = 0;
    const tds = cells.map((cell) => {
      let span = 1, align = aligns[col] ?? 'left';
      let content = cell.trim();
      const mc = /^\\multicolumn\{(\d+)\}\{([^}]*)\}\{([\s\S]*)\}$/.exec(content);
      if (mc) { span = +mc[1]; align = mc[2].includes('c') ? 'center' : mc[2].includes('r') ? 'right' : 'left'; content = mc[3]; }
      col += span;
      return `<td${span > 1 ? ` colspan="${span}"` : ''} style="text-align:${align}">${inline(content, ctx)}</td>`;
    }).join('');
    rows += `<tr${ruleNext || rules ? ' class="rule"' : ''}${stepAttrs({ from: ctx.steps.cur })}>${tds}</tr>`;
    ruleNext = false;
  }
  return `<table class="tbl">${rows}</table>`;
}

export function blocks(src: string, ctx: Ctx, fs: FrameState): string {
  const r = new Reader(src);
  let out = '';
  // A paragraph is a run of inline segments; `\pause` mid-paragraph splits it.
  let segs: { raw: string; from: number }[] = [];
  let raw = '';

  const flushSeg = () => {
    if (raw.trim()) segs.push({ raw, from: ctx.steps.cur });
    raw = '';
  };
  const flushPara = () => {
    flushSeg();
    if (!segs.length) return;
    const first = segs[0].from;
    const inner = segs.map((s, i) => {
      const html = inline(s.raw.trim(), ctx);
      return i === 0 || s.from === first ? html : `<span${stepAttrs({ from: s.from })}> ${html}</span>`;
    }).join(' ');
    out += `<p${stepAttrs({ from: first })}>${inner}</p>`;
    segs = [];
  };

  while (!r.done) {
    const c = r.peek();

    if (c === '\n' && /^\n[ \t]*\n/.test(src.slice(r.pos, r.pos + 64))) { flushPara(); r.pos++; continue; }
    if (c === '{') { raw += '{' + r.readBalanced('{', '}') + '}'; continue; }
    if (c === '$') {
      if (r.peek(1) === '$') {
        flushPara();
        const end = src.indexOf('$$', r.pos + 2);
        out += `<div class="dmath" data-anim="write"${stepAttrs({ from: ctx.steps.cur })}>${mathHtml(src.slice(r.pos + 2, end), true)}</div>`;
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
      out += `<div class="dmath" data-anim="write"${stepAttrs({ from: ctx.steps.cur })}>${mathHtml(src.slice(r.pos + 2, end), true)}</div>`;
      r.pos = end + 2;
      continue;
    }
    if (r.startsWith('\\(')) { const end = src.indexOf('\\)', r.pos); raw += src.slice(r.pos, end + 2); r.pos = end + 2; continue; }
    if (r.startsWith('\\\\')) { raw += '\\\\'; r.pos += 2; continue; }

    const save = r.pos;
    const name = r.readCommandName();

    if (name === 'pause') { r.readOptional(); flushSeg(); ctx.steps.pause(); continue; }
    if (name === 'frametitle') { r.readOverlay(); r.readOptional(); fs.title = inline(r.readGroup(), ctx); continue; }
    if (name === 'framesubtitle') { r.readOverlay(); fs.subtitle = inline(r.readGroup(), ctx); continue; }
    if (name === 'titlepage' || name === 'maketitle') { fs.titlepage = true; continue; }
    if (name === 'chemfig' || name === 'schemestart') {
      flushPara();
      const start = save;
      if (name === 'chemfig') { r.readStar(); r.readOptional(); r.readGroup(); }
      else { const end = src.indexOf('\\schemestop', r.pos); r.pos = end < 0 ? src.length : end + '\\schemestop'.length; }
      out += latexFigure(src.slice(start, r.pos), ctx);
      continue;
    }
    if (name === 'caption') { flushPara(); r.readOptional(); out += `<div class="caption"${stepAttrs({ from: ctx.steps.cur })}>${inline(r.readGroup(), ctx)}</div>`; continue; }
    if (name === 'note') { r.readOverlay(); r.readOptional(); fs.notes.push(inline(r.readGroup(), ctx)); continue; }
    if (name === 'includegraphics') {
      flushPara();
      const ov = r.readOverlay();
      const opts = r.readOptional();
      const range = ov ? ctx.steps.overlay(ov) : { from: ctx.steps.cur };
      out += `<div class="figwrap">${imageHtml(opts, r.readGroup(), ctx, stepAttrs(range))}</div>`;
      continue;
    }
    if (SPACERS.has(name)) {
      flushPara();
      if (name === 'vspace') { r.readStar(); const len = r.readGroup(); out += `<div style="height:${cssWidth(len).replace('auto', '0')}"></div>`; }
      else out += name === 'vfill' ? '<div class="vfill"></div>' : `<div class="${name}"></div>`;
      continue;
    }
    if (ctx.macros[name]) {
      // Expand user macros here so block content inside them is seen.
      const expanded = expandMacro(r, ctx.macros[name]);
      src = src.slice(0, save) + expanded + src.slice(r.pos);
      r.src = src;
      r.pos = save;
      continue;
    }
    if (name === 'begin') {
      const env = r.readGroup();
      const html = environment(env, r, ctx, fs, flushPara);
      if (html !== null) { out += html; continue; }
      // Unknown environment: render its body as blocks.
      flushPara();
      ctx.warn(`unsupported environment {${env}}; rendering its contents`);
      out += `<div class="env-${esc(env)}">${blocks(r.readEnvBody(env), ctx, fs)}</div>`;
      continue;
    }
    // Inline command: keep raw for inline() — copy the name and let `{` groups follow.
    raw += src.slice(save, r.pos);
  }
  flushPara();
  return out;
}

function environment(env: string, r: Reader, ctx: Ctx, fs: FrameState, flushPara: () => void): string | null {
  if (MATH_ENVS.has(env)) {
    flushPara();
    const body = r.readEnvBody(env);
    const bare = env.replace('*', '');
    const tex = bare === 'equation' || bare === 'displaymath' || bare === 'math' ? body : `\\begin{${bare}*}${body}\\end{${bare}*}`;
    return `<div class="dmath" data-anim="write"${stepAttrs({ from: ctx.steps.cur })}>${mathHtml(tex, true)}</div>`;
  }
  if (env in LISTS) {
    flushPara();
    const ov = r.readOverlay();
    const opt = r.readOptional();
    const dflt = /^<(.*)>$/.exec(opt?.trim() ?? '')?.[1] ?? ov ?? null;
    const body = r.readEnvBody(env);
    const tag = LISTS[env];
    const listFrom = ctx.steps.cur;
    let html = '';
    for (const item of splitItems(body)) {
      const ir = new Reader(item);
      const iov = ir.readOverlay() ?? dflt;
      const label = ir.readOptional();
      const range = iov ? ctx.steps.overlay(iov) : { from: ctx.steps.cur };
      const content = item.slice(ir.pos);
      if (tag === 'dl') {
        html += `<dt${stepAttrs(range)}>${label ? inline(label, ctx) : ''}</dt><dd${stepAttrs(range)}>${blocks(content, ctx, fs)}</dd>`;
      } else {
        const lab = label !== null ? ` data-label="${esc(label)}" class="custom"` : '';
        html += `<li${lab}${stepAttrs(range)}>${blocks(content, ctx, fs)}</li>`;
      }
    }
    return `<${tag}${stepAttrs({ from: listFrom })}>${html}</${tag}>`;
  }
  if (env in BOXES) {
    flushPara();
    const ov = r.readOverlay();
    let title = env.endsWith('block') ? r.readGroup() : BOX_TITLES[env] ?? '';
    const opt = env.endsWith('block') ? null : r.readOptional();
    if (opt) title += ` (${opt})`;
    const range = ov ? ctx.steps.overlay(ov) : { from: ctx.steps.cur };
    const body = blocks(r.readEnvBody(env), ctx, fs);
    return `<div class="${BOXES[env]}"${stepAttrs(range)}>${title ? `<div class="box-title">${inline(title, ctx)}</div>` : ''}<div class="box-body">${body}</div></div>`;
  }
  if (env === 'columns') {
    flushPara();
    const opt = r.readOptional();
    const body = r.readEnvBody(env);
    const cr = new Reader(body);
    let cols = '';
    while (!cr.done) {
      if (cr.startsWith('\\begin{column}')) {
        cr.pos += '\\begin{column}'.length;
        const ov = cr.readOverlay();
        cr.readOptional();
        const width = cssWidth(cr.readGroup());
        const range = ov ? ctx.steps.overlay(ov) : { from: ctx.steps.cur };
        cols += `<div class="col" style="flex:0 0 ${width}"${stepAttrs(range)}>${blocks(cr.readEnvBody('column'), ctx, fs)}</div>`;
      } else cr.pos++;
    }
    const align = opt?.includes('T') || opt?.includes('t') ? ' top' : opt?.includes('b') ? ' bottom' : '';
    return `<div class="cols${align}">${cols}</div>`;
  }
  if (env === 'center' || env === 'flushleft' || env === 'flushright' || env === 'figure' || env === 'minipage') {
    flushPara();
    if (env === 'figure') r.readOptional();
    let style = '';
    if (env === 'minipage') { r.readOptional(); style = ` style="width:${cssWidth(r.readGroup())}"`; }
    return `<div class="${env}"${style}>${blocks(r.readEnvBody(env), ctx, fs)}</div>`;
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
  if (env === 'tabular' || env === 'tabularx' || env === 'tabular*' || env === 'longtable') {
    flushPara();
    if (env === 'tabularx' || env === 'tabular*') r.readGroup();
    r.readOptional();
    const spec = r.readGroup();
    const from = ctx.steps.cur;
    return `<div class="tblwrap"${stepAttrs({ from })}>${tableHtml(spec, r.readEnvBody(env), ctx)}</div>`;
  }
  if (env === 'table') {
    flushPara();
    r.readOptional();
    return `<div class="center">${blocks(r.readEnvBody(env), ctx, fs)}</div>`;
  }
  if (env === 'verbatim' || env === 'lstlisting' || env === 'minted' || env === 'Verbatim') {
    flushPara();
    if (env === 'lstlisting' || env === 'Verbatim') r.readOptional();
    if (env === 'minted') { r.readOptional(); r.readGroup(); }
    const code = r.readEnvBody(env).replace(/^\n/, '').replace(/\s+$/, '');
    return `<pre class="code"${stepAttrs({ from: ctx.steps.cur })}>${esc(code)}</pre>`;
  }
  return null;
}

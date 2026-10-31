// Whole document: preamble metadata, sections, frames → Deck.
import { Reader, stripComments } from './reader.ts';
import { Steps, inline, compactHtml, type Ctx, type Macro } from './inline.ts';
import { blocks, type FrameState } from './frame.ts';
import { texToSvg } from './math.ts';
import type { SceneSpec } from './scene.ts';
import { fragmentPreamble } from './latexsvg.ts';

export interface Slide {
  kind: 'title' | 'frame';
  section?: string;
  title?: string;
  subtitle?: string;
  html: string;
  steps: number;
  notes: string[];
  covered: boolean;
  plain: boolean;
}

export interface Diagnostic { slide?: number; line?: number; message: string }

export interface Deck {
  meta: { title: string; subtitle: string; author: string; institute: string; date: string; theme: 'dark' | 'light' };
  slides: Slide[];
  scenes: SceneSpec[];
  warnings: Diagnostic[];
}

export const formatDiagnostic = (d: Diagnostic) =>
  `${d.line ? `line ${d.line}` : ''}${d.slide ? `${d.line ? ', ' : ''}slide ${d.slide}` : ''}${d.line || d.slide ? ': ' : ''}${d.message}`;

/** Source line of every frame start (comments skipped), in document order. */
function frameLines(source: string): number[] {
  const out: number[] = [];
  source.split('\n').forEach((line, i) => {
    const code = line.replace(/(^|[^\\])%.*$/, '$1');
    const n = (code.match(/\\begin\{frame\}|\\frame(?![A-Za-z])/g) ?? []).length;
    for (let k = 0; k < n; k++) out.push(i + 1);
  });
  return out;
}

/** Value of the last `\cmd[short]{long}` in the preamble, read brace-aware. */
function preambleArg(pre: string, cmd: string): string | null {
  let found: string | null = null;
  const re = new RegExp(`\\\\${cmd}(?![A-Za-z])`, 'g');
  let m;
  while ((m = re.exec(pre))) {
    const r = new Reader(pre);
    r.pos = m.index + m[0].length;
    r.readOptional();
    r.skipSpace();
    if (r.peek() === '{') found = r.readBalanced('{', '}');
  }
  return found;
}

function collectMacros(pre: string): { macros: Record<string, Macro>; mathDefs: string } {
  const macros: Record<string, Macro> = {};
  const defs: string[] = [];
  const re = /\\(?:re)?newcommand\*?|\\DeclareMathOperator\*?|\\def(?![A-Za-z])/g;
  let m;
  while ((m = re.exec(pre))) {
    const r = new Reader(pre);
    r.pos = m.index + m[0].length;
    r.skipSpace();
    const start = m.index;
    if (m[0].startsWith('\\def')) {
      const name = r.readCommandName();
      const body = r.readGroup();
      macros[name] = { nargs: 0, body };
      defs.push(pre.slice(start, r.pos));
      continue;
    }
    const nameRaw = r.peek() === '{' ? r.readBalanced('{', '}') : (r.readCommandName(), pre.slice(start + m[0].length, r.pos).trim());
    const name = nameRaw.trim().replace(/^\\/, '');
    if (m[0].startsWith('\\Declare')) {
      const op = r.readGroup();
      defs.push(pre.slice(start, r.pos));
      macros[name] = { nargs: 0, body: `$\\operatorname{${op}}$` };
      continue;
    }
    const n = r.readOptional();
    const dflt = r.readOptional();
    if (dflt !== null) { defs.push(pre.slice(start, r.pos) + r.readGroup()); continue; } // optional-arg macros: math only
    const body = r.readGroup();
    macros[name] = { nargs: n ? parseInt(n, 10) : 0, body };
    defs.push(pre.slice(start, r.pos));
  }
  return { macros, mathDefs: defs.join('\n') };
}

function collectColors(pre: string): Record<string, string> {
  const colors: Record<string, string> = {};
  const re = /\\definecolor\{([^}]+)\}\{([^}]+)\}\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(pre))) {
    const [, name, model, val] = m;
    if (model === 'HTML') colors[name] = `#${val.trim()}`;
    else if (model === 'RGB') colors[name] = `rgb(${val})`;
    else if (model === 'rgb') colors[name] = `rgb(${val.split(',').map((x) => Math.round(parseFloat(x) * 255)).join(',')})`;
    else if (model === 'gray') colors[name] = `hsl(0 0% ${parseFloat(val) * 100}%)`;
  }
  return colors;
}

export function parseDeck(source: string, baseDir: string): Deck {
  const src = stripComments(source);
  const bd = src.indexOf('\\begin{document}');
  const ed = src.indexOf('\\end{document}');
  if (bd < 0) throw new Error('no \\begin{document} found');
  const pre = src.slice(0, bd);
  const body = src.slice(bd + '\\begin{document}'.length, ed < 0 ? undefined : ed);

  const warnings: Diagnostic[] = [];
  const seen = new Set<string>();
  const lines = frameLines(source);
  let frameNo = 0;
  let where: { slide?: number; line?: number } = {};
  const { macros, mathDefs } = collectMacros(pre);
  // MathJax keeps \newcommand definitions for the lifetime of the document.
  if (mathDefs) { try { texToSvg(mathDefs); } catch (e) { warnings.push({ message: `math macros: ${e}` }); } }

  const theme = preambleArg(pre, 'auroratheme')?.trim() === 'light' ? 'light' : 'dark';
  const baseCtx = { colors: collectColors(pre), macros, baseDir, latexPreamble: fragmentPreamble(pre), latexTheme: theme as 'dark' | 'light' };
  const mkCtx = (steps = new Steps()): Ctx => ({
    ...baseCtx,
    steps,
    warn: (msg) => {
      const key = `${where.slide}|${msg}`;
      if (!seen.has(key)) { seen.add(key); warnings.push({ ...where, message: msg }); }
    },
  });

  const metaCtx = mkCtx();
  const field = (cmd: string) => { const v = preambleArg(pre, cmd); return v === null ? '' : inline(v, metaCtx); };
  const meta = {
    title: field('title'), subtitle: field('subtitle'), author: field('author'),
    institute: field('institute'), date: preambleArg(pre, 'date') === null ? '' : field('date'),
    theme: (preambleArg(pre, 'auroratheme')?.trim() === 'light' ? 'light' : 'dark') as 'dark' | 'light',
  };
  const covered = /\\setbeamercovered\{\s*(transparent|dynamic)/.test(pre);

  const deck: Deck = { meta, slides: [], scenes: [], warnings };
  const titleSlide = (): Slide => ({ kind: 'title', html: '', steps: 1, notes: [], covered: false, plain: true });

  let section = '';
  const r = new Reader(body);
  while (!r.done) {
    if (r.peek() !== '\\') { r.pos++; continue; }
    const name = r.readCommandName();
    if (name === 'section' || name === 'subsection') {
      r.readStar();
      r.readOptional();
      const t = inline(r.readGroup(), metaCtx);
      if (name === 'section') section = t;
      continue;
    }
    if (name === 'titlepage' || name === 'maketitle') { deck.slides.push(titleSlide()); continue; }
    if (name === 'frame' || (name === 'begin' && r.readGroup() === 'frame')) {
      let opts: string | null = null, title: string | null = null, subtitle: string | null = null, content: string;
      if (name === 'frame') {
        opts = r.readOptional();
        content = r.readGroup();
      } else {
        r.readOverlay();
        opts = r.readOptional();
        // `\begin{frame}{Title}{Subtitle}` — groups must follow on the same logical line.
        const tryGroup = () => {
          const save = r.pos;
          r.skipSpace(false);
          if (r.peek() === '{') return r.readBalanced('{', '}');
          r.pos = save;
          return null;
        };
        title = tryGroup();
        if (title !== null) subtitle = tryGroup();
        content = r.readEnvBody('frame');
      }
      where = { slide: deck.slides.length + 1, line: lines[frameNo++] };
      const steps = new Steps();
      const ctx = mkCtx(steps);
      const fs: FrameState = { notes: [], scenes: [], titlepage: false };
      if (title !== null) fs.title = inline(title, ctx);
      if (subtitle !== null) fs.subtitle = inline(subtitle, ctx);
      let html = blocks(content, ctx, fs);
      where = {};
      if (fs.titlepage) { deck.slides.push(titleSlide()); continue; }

      const { map, count } = steps.compaction();
      html = compactHtml(html, map);
      const offset = deck.scenes.length;
      html = html.replace(/data-scene="(\d+)"/g, (_, i) => `data-scene="${offset + Number(i)}"`);
      for (const sc of fs.scenes) {
        for (const ev of sc.events) ev.step = map(ev.step);
        deck.scenes.push(sc);
      }
      const plain = !!opts && /\bplain\b/.test(opts);
      deck.slides.push({
        kind: 'frame', section: section || undefined, title: fs.title, subtitle: fs.subtitle,
        html, steps: count, notes: fs.notes, covered, plain,
      });
      continue;
    }
  }
  return deck;
}

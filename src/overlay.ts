// Beamer's overlay model: overlay specifications, the beamerpauses counter,
// and rewriting overlay commands for one slide (used for maths and LaTeX fragments).
import { Reader } from './reader.ts';

/** Half-open interval of beamer slide numbers; `until` undefined = to the end. */
export type Interval = [number, number | undefined];

/** When something is visible. `on` is set only for multi-interval specs like `<1,3->`. */
export interface Range { from: number; until?: number; on?: Interval[] }

export interface Spec { vis: Range | null; alert: Range | null; structure: Range | null }

const MODES = /^(beamer|presentation|handout|trans|article|second|all)\s*:\s*/;

/**
 * Beamer's `beamerpauses` model. `cur` is the slide number from which
 * un-annotated content is visible; `counter` feeds `+` in overlay specs.
 * Numbers are beamer-style (1-based) and compacted later by `compaction()`.
 */
export class Steps {
  counter = 1;
  cur = 1;
  used = new Set<number>([1]);
  /** Slides where something starts; the frame has as many steps as the largest of these. */
  froms = new Set<number>([1]);
  /** Set by a bare `\onslide<spec>` switch; applies to following content. */
  override: Range | null = null;
  /** Handout mode: one slide per frame; only `handout:` specs count. */
  handout: boolean;

  constructor(handout = false) { this.handout = handout; }

  pause() {
    if (this.handout) return;
    this.counter++; this.cur = this.counter; this.mark(this.cur, true); this.override = null;
  }

  /** Range for content with no overlay spec of its own. */
  here(): Range { return this.override ?? { from: this.cur }; }

  /** Visibility range for an overlay spec (alert-only specs give `here()`). */
  overlay(spec: string): Range {
    return this.spec(spec).vis ?? this.here();
  }

  /**
   * Parses a full spec: `2-`, `3`, `2-4`, `-3`, `1,3-`, `+-`, `+(1)-`, `.-`,
   * `+-| alert@+`, `alert@2`, `beamer:2-|handout:0`.
   * All `+` in one spec share a value; the counter advances once afterwards.
   */
  spec(raw: string): Spec {
    const plus = this.counter;
    let sawPlus = false;
    const num = (s: string, dflt: number): number => {
      s = s.trim();
      const m = /^([+.])\s*(?:\((-?\d+)\))?$/.exec(s);
      if (m) {
        const off = m[2] ? parseInt(m[2], 10) : 0;
        if (m[1] === '+') { sawPlus = true; return plus + off; }
        return Math.max(1, plus - 1 + off);
      }
      if (s === '') return dflt;
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : dflt;
    };
    const intervals = (list: string): Interval[] => list.split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
      // A dash that is not inside `(…)` separates the ends.
      let dash = -1, depth = 0;
      for (let i = 0; i < p.length; i++) {
        if (p[i] === '(') depth++; else if (p[i] === ')') depth--;
        else if (p[i] === '-' && depth === 0) { dash = i; break; }
      }
      if (dash < 0) { const n = num(p, this.cur); return [n, n + 1] as Interval; }
      const from = num(p.slice(0, dash), 1);
      const end = p.slice(dash + 1).trim();
      return [from, end === '' ? undefined : num(end, from) + 1] as Interval;
    });

    const out: Spec = { vis: null, alert: null, structure: null };
    let handoutPart: string | null = null;
    for (let part of raw.split('|')) {
      part = part.trim();
      if (!part) continue;
      const mode = MODES.exec(part);
      if (mode) {
        part = part.slice(mode[0].length);
        if (mode[1] === 'handout') { handoutPart = part; continue; }
        if (!['beamer', 'presentation', 'all'].includes(mode[1])) continue;
      }
      const act = /^([a-z]+)\s*@\s*/.exec(part);
      const action = act ? act[1] : 'vis';
      const ivs = intervals(act ? part.slice(act[0].length) : part);
      if (!ivs.length) continue;
      const range = this.toRange(ivs);
      if (action === 'alert') out.alert = range;
      else if (action === 'structure') out.structure = range;
      else if (action === 'invisible') out.vis = this.toRange(complement(ivs));
      else out.vis = range;
    }
    if (sawPlus) this.counter = plus + 1;
    if (this.handout) {
      // Only `handout:` parts matter; `handout:0` hides, anything else shows.
      const hidden = handoutPart !== null && /^\s*0\s*$/.test(handoutPart);
      return { vis: hidden ? { from: 1, until: 1 } : null, alert: null, structure: null };
    }
    return out;
  }

  private toRange(ivs: Interval[]): Range {
    for (const [a, b] of ivs) { this.mark(a, true); if (b !== undefined) this.mark(b); }
    if (this.handout) return { from: 1 };
    if (ivs.length === 1) return ivs[0][1] === undefined ? { from: ivs[0][0] } : { from: ivs[0][0], until: ivs[0][1] };
    const sorted = [...ivs].sort((x, y) => x[0] - y[0]);
    return { from: sorted[0][0], on: sorted };
  }

  /** Records a slide number; `from` = something becomes visible there (it extends the frame). */
  mark(n: number, from = false) { if (this.handout) return; this.used.add(n); if (from) this.froms.add(n); }

  /** Map of beamer slide number → dense 0-based step index. */
  compaction(): { map: (n: number) => number; count: number } {
    const last = Math.max(...this.froms);
    const sorted = [...this.used].filter((n) => n <= last).sort((a, b) => a - b);
    const idx = new Map(sorted.map((n, i) => [n, i]));
    return {
      map: (n) => {
        const hit = idx.get(n);
        if (hit !== undefined) return hit;
        // Unused numbers snap to the next used slide.
        const i = sorted.findIndex((x) => x > n);
        return i < 0 ? sorted.length : i;
      },
      count: sorted.length,
    };
  }
}

function complement(ivs: Interval[]): Interval[] {
  const sorted = [...ivs].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  let at = 1;
  for (const [a, b] of sorted) {
    if (a > at) out.push([at, a]);
    if (b === undefined) return out;
    at = Math.max(at, b);
  }
  out.push([at, undefined]);
  return out;
}

/** True if beamer slide `k` lies in `r`. */
export function inRange(r: Range, k: number): boolean {
  const ivs = r.on ?? [[r.from, r.until]];
  return ivs.some(([a, b]) => k >= a && (b === undefined || k < b));
}

/** `data-from/until/on` (or `data-fx-…` with prefix 'fx-') attributes for a range. */
export function stepAttrs(r: Range, prefix = ''): string {
  let s = ` data-${prefix}from="${r.from}"`;
  if (r.on) s += ` data-${prefix}on="${r.on.map(([a, b]) => `${a}:${b ?? ''}`).join(' ')}"`;
  else if (r.until !== undefined) s += ` data-${prefix}until="${r.until}"`;
  return s;
}

/** Rewrites raw beamer step numbers in emitted HTML to compacted indices. */
export function compactHtml(html: string, map: (n: number) => number, count = Infinity): string {
  return html
    .replace(/ data-((?:fx-)?until)="(\d+)"/g, (_, k, n) => (map(+n) >= count ? '' : ` data-${k}="${map(+n)}"`))
    .replace(/data-((?:fx-)?from)="(\d+)"/g, (_, k, n) => `data-${k}="${map(+n)}"`)
    .replace(/data-((?:fx-)?on)="([^"]*)"/g, (_, k, v: string) =>
      `data-${k}="${v.split(' ').map((iv) => { const [a, b] = iv.split(':'); return `${map(+a)}:${b === '' ? '' : map(+b)}`; }).join(' ')}"`);
}

// ---------------------------------------------------------------------------
// Overlay commands inside maths and LaTeX fragments.

const OVERLAY_CMDS = /\\(only|uncover|visible|invisible|onslide|alt|temporal|alert|textcolor|color|textbf|structure|pause|draw|fill|filldraw|path|node|shade|shadedraw|clip|coordinate|item|includegraphics)\s*<|\\pause(?![A-Za-z])/;

export function hasOverlays(src: string): boolean { return OVERLAY_CMDS.test(src); }

/**
 * Resolves `+` / `.` in every overlay spec of `src` to numbers, using (and
 * advancing) the frame's counter exactly like Beamer would; `\pause` becomes
 * an `\onslide<n->` switch. Returns the rewritten source.
 */
export function resolveRelative(src: string, steps: Steps): string {
  let out = '';
  const re = /<([^<>\n]*)>|\\pause(?![A-Za-z])(\[\d+\])?/g;
  let last = 0, m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith('\\pause')) {
      out += src.slice(last, m.index);
      steps.pause();
      out += `\\aurorapause<${steps.cur}->`;
      last = m.index + m[0].length;
      continue;
    }
    const spec = m[1];
    // Only specs that follow a command name or `]` (e.g. \draw<2->, \item<+->, [<+->]).
    const before = src.slice(Math.max(0, m.index - 30), m.index);
    if (!/(\\[A-Za-z]+\*?|\]|\[)\s*$/.test(before) || !/^[\d+.\-, |a-z@:()]*$/.test(spec)) continue;
    out += src.slice(last, m.index);
    const parts = spec.split('|');
    const resolved = /[+.]/.test(spec) ? resolveParts(parts, steps) : spec;
    // Record starts (which extend the frame) and ends.
    for (const part of resolved.split(/[|,]/)) {
      const p = part.replace(/^\s*[a-z]+\s*[:@]\s*/, '').replace(/^\s*[a-z]+\s*[:@]\s*/, '');
      const [a, b] = p.split('-').map((x) => x?.trim());
      if (a) steps.mark(+a, true);
      if (b) steps.mark(+b + 1);
      else if (b === undefined && a) steps.mark(+a + 1);
    }
    out += `<${resolved}>`;
    last = m.index + m[0].length;
  }
  return out + src.slice(last);
}

function resolveParts(parts: string[], steps: Steps): string {
  const plus = steps.counter;
  let sawPlus = false;
  const res = parts.map((p) => p.replace(/([+.])\s*(?:\((-?\d+)\))?/g, (_, c, off) => {
    const o = off ? parseInt(off, 10) : 0;
    if (c === '+') { sawPlus = true; return String(plus + o); }
    return String(Math.max(1, plus - 1 + o));
  })).join('|');
  if (sawPlus) steps.counter = plus + 1;
  return res;
}

/** True if slide k is in a resolved (numeric) spec, beamer mode. */
export function specHas(spec: string, k: number): boolean {
  let any = false, hit = false;
  for (let part of spec.split('|')) {
    part = part.trim();
    const mode = MODES.exec(part);
    if (mode) { if (!['beamer', 'presentation', 'all'].includes(mode[1])) continue; part = part.slice(mode[0].length); }
    if (/^[a-z]+@/.test(part)) continue;
    any = true;
    hit ||= part.split(',').some((p) => {
      const [a, b] = p.split('-').map((x) => x.trim());
      const lo = a === '' ? 1 : +a;
      const hi = b === undefined ? lo : b === '' ? Infinity : +b;
      return k >= lo && k <= hi;
    });
  }
  return !any || hit;
}

function alertSpec(spec: string): string | null {
  const m = /alert@([\d,\- ]+)/.exec(spec);
  return m ? m[1] : null;
}

/**
 * The source as it looks on slide `k` (specs must already be numeric; see
 * `resolveRelative`). `mode` decides how hidden-but-space-keeping content is
 * written: maths uses \phantom, TikZ an opacity-0 scope, text drops it.
 */
export function atSlide(src: string, k: number, mode: 'math' | 'tikz' | 'text', alertColor = 'orange'): string {
  const r = new Reader(src);
  let out = '';
  const hide = (body: string, keepSpace: boolean) => {
    if (!keepSpace) return '';
    if (mode === 'math') return `\\phantom{${body}}`;
    if (mode === 'tikz') return `\\begin{scope}[opacity=0]${body}\\end{scope}`;
    return `\\phantom{${body}}`;
  };
  const group = () => { r.skipSpace(); return r.peek() === '{' ? r.readBalanced('{', '}') : r.readGroup(); };
  while (!r.done) {
    const c = r.peek();
    if (c !== '\\') { out += c; r.pos++; continue; }
    const save = r.pos;
    const name = r.readCommandName();
    const ov = r.readOverlay();
    if (ov === null) {
      if (/^(aurorapause)$/.test(name)) { /* handled below */ }
      out += src.slice(save, r.pos);
      continue;
    }
    const recur = (s: string) => atSlide(s, k, mode, alertColor);
    const on = specHas(ov, k);
    switch (name) {
      case 'aurorapause': {
        // Everything after a \pause, up to the end of the enclosing environment, shows from its slide on.
        const from = parseInt(ov, 10);
        if (k >= from) continue;
        const end = envEnd(src, r.pos);
        const part = atSlide(src.slice(r.pos, end), Infinity, mode, alertColor);
        r.pos = end;
        if (mode === 'tikz') out += `\\begin{scope}[opacity=0]${part}\\end{scope}`;
        else if (mode === 'math' && !/&|\\\\/.test(part)) out += `\\phantom{${part}}`;
        continue;
      }
      case 'only': { const b = group(); out += on ? recur(b) : ''; continue; }
      case 'onslide': {
        r.skipSpace();
        if (r.peek() === '{') { const b = group(); out += on ? recur(b) : hide(recur(b), true); continue; }
        // Bare switch: the rest of the group follows the spec.
        const rest = src.slice(r.pos);
        r.pos = src.length;
        out += on ? recur(rest) : hide(recur(rest), true);
        continue;
      }
      case 'uncover': case 'visible': { const b = group(); out += on ? recur(b) : hide(recur(b), true); continue; }
      case 'invisible': { const b = group(); out += on ? hide(recur(b), true) : recur(b); continue; }
      case 'alt': { const a = group(); const b = group(); out += recur(on ? a : b); continue; }
      case 'temporal': {
        const a = group(), b = group(), c2 = group();
        const lo = Math.min(...(ov.match(/\d+/g) ?? ['1']).map(Number));
        out += recur(on ? b : k < lo ? a : c2);
        continue;
      }
      case 'alert': case 'structure': {
        const b = group();
        out += on && !/^\s*$/.test(ov) ? (mode === 'text' ? `\\textcolor{${alertColor}}{${recur(b)}}` : `{\\color{${alertColor}}${recur(b)}}`) : recur(b);
        continue;
      }
      case 'textbf': { const b = group(); out += on ? `\\textbf{${recur(b)}}` : recur(b); continue; }
      case 'textcolor': { const col = group(); const b = group(); out += on ? `\\textcolor{${col}}{${recur(b)}}` : recur(b); continue; }
      case 'color': { const col = group(); out += on ? `\\color{${col}}` : ''; continue; }
      case 'item': { out += '\\item'; continue; }
      case 'includegraphics': { if (on) out += '\\includegraphics'; else { r.readOptional(); group(); } continue; }
      default: {
        if (!PATH_CMDS.has(name)) { out += src.slice(save, r.pos); continue; }
        // TikZ path commands with specs: \draw<2->[…] … ; (only-like in Beamer, but we keep the bounding box).
        const end = scanPath(src, r.pos);
        const rest = src.slice(r.pos, end);
        r.pos = end;
        const a = alertSpec(ov);
        if (a !== null && specHas(a, k)) { out += `\\${name}[${alertColor}]${rest}`; continue; }
        out += on ? `\\${name}${rest}` : mode === 'tikz' ? `\\begin{scope}[opacity=0]\\${name}${rest}\\end{scope}` : '';
      }
    }
  }
  return out;
}

/** Offset of the `\\end{…}` that closes the environment enclosing `pos` (or the end). */
function envEnd(src: string, pos: number): number {
  let depth = 0;
  const re = /\\(begin|end)\s*\{[^}]*\}/g;
  re.lastIndex = pos;
  let m;
  while ((m = re.exec(src))) {
    if (m[1] === 'begin') depth++;
    else if (depth-- === 0) return m.index;
  }
  return src.length;
}

const PATH_CMDS = new Set(['draw', 'fill', 'filldraw', 'path', 'node', 'shade', 'shadedraw', 'clip', 'coordinate', 'pic']);

/** End of a TikZ path command starting at `pos` (after its overlay spec): the `;` at depth 0. */
function scanPath(src: string, pos: number): number {
  let depth = 0;
  for (let i = pos; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ';' && depth <= 0) return i + 1;
  }
  return src.length;
}

/** Every slide number at which the look of a resolved fragment can change. */
export function changePoints(src: string): number[] {
  const out = new Set<number>();
  for (const m of src.matchAll(/<([\d,\- |a-z@:]*)>/g)) {
    for (const part of m[1].split(/[|,]/)) {
      const p = part.replace(/^[a-z]+\s*[:@]\s*/, '').replace(/^[a-z]+\s*[:@]\s*/, '');
      const [a, b] = p.split('-');
      if (a !== undefined && a.trim() !== '') out.add(+a);
      if (b !== undefined && b.trim() !== '') out.add(+b + 1);
      if (b === undefined && a !== undefined && a.trim() !== '') out.add(+a + 1);
    }
  }
  return [...out].filter((n) => Number.isFinite(n) && n >= 1).sort((a, b) => a - b);
}

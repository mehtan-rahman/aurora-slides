// `\begin{scene}...\end{scene}` → SceneSpec (objects + step-tagged events).
import { Reader, parseKeyVals, splitTop } from './reader.ts';
import { texToSvg } from './math.ts';
import { resolveColor, type Ctx } from './inline.ts';
import { layout, alignTo, chemReady, valenceLp, bestFacing, rotateMol, translateMol, molCentre, type MolGeom, type LayoutOpts, type Atom } from './chem.ts';
import { COMMANDS, ACTION_SPECS, COMMON_KEYS, suggest } from './schema.ts';

export type Props = Record<string, string | true>;

export interface SceneObj {
  id: string;
  kind: string;
  props: Props;
  svg?: string;      // pre-rendered MathTex
  text?: string;     // Text content / Plot expression
  mol?: MolGeom;     // Molecule geometry (absolute scene units)
  hidden?: boolean;  // created by a transform; no intro of its own
}

export interface SceneEvent {
  step: number;
  type: 'intro' | 'animate' | 'fadeout' | 'indicate' | 'wait' | 'transform' | 'transformtex';
  target?: string;
  sources?: string[];
  targets?: Record<string, string>;
  anim?: string;
  run?: number;
  delay?: number;
  with?: boolean;
  /** Transform: false = no electron-flow phase. */
  flow?: boolean;
}

export interface SceneSpec {
  size: [number, number];
  objects: SceneObj[];
  events: SceneEvent[];
}

const WITH_CONTENT = new Set(['Plot', 'MathTex', 'Text', 'Molecule']);
const ACTIONS: Record<string, SceneEvent['type']> = {
  Animate: 'animate', FadeOut: 'fadeout', Indicate: 'indicate', Wait: 'wait', Transform: 'transform', TransformTex: 'transformtex',
};
const TIMING_KEYS = ['anim', 'run', 'delay', 'with', 'id'];
const SUB: Record<string, string> = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋' };
const SUP: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻' };

/** Strips TeX markup from plain scene text (SVG <text> can't hold HTML). */
function plainText(s: string): string {
  return s
    .replace(/\$/g, '')
    .replace(/_\{([^}]*)\}|_([0-9+-])/g, (_, a, b) => [...(a ?? b)].map((c) => SUB[c] ?? c).join(''))
    .replace(/\^\{([^}]*)\}|\^([0-9+-])/g, (_, a, b) => [...(a ?? b)].map((c) => SUP[c] ?? c).join(''))
    .replace(/\\(textbf|textit|emph|text|mbox)\s*\{([^{}]*)\}/g, '$2')
    .replace(/\\([%&$#_{}])/g, '$1')
    .replace(/---/g, '—').replace(/--/g, '–').replace(/~/g, ' ')
    .replace(/``/g, '“').replace(/''/g, '”')
    .replace(/[{}]/g, '')
    .trim();
}

const vec2 = (s: string | true | undefined, d: [number, number]): [number, number] => {
  if (typeof s !== 'string') return d;
  const v = splitTop(s).map(Number);
  return [Number.isFinite(v[0]) ? v[0] : d[0], Number.isFinite(v[1]) ? v[1] : d[1]];
};

function lpOption(v: string | true | undefined): LayoutOpts['lp'] {
  if (v === undefined) return undefined;
  if (v === true || v === 'auto') return 'auto';
  const out: Record<number, number | null> = {};
  for (const part of splitTop(v)) {
    const [m, c] = part.split(':').map((x) => x.trim());
    out[Number(m)] = c === undefined ? null : Number(c);
  }
  return out;
}

function molOpts(kv: Props): LayoutOpts {
  return {
    at: typeof kv.at === 'string' ? vec2(kv.at, [0, 0]) : undefined,
    bond: typeof kv.bond === 'string' ? Number(kv.bond) : undefined,
    rotate: typeof kv.rotate === 'string' ? Number(kv.rotate) : undefined,
    flip: kv.flip === true,
    carbons: typeof kv.carbons === 'string' ? (kv.carbons as LayoutOpts['carbons']) : undefined,
    lp: lpOption(kv.lp),
  };
}

function validate(name: string, kv: Props, ctx: Ctx) {
  const spec = COMMANDS[name] ?? ACTION_SPECS[name];
  if (!spec || name === 'Animate') return;
  const allowed = [...Object.keys(spec.keys), ...Object.keys(COMMON_KEYS)];
  for (const k of Object.keys(kv)) {
    if (allowed.includes(k)) continue;
    const s = suggest(k, allowed);
    ctx.warn(`\\${name}: unknown key "${k}"${s ? ` (did you mean "${s}"?)` : ''}`);
  }
}

export function parseScene(opts: string | null, body: string, ctx: Ctx): SceneSpec {
  const o = parseKeyVals(opts);
  const size = typeof o.size === 'string' ? splitTop(o.size).map(Number) : [14, 6];
  const spec: SceneSpec = { size: [size[0] || 14, size[1] || 6], objects: [], events: [] };
  const r = new Reader(body);
  const byId = new Map<string, SceneObj>();
  const alias = new Map<string, string>(); // user-facing id → current object id (after transforms)
  const cur = (id: string) => alias.get(id) ?? id;
  let auto = 0;

  const liveMols: string[] = []; // molecules current at this point in the script
  const orientable = new Set<string>(); // freshly declared molecules the user didn't rotate
  let pendingArrows: Props[] = [];
  const findAtom = (map: number) => {
    for (const id of liveMols) {
      const g = byId.get(id)!.mol!;
      const i = g.atoms.findIndex((a) => a.map === map);
      if (i >= 0) return { id, g, i };
    }
    return null;
  };
  // Turn reactants so the curly arrows read like a textbook: the attacked atom opens toward
  // the nucleophile (leaving group anti to it), the nucleophile's free side faces the target.
  const orientPending = () => {
    const arrows = pendingArrows;
    pendingArrows = [];
    const num = (v: unknown, re: RegExp) => { const m = re.exec(String(v ?? '').trim()); return m ? Number(m[1]) : NaN; };
    for (const p of arrows) {
      const src = findAtom(num(p.from, /^@?(?:lp:)?(\d+)$/)), dst = findAtom(num(p.to, /^@?(\d+)$/));
      if (!src || !dst || src.id === dst.id) continue;
      const Y = dst.g.atoms[dst.i];
      if (orientable.has(dst.id)) {
        // A bond arrow Y–Z → Z in the same batch marks Z as the leaving group.
        let anti: number | undefined;
        for (const q of arrows) {
          const m = /^@?(\d+)\s*[-=#~.:]+\s*(\d+)$/.exec(String(q.from ?? '').trim());
          const z = num(q.to, /^@?(\d+)$/);
          if (m && (Number(m[1]) === Y.map || Number(m[2]) === Y.map) && (Number(m[1]) === z || Number(m[2]) === z) && z !== Y.map) {
            const k = dst.g.atoms.findIndex((a) => a.map === z);
            if (k >= 0) anti = k;
          }
        }
        const X = src.g.atoms[src.i];
        const th = bestFacing(dst.g, dst.i, [X.x, X.y], anti);
        if (th) rotateMol(dst.g, th, molCentre(dst.g));
        orientable.delete(dst.id);
      }
      if (orientable.has(src.id)) {
        const X = src.g.atoms[src.i];
        const th = bestFacing(src.g, src.i, [Y.x, Y.y]);
        if (th) rotateMol(src.g, th, molCentre(src.g));
        if (!src.g.bonds.length) X.hleft = Y.x > X.x; // HO⁻ ··· target on the right
        // A small nucleophile slides level with its target so the attack reads straight on.
        const heavy = src.g.atoms.filter((a) => a.sym !== 'H').length;
        const dx = Y.x - X.x, dy = Y.y - X.y;
        if (heavy <= 3 && Math.abs(dx) > 2 * Math.abs(dy)) translateMol(src.g, 0, dy);
        orientable.delete(src.id);
      }
    }
  };
  const addObj = (obj: SceneObj) => {
    // Atom refs (@3, lp:5, 2-3) resolve against the molecules alive when the object is declared.
    if (obj.kind === 'CurlyArrow' || Object.values(obj.props).some((v) => typeof v === 'string' && v.startsWith('@'))) obj.props.mols = liveMols.join(',');
    spec.objects.push(obj);
    byId.set(obj.id, obj);
    if (obj.kind === 'Molecule') liveMols.push(obj.id);
    if (obj.kind === 'CurlyArrow') pendingArrows.push(obj.props);
  };

  while (true) {
    r.skipSpace();
    if (r.done) break;
    if (r.peek() !== '\\') {
      ctx.warn(`scene: ignoring stray text "${body.slice(r.pos, r.pos + 20).trim()}…"`);
      while (!r.done && r.peek() !== '\\') r.pos++;
      continue;
    }
    const name = r.readCommandName();
    if (name === 'pause') { ctx.steps.pause(); continue; }

    const kv = parseKeyVals(r.readOptional());
    validate(name, kv, ctx);
    const timing: Partial<SceneEvent> = {};
    if (typeof kv.anim === 'string') timing.anim = kv.anim;
    if (typeof kv.run === 'string') timing.run = parseFloat(kv.run);
    if (typeof kv.delay === 'string') timing.delay = parseFloat(kv.delay);
    if (kv.with === true) timing.with = true;
    const step = ctx.steps.cur;
    const props = (src: Props): Props => {
      const p: Props = {};
      for (const [k, v] of Object.entries(src)) {
        if (TIMING_KEYS.includes(k)) continue;
        p[k] = k === 'color' && typeof v === 'string' ? resolveColor(v, ctx) : v;
      }
      if (typeof p.on === 'string') p.on = cur(p.on);
      return p;
    };

    if (name === 'ReactionArrow') {
      // Sugar: an Arrow plus optional TeX labels above / below its midpoint.
      const [x0, y0] = vec2(kv.from, [-1, 0]), [x1, y1] = vec2(kv.to, [1, 0]);
      const id = typeof kv.id === 'string' ? kv.id : `_rxn${auto++}`;
      const color = typeof kv.color === 'string' ? resolveColor(kv.color, ctx) : 'var(--fg)';
      addObj({ id, kind: 'Arrow', props: { from: `${x0},${y0}`, to: `${x1},${y1}`, color, width: '4', tip: '0.3' } });
      spec.events.push({ step, type: 'intro', target: id, ...timing });
      for (const [key, dy] of [['above', 0.32], ['below', -0.32]] as const) {
        const tex = kv[key];
        if (typeof tex !== 'string') continue;
        const lid = `${id}_${key}`;
        let svg = '';
        try { svg = texToSvg(tex); } catch (e) { ctx.warn(`ReactionArrow ${key}: ${e}`); }
        addObj({ id: lid, kind: 'MathTex', svg, props: { at: `${(x0 + x1) / 2},${(y0 + y1) / 2 + dy}`, size: '30', color } });
        spec.events.push({ step, type: 'intro', target: lid, with: true });
      }
      continue;
    }

    if (name in COMMANDS) {
      const id = typeof kv.id === 'string' ? kv.id : `_${name.toLowerCase()}${auto++}`;
      const obj: SceneObj = { id, kind: name, props: props(kv) };
      if (WITH_CONTENT.has(name)) {
        const content = r.readGroup();
        if (name === 'MathTex') {
          const tex = content.trim().replace(/^\$+|\$+$/g, '');
          try { obj.svg = texToSvg(tex); } catch (e) { ctx.warn(`MathTex: ${e}`); obj.svg = ''; }
          obj.text = tex;
        } else if (name === 'Molecule') {
          if (!chemReady()) { ctx.warn('Molecule: chemistry engine unavailable'); continue; }
          try { obj.mol = layout(content.trim(), molOpts(kv)); } catch (e) { ctx.warn(`Molecule: ${(e as Error).message}`); continue; }
          if (kv.rotate === undefined && kv.flip === undefined && kv.orient !== 'false') orientable.add(id);
        } else {
          obj.text = name === 'Text' ? plainText(content) : content.trim();
        }
      }
      if (byId.has(id)) ctx.warn(`scene: duplicate id "${id}"`);
      addObj(obj);
      alias.delete(id);
      if (name !== 'ValueTracker') spec.events.push({ step, type: 'intro', target: id, ...timing });
      continue;
    }

    if (name in ACTIONS) {
      const ev: SceneEvent = { step, type: ACTIONS[name], ...timing };
      if (ev.type === 'animate') {
        ev.targets = {};
        for (const [k, v] of Object.entries(kv)) if (!TIMING_KEYS.includes(k) && typeof v === 'string') ev.targets[k] = v;
      } else if (ev.type === 'transform') {
        const content = r.readGroup().trim();
        const ids = typeof kv.id === 'string' ? splitTop(kv.id) : [];
        const sources = ids.map(cur).filter((s) => byId.get(s)?.mol);
        if (!sources.length) { ctx.warn('Transform: id must name at least one Molecule'); continue; }
        orientPending();
        if (!chemReady()) continue;
        const ref: Atom[] = sources.flatMap((s) => byId.get(s)!.mol!.atoms);
        const first = byId.get(sources[0])!;
        const opts: LayoutOpts = { ...molOpts(kv), at: undefined, bond: first.mol!.bond };
        if (typeof kv.carbons !== 'string' && typeof first.props.carbons === 'string') opts.carbons = first.props.carbons as LayoutOpts['carbons'];
        let mol: MolGeom;
        try { mol = layout(content, opts); } catch (e) { ctx.warn(`Transform: ${(e as Error).message}`); continue; }
        mol = alignTo(mol, ref, typeof kv.at === 'string' ? vec2(kv.at, [0, 0]) : undefined);
        // Atoms that showed lone pairs keep showing them (recounted) unless lp= says otherwise.
        if (opts.lp !== 'auto') mol.atoms.forEach((a, i) => {
          if (!a.map || opts.lp?.[a.map] !== undefined) return;
          if (ref.some((r) => r.map === a.map && r.lp > 0)) a.lp = valenceLp(mol, i);
        });
        const userId = typeof kv.as === 'string' ? kv.as : ids[0];
        const tid = `${userId}~${auto++}`;
        const tprops = props({ ...first.props, ...kv });
        delete tprops.as; delete tprops.at; delete tprops.flow;
        addObj({ id: tid, kind: 'Molecule', props: tprops, mol, hidden: true });
        for (const id of ids) if (cur(id) !== tid) alias.set(id, tid);
        alias.set(userId, tid);
        for (const sid of sources) { const i = liveMols.indexOf(sid); if (i >= 0) liveMols.splice(i, 1); }
        ev.sources = sources;
        ev.target = tid;
        if (kv.flow === 'false') ev.flow = false;
      } else if (ev.type === 'transformtex') {
        const tex = r.readGroup().trim().replace(/^\$+|\$+$/g, '');
        const srcId = typeof kv.id === 'string' ? cur(kv.id) : '';
        const src = byId.get(srcId);
        if (!src || src.kind !== 'MathTex') { ctx.warn('TransformTex: id must name a MathTex'); continue; }
        const tid = `${kv.id}~${auto++}`;
        let svg = '';
        try { svg = texToSvg(tex); } catch (e) { ctx.warn(`TransformTex: ${e}`); }
        addObj({ id: tid, kind: 'MathTex', props: { ...src.props }, svg, text: tex, hidden: true });
        alias.set(kv.id as string, tid);
        ev.sources = [srcId];
        ev.target = tid;
      } else if (typeof kv.id === 'string') {
        ev.target = cur(kv.id);
        if (!byId.has(ev.target)) ctx.warn(`\\${name}: no object with id "${kv.id}"`);
      }
      spec.events.push(ev);
      continue;
    }

    const s = suggest(name, [...Object.keys(COMMANDS), ...Object.keys(ACTIONS), 'ReactionArrow']);
    ctx.warn(`scene: unknown command \\${name}${s ? ` (did you mean \\${s}?)` : ''}`);
    r.skipSpace();
    if (r.peek() === '{') r.readGroup();
  }
  orientPending();
  return spec;
}

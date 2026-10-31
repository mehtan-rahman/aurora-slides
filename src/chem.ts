// Molecule layout (RDKit WASM, build time) and mechanism alignment.
// Produces absolute scene coordinates so the runtime only has to draw and tween.
import { createRequire } from 'node:module';

export interface Atom {
  map: number;      // atom-map number (0 if unmapped)
  sym: string;
  x: number;        // scene units
  y: number;
  charge: number;
  hs: number;       // implicit hydrogens
  show: boolean;    // draw a label
  hleft: boolean;   // put H's on the left (HO–)
  lp: number;       // lone pairs to draw
}

export interface Bond {
  a: number;
  b: number;
  order: number;
  side: number;                // -1/0/+1 double-bond offset
  stereo?: 'wedge' | 'hash';   // narrow end at atom `a`
}
export interface MolGeom { atoms: Atom[]; bonds: Bond[]; bond: number }

let RD: any = null;

export async function initChem(): Promise<void> {
  if (RD) return;
  const require = createRequire(import.meta.url);
  const init = require('@rdkit/rdkit');
  RD = await init();
}

export const chemReady = () => RD !== null;

const SYMBOLS = ['', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
  'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo',
  'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba'];

export interface LayoutOpts {
  at?: [number, number];
  bond?: number;            // bond length in scene units
  rotate?: number;          // degrees
  flip?: boolean;
  carbons?: 'auto' | 'none' | 'all' | 'terminal';
  /** 'auto' = every heteroatom; or map → count (null = from valence). */
  lp?: 'auto' | Record<number, number | null>;
}

const VALENCE_E: Record<string, number> = { B: 3, C: 4, N: 5, P: 5, O: 6, S: 6, Se: 6, F: 7, Cl: 7, Br: 7, I: 7 };

/** SMILES → 2-D geometry in scene units, centred on `at`. */
export function layout(smiles: string, o: LayoutOpts = {}): MolGeom {
  if (!RD) throw new Error('chemistry engine not initialised (call initChem first)');
  const mol = RD.get_mol(smiles, JSON.stringify({ removeHs: false }));
  if (!mol || !mol.is_valid()) throw new Error(`invalid SMILES: ${smiles}`);
  try {
    mol.set_new_coords(true);
    mol.straighten_depiction?.();
    const j = JSON.parse(mol.get_json()).molecules[0];
    // Atom maps live in the molblock's atom lines (column 10).
    const mb: string[] = mol.get_molblock().split('\n');
    const n = j.atoms.length;
    const maps = mb.slice(4, 4 + n).map((l) => parseInt(l.slice(60, 63), 10) || 0);
    const coords: number[][] = j.conformers[0].coords;
    const bondLen = o.bond ?? 1.45;
    const k = bondLen / 1.5; // RDKit lays out with bond length 1.5
    const rot = ((o.rotate ?? 0) * Math.PI) / 180;
    let pts = coords.map(([x, y]) => {
      if (o.flip) x = -x;
      return [k * (x * Math.cos(rot) - y * Math.sin(rot)), k * (x * Math.sin(rot) + y * Math.cos(rot))];
    });
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const [ax, ay] = o.at ?? [0, 0];
    pts = pts.map(([x, y]) => [x - cx + ax, y - cy + ay]);

    regularize(pts, j.bonds.map((b: any) => b.atoms as [number, number]));
    const bonds: Bond[] = j.bonds.map((b: any) => ({ a: b.atoms[0], b: b.atoms[1], order: b.bo ?? 1, side: 0 }));
    // Wedge/hash flags come from the molblock bond lines (narrow end = first atom).
    mb.slice(4 + n, 4 + n + bonds.length).forEach((l, k) => {
      const a1 = parseInt(l.slice(0, 3), 10) - 1, st = parseInt(l.slice(9, 12), 10);
      if (st !== 1 && st !== 6) return;
      const b = bonds[k];
      if (b.a !== a1) [b.a, b.b] = [b.b, b.a];
      b.stereo = st === 1 ? 'wedge' : 'hash';
    });
    const nbrs: number[][] = Array.from({ length: n }, () => []);
    for (const b of bonds) { nbrs[b.a].push(b.b); nbrs[b.b].push(b.a); }

    const atoms: Atom[] = j.atoms.map((a: any, i: number) => {
      const sym = SYMBOLS[a.z ?? 6] ?? '?';
      const charge = a.chg ?? 0;
      // 'auto': tiny molecules (CH3Br, CH3OH) read better written out; larger ones stay skeletal.
      const carbons = (o.carbons ?? 'auto') === 'auto' ? (j.atoms.filter((x: any) => (x.z ?? 6) !== 1).length <= 3 ? 'all' : 'none') : o.carbons;
      const show = sym !== 'C' || charge !== 0 || nbrs[i].length === 0 || carbons === 'all' || (carbons === 'terminal' && nbrs[i].length === 1);
      const meanNx = nbrs[i].reduce((s, m) => s + pts[m][0], 0) / Math.max(1, nbrs[i].length);
      return {
        map: maps[i], sym, x: pts[i][0], y: pts[i][1], charge, hs: a.impHs ?? 0, show,
        hleft: nbrs[i].length > 0 && meanNx > pts[i][0] + 1e-6, lp: 0,
      };
    });

    atoms.forEach((a, i) => {
      const want = o.lp === 'auto' ? (a.sym !== 'C' && a.sym !== 'H' ? null : undefined) : o.lp?.[a.map];
      if (want === undefined) return;
      a.lp = want !== null ? want : valenceLp({ atoms, bonds, bond: bondLen }, i);
    });

    // Double-bond offset side: toward the side holding more neighbours (ring interiors).
    for (const b of bonds) {
      if (b.order !== 2) continue;
      const [x1, y1] = pts[b.a], [x2, y2] = pts[b.b];
      const nx = -(y2 - y1), ny = x2 - x1;
      let score = 0;
      for (const end of [b.a, b.b]) for (const m of nbrs[end]) {
        if (m === b.a || m === b.b) continue;
        score += Math.sign((pts[m][0] - x1) * nx + (pts[m][1] - y1) * ny);
      }
      const bothLabelled = atoms[b.a].show && atoms[b.b].show;
      b.side = bothLabelled || nbrs[b.a].length === 1 || nbrs[b.b].length === 1 ? 0 : Math.sign(score);
    }
    return { atoms, bonds, bond: bondLen };
  } finally {
    mol.delete();
  }
}

/** Lone pairs from valence: (valence e⁻ − charge − bonding e⁻) / 2. */
export function valenceLp(g: MolGeom, i: number): number {
  const a = g.atoms[i];
  const bondE = g.bonds.filter((b) => b.a === i || b.b === i).reduce((s, b) => s + b.order, 0) + a.hs;
  return Math.max(0, Math.floor(((VALENCE_E[a.sym] ?? 0) - a.charge - bondE) / 2));
}

/**
 * Evens out bond angles at acyclic branch points (90° for 4 substituents, 120° for 3)
 * by rotating each substituent's whole branch rigidly about the centre. RDKit's
 * raw layout often leaves sp3 centres lopsided, which reads badly on a slide.
 */
function regularize(pts: number[][], edges: [number, number][]) {
  const n = pts.length;
  const nbrs: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) { nbrs[a].push(b); nbrs[b].push(a); }
  // Atoms reachable from `start` without passing through `centre` (null if that loops back = ring).
  const branch = (centre: number, start: number): number[] | null => {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const v = stack.pop()!;
      for (const w of nbrs[v]) {
        if (w === centre) { if (v !== start) return null; continue; }
        if (!seen.has(w)) { seen.add(w); stack.push(w); }
      }
    }
    return [...seen];
  };
  for (let c = 0; c < n; c++) {
    const deg = nbrs[c].length;
    if (deg < 3 || deg > 4) continue;
    const branches = nbrs[c].map((m) => branch(c, m));
    if (branches.some((b) => b === null)) continue; // ring atom: leave the ring geometry alone
    const step = (2 * Math.PI) / deg;
    const ang = (i: number) => Math.atan2(pts[i][1] - pts[c][1], pts[i][0] - pts[c][0]);
    const order = nbrs[c].map((m, k) => ({ m, k, a: ang(m) })).sort((p, q) => p.a - q.a);
    // Best common offset (circular mean of angle − slot).
    let sx = 0, sy = 0;
    order.forEach((o, slot) => { sx += Math.cos(o.a - slot * step); sy += Math.sin(o.a - slot * step); });
    const off = Math.round(Math.atan2(sy, sx) / (Math.PI / 6)) * (Math.PI / 6); // stay on the 30° grid
    order.forEach((o, slot) => {
      const delta = off + slot * step - o.a;
      const cs = Math.cos(delta), sn = Math.sin(delta);
      for (const v of branches[o.k]!) {
        const dx = pts[v][0] - pts[c][0], dy = pts[v][1] - pts[c][1];
        pts[v] = [pts[c][0] + dx * cs - dy * sn, pts[c][1] + dx * sn + dy * cs];
      }
    });
  }
}

type Pt = { x: number; y: number };

/** Best rigid map (rotation, optional reflection, translation) taking `src` points onto `dst`. */
function kabsch(src: Pt[], dst: Pt[], centre?: [number, number]): (x: number, y: number) => [number, number] {
  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const px = mean(src.map((a) => a.x)), py = mean(src.map((a) => a.y));
  const qx = mean(dst.map((b) => b.x)), qy = mean(dst.map((b) => b.y));
  const tx = centre ? centre[0] : qx, ty = centre ? centre[1] : qy;
  let best = { err: Infinity, f: (x: number, y: number): [number, number] => [x - px + tx, y - py + ty] };
  if (src.length < 2) return best.f;
  for (const flip of [false, true]) {
    let sxx = 0, sxy = 0;
    src.forEach((a, k) => {
      const ux = (flip ? -1 : 1) * (a.x - px), uy = a.y - py, vx = dst[k].x - qx, vy = dst[k].y - qy;
      sxx += ux * vx + uy * vy;
      sxy += ux * vy - uy * vx;
    });
    // Snap to RDKit's 30° bond grid so structures stay upright, then refit the translation.
    const th = Math.round(Math.atan2(sxy, sxx) / (Math.PI / 6)) * (Math.PI / 6), c = Math.cos(th), s = Math.sin(th);
    const rot = (x: number, y: number): [number, number] => {
      const ux = (flip ? -1 : 1) * (x - px), uy = y - py;
      return [ux * c - uy * s, ux * s + uy * c];
    };
    let ox = 0, oy = 0;
    if (!centre) {
      src.forEach((a, k) => { const [x, y] = rot(a.x, a.y); ox += dst[k].x - qx - x; oy += dst[k].y - qy - y; });
      ox /= src.length; oy /= src.length;
    }
    const f = (x: number, y: number): [number, number] => { const [rx, ry] = rot(x, y); return [rx + tx + ox, ry + ty + oy]; };
    let err = 0;
    src.forEach((a, k) => { const [x, y] = f(a.x, a.y); err += (x - dst[k].x) ** 2 + (y - dst[k].y) ** 2; });
    if (err < best.err - 1e-9) best = { err, f };
  }
  return best.f;
}

/** Connected components (atom index lists). */
function components(g: MolGeom): number[][] {
  const parent = g.atoms.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const b of g.bonds) parent[find(b.a)] = find(b.b);
  const groups = new Map<number, number[]>();
  g.atoms.forEach((_, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), i]); });
  return [...groups.values()];
}

/**
 * Moves `g` so atoms sharing map numbers with `ref` land near their old places.
 * Each fragment is aligned on its own (a leaving group stays where it was), then
 * overlapping fragments are nudged apart. With `keepCentre`, the whole product is
 * rotated as one body and centred there instead.
 */
export function alignTo(g: MolGeom, ref: Atom[], keepCentre?: [number, number]): MolGeom {
  const refBy = new Map(ref.filter((a) => a.map).map((a) => [a.map, a]));
  const atoms = g.atoms.map((a) => ({ ...a }));
  const groups = keepCentre ? [atoms.map((_, i) => i)] : components(g);
  for (const idx of groups) {
    const pairs = idx.filter((i) => atoms[i].map && refBy.has(atoms[i].map));
    if (!pairs.length) continue;
    const f = kabsch(pairs.map((i) => g.atoms[i]), pairs.map((i) => refBy.get(g.atoms[i].map)!), keepCentre);
    for (const i of idx) { const [x, y] = f(g.atoms[i].x, g.atoms[i].y); atoms[i].x = x; atoms[i].y = y; }
  }
  // Push apart fragments that ended up overlapping (e.g. a leaving ion).
  if (groups.length > 1) {
    const sorted = [...groups].sort((p, q) => q.length - p.length);
    for (let j = 1; j < sorted.length; j++) {
      for (let iter = 0; iter < 40; iter++) {
        let worst = Infinity, from: Atom | null = null, to: Atom | null = null;
        for (let k = 0; k < j; k++) for (const a of sorted[k]) for (const b of sorted[j]) {
          const d = Math.hypot(atoms[a].x - atoms[b].x, atoms[a].y - atoms[b].y);
          if (d < worst) { worst = d; from = atoms[a]; to = atoms[b]; }
        }
        if (worst >= g.bond * 1.3 || !from || !to) break;
        let dx = to.x - from.x, dy = to.y - from.y;
        const L = Math.hypot(dx, dy) || 1;
        if (L < 1e-6) { dx = 1; dy = 0; }
        for (const b of sorted[j]) { atoms[b].x += (dx / L) * g.bond * 0.15; atoms[b].y += (dy / L) * g.bond * 0.15; }
      }
    }
  }
  return rederive({ ...g, atoms });
}

/** Recomputes H-label side and double-bond offsets after atoms moved. */
function rederive(g: MolGeom): MolGeom {
  const { atoms, bonds } = g;
  const nbrs: number[][] = atoms.map(() => []);
  for (const b of bonds) { nbrs[b.a].push(b.b); nbrs[b.b].push(b.a); }
  atoms.forEach((a, i) => {
    if (nbrs[i].length) a.hleft = nbrs[i].reduce((s, m) => s + atoms[m].x, 0) / nbrs[i].length > a.x + 1e-6;
  });
  for (const b of bonds) {
    if (b.side === 0) continue;
    const p = atoms[b.a], q = atoms[b.b];
    const nx = -(q.y - p.y), ny = q.x - p.x;
    let score = 0;
    for (const end of [b.a, b.b]) for (const m of nbrs[end]) {
      if (m === b.a || m === b.b) continue;
      score += Math.sign((atoms[m].x - p.x) * nx + (atoms[m].y - p.y) * ny);
    }
    b.side = Math.sign(score) || b.side;
  }
  return g;
}

// ---------------------------------------------------------------------------
// Mechanism-aware orientation. Textbooks draw the attacked atom with its open
// side facing the nucleophile and a leaving group anti to it (SN2), and the
// nucleophile with its lone pairs facing the target. These helpers pick a
// rotation (on the 30° grid, so stereo wedges stay valid) that does that.

const angDiff = (a: number, b: number) => { let d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };

/** Rotates `g` rigidly by `th` radians about `c`, in place. */
export function rotateMol(g: MolGeom, th: number, c: [number, number]): MolGeom {
  const cs = Math.cos(th), sn = Math.sin(th);
  for (const a of g.atoms) {
    const dx = a.x - c[0], dy = a.y - c[1];
    a.x = c[0] + dx * cs - dy * sn; a.y = c[1] + dx * sn + dy * cs;
  }
  return rederive(g);
}

export function translateMol(g: MolGeom, dx: number, dy: number): MolGeom {
  for (const a of g.atoms) { a.x += dx; a.y += dy; }
  return g;
}

export function molCentre(g: MolGeom): [number, number] {
  const xs = g.atoms.map((a) => a.x), ys = g.atoms.map((a) => a.y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/**
 * Best rotation (multiple of 30°) so atom `i` of `g` opens toward `target`.
 * With `anti` (index of a leaving atom bonded to i), the i→anti bond is instead
 * pointed straight away from the target. Returns radians (0 if no real gain).
 */
export function bestFacing(g: MolGeom, i: number, target: [number, number], anti?: number): number {
  const c = molCentre(g);
  const nb = g.bonds.filter((b) => b.a === i || b.b === i).map((b) => (b.a === i ? b.b : b.a));
  if (!nb.length) return 0;
  const score = (th: number) => {
    const cs = Math.cos(th), sn = Math.sin(th);
    const rot = (a: Atom): [number, number] => [c[0] + (a.x - c[0]) * cs - (a.y - c[1]) * sn, c[1] + (a.x - c[0]) * sn + (a.y - c[1]) * cs];
    const [x, y] = rot(g.atoms[i]);
    const d = Math.atan2(target[1] - y, target[0] - x);
    if (anti !== undefined) { const [ax, ay] = rot(g.atoms[anti]); return angDiff(Math.atan2(ay - y, ax - x), d); }
    return Math.min(...nb.map((m) => { const [mx, my] = rot(g.atoms[m]); return angDiff(Math.atan2(my - y, mx - x), d); }));
  };
  const base = score(0);
  let best = 0, bestS = base;
  for (let k = 1; k < 12; k++) {
    const th = (k > 6 ? k - 12 : k) * (Math.PI / 6);
    const s = score(th) - Math.abs(th) * 0.01; // prefer the smallest turn among equals
    if (s > bestS + 1e-6) { best = th; bestS = s; }
  }
  return bestS - base > (15 * Math.PI) / 180 ? best : 0;
}

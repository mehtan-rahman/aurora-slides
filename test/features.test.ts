import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../src/deck.ts';
import { initChem, layout, alignTo } from '../src/chem.ts';
import { latexAvailable } from '../src/latexsvg.ts';
import { COMMANDS } from '../src/schema.ts';
import { renderReference } from '../src/reference.ts';

const deck = (body: string, pre = '') => parseDeck(`\\documentclass{beamer}${pre}\\begin{document}${body}\\end{document}`, '.');
const scene = (inner: string) => deck(`\\begin{frame}\\begin{scene}${inner}\\end{scene}\\end{frame}`);

before(async () => { await initChem(); });

test('molecule layout keeps atom maps, charges and implicit H', () => {
  const g = layout('[CH3:1][C:2](=[O:3])[O-:4]');
  assert.deepEqual(g.atoms.map((a) => a.map), [1, 2, 3, 4]);
  assert.equal(g.atoms[3].charge, -1);
  assert.equal(g.atoms[0].hs, 3);
  assert.equal(g.bonds.find((b) => b.order === 2)!.b, 2);
});

test('lone pairs from valence', () => {
  const g = layout('[OH-:1]', { lp: 'auto' });
  assert.equal(g.atoms[0].lp, 3);
  const w = layout('[OH2:1]', { lp: 'auto' });
  assert.equal(w.atoms[0].lp, 2);
});

test('alignTo keeps persisting atoms in place and separates fragments', () => {
  const r = layout('[CH3:1][C:2](=[O:3])[Cl:4]', { at: [1, 0] });
  const p = alignTo(layout('[CH3:1][C:2](=[O:3])[OH:5].[Cl-:4]'), r.atoms);
  const at = (g: typeof r, m: number) => g.atoms.find((a) => a.map === m)!;
  assert.ok(Math.hypot(at(p, 2).x - at(r, 2).x, at(p, 2).y - at(r, 2).y) < 0.3);
  const cl = at(p, 4), c = at(p, 2);
  assert.ok(Math.hypot(cl.x - c.x, cl.y - c.y) > r.bond * 1.2, 'leaving chloride is pushed clear');
});

test('Transform creates a hidden target and aliases the id', () => {
  const d = scene(`\\Molecule[id=a]{[CH3:1][Br:2]}\\Molecule[id=b, with]{[OH-:3]}\\pause
    \\CurlyArrow[from=lp:3, to=1]\\pause
    \\Transform[id={a,b}]{[CH3:1][OH:3].[Br-:2]}\\pause\\Indicate[id=a]`);
  const sc = d.scenes[0];
  const tr = sc.events.find((e) => e.type === 'transform')!;
  assert.deepEqual(tr.sources, ['a', 'b']);
  const target = sc.objects.find((o) => o.id === tr.target)!;
  assert.equal(target.hidden, true);
  assert.equal(sc.events.find((e) => e.type === 'indicate')!.target, tr.target);
  assert.equal(sc.objects.find((o) => o.kind === 'CurlyArrow')!.props.mols, 'a,b');
});

test('unknown keys and commands get suggestions', () => {
  const d = scene('\\Dot[colr=blue]\\Plott{x}');
  const msgs = d.warnings.map((w) => w.message).join('\n');
  assert.match(msgs, /unknown key "colr" \(did you mean "color"\?\)/);
  assert.match(msgs, /unknown command \\Plott \(did you mean \\Plot\?\)/);
});

test('warnings carry line numbers', () => {
  const src = '\\documentclass{beamer}\n\\begin{document}\n% a comment\n\\begin{frame}{x}\n\\begin{scene}\\Dot[colr=1]\\end{scene}\n\\end{frame}\n\\end{document}';
  const d = parseDeck(src, '.');
  assert.equal(d.warnings[0].line, 4);
  assert.equal(d.warnings[0].slide, 1);
});

test('TransformTex retargets the MathTex id', () => {
  const d = scene('\\MathTex[id=eq]{a+b}\\pause\\TransformTex[id=eq]{b+a}\\pause\\FadeOut[id=eq]');
  const ev = d.scenes[0].events;
  const tt = ev.find((e) => e.type === 'transformtex')!;
  assert.equal(ev.find((e) => e.type === 'fadeout')!.target, tt.target);
});

test('ReactionArrow expands to an arrow with TeX labels', () => {
  const d = scene('\\ReactionArrow[from={-1,0}, to={1,0}, above={\\ce{H2O}}]');
  const kinds = d.scenes[0].objects.map((o) => o.kind);
  assert.deepEqual(kinds, ['Arrow', 'MathTex']);
});

test('tables, with \\pause between rows', () => {
  const d = deck('\\begin{frame}\\begin{tabular}{lr}\\toprule A & B \\\\ \\midrule 1 & 2 \\\\ \\pause 3 & $x$ \\\\ \\bottomrule\\end{tabular}\\end{frame}');
  const h = d.slides[0].html;
  assert.equal((h.match(/<tr/g) ?? []).length, 3);
  assert.match(h, /text-align:right/);
  assert.equal(d.slides[0].steps, 2);
});

test('code listings are escaped verbatim', () => {
  const d = deck('\\begin{frame}[fragile]\\begin{lstlisting}\nif a < b: print("$x")\n\\end{lstlisting}\\end{frame}');
  assert.match(d.slides[0].html, /<pre class="code"[^>]*>if a &lt; b: print\(&quot;\$x&quot;\)<\/pre>/);
});

test('every schema command has an example that parses cleanly', () => {
  for (const [name, spec] of Object.entries(COMMANDS)) {
    if (name === 'Molecule' || name === 'CurlyArrow') continue; // need atom context
    const d = scene(`\\Axes[id=ax]\\ValueTracker[id=t]${spec.example}`);
    const bad = d.warnings.filter((w) => !/no object with id|duplicate id/.test(w.message));
    assert.deepEqual(bad, [], `${name}: ${bad.map((w) => w.message).join('; ')}`);
  }
});

test('reference renders in all formats', () => {
  assert.ok(JSON.parse(renderReference('json')).objects.Plot);
  assert.match(renderReference('md'), /### `\\Molecule`/);
  assert.match(renderReference('text'), /\\Axes/);
});

test('TikZ fragments compile to SVG with overlay layers', { skip: !latexAvailable() && 'latex/dvisvgm not installed' }, () => {
  const d = deck('\\begin{frame}\\begin{tikzpicture}\\draw (0,0)--(1,1);\\draw<2-> (0,1)--(1,0);\\end{tikzpicture}\\end{frame}', '\\usepackage{tikz}');
  const h = d.slides[0].html;
  assert.equal((h.match(/class="latex-fig layer"/g) ?? []).length, 2);
  assert.match(h, /<svg/);
  assert.equal(d.slides[0].steps, 2);
});

test('light theme and stereo wedges', () => {
  const d = deck('\\begin{frame}x\\end{frame}', '\\auroratheme{light}');
  assert.equal(d.meta.theme, 'light');
  const g = layout('C[C@H](O)CC');
  assert.equal(g.bonds.filter((b) => b.stereo).length, 1);
});

test('reactants auto-orient to their curly arrows (SN2: leaving group anti)', () => {
  const d = deck(`\\begin{frame}\\begin{scene}
    \\Molecule[id=nu, at={-5,0.5}, lp=auto]{[OH-:6]}
    \\Molecule[id=s, at={1,0}, lp={5}]{[CH3:2][C@@H:1]([CH2:3][CH3:4])[Br:5]}
    \\pause
    \\CurlyArrow[from=lp:6, to=1]
    \\CurlyArrow[from=1-5, to=5, with]
    \\pause
    \\Transform[id={nu,s}]{[OH:6][C@H:1]([CH3:2])[CH2:3][CH3:4].[Br-:5]}
  \\end{scene}\\end{frame}`);
  const objs = d.scenes[0].objects;
  const s = objs.find((o) => o.id === 's')!.mol!, nu = objs.find((o) => o.id === 'nu')!.mol!;
  const at = (g: typeof s, m: number) => g.atoms.find((a) => a.map === m)!;
  const C = at(s, 1), Br = at(s, 5), O = at(nu, 6);
  const cBr = Math.atan2(Br.y - C.y, Br.x - C.x), cO = Math.atan2(O.y - C.y, O.x - C.x);
  assert.ok(Math.abs(Math.abs(cBr - cO) - Math.PI) < 0.3, 'C–Br points away from the nucleophile');
  assert.ok(Math.abs(O.y - C.y) < 1e-6, 'small nucleophile levelled with its target');
  assert.equal(O.hleft, true, 'HO⁻ written with H away from the target');
  // Lone pairs carry over a Transform: O6 had them, so the product still shows them (recounted).
  const p = objs.find((o) => o.id.startsWith('nu~') || o.id.startsWith('s~'))!.mol!;
  assert.equal(at(p, 6).lp, 2);
  assert.equal(at(p, 5).lp, 4);
});

test('rotate= turns auto-orientation off', () => {
  const src = (k: string) => `\\begin{frame}\\begin{scene}
    \\Molecule[id=nu, at={-5,0}, lp=auto]{[OH-:6]}
    \\Molecule[id=s, at={1,0}${k}]{[CH3:2][CH2:1][Br:5]}
    \\CurlyArrow[from=lp:6, to=1]\\CurlyArrow[from=1-5, to=5]
  \\end{scene}\\end{frame}`;
  const br = (k: string) => deck(src(k)).scenes[0].objects.find((o) => o.id === 's')!.mol!.atoms.find((a) => a.map === 5)!;
  assert.notDeepEqual([br('').x, br('').y], [br(', rotate=0').x, br(', rotate=0').y]);
});

test('Transform flow=false opts out of the electron-flow phase', () => {
  const src = (k: string) => `\\begin{frame}\\begin{scene}
    \\Molecule[id=nu, at={-5,0}, lp=auto]{[OH-:1]}\\Molecule[id=s, at={1,0}, lp={4}]{[CH3:2][Br:4]}
    \\pause\\CurlyArrow[from=lp:1, to=2]\\CurlyArrow[from=2-4, to=4]
    \\pause\\Transform[id={nu,s}${k}]{[OH:1][CH3:2].[Br-:4]}
  \\end{scene}\\end{frame}`;
  const ev = (k: string) => deck(src(k)).scenes[0].events.find((e) => e.type === 'transform')!;
  assert.equal(ev('').flow, undefined);
  assert.equal(ev(', flow=false').flow, false);
  assert.equal(deck(src(', flow=false')).warnings.length, 0);
});

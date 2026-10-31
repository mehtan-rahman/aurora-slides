// Single source of truth for scene commands: drives validation, `aurora reference`,
// and the generated docs/REFERENCE.md. Keep descriptions short and concrete.

export interface KeySpec { type: string; desc: string; default?: string }
export interface CommandSpec {
  summary: string;
  content?: string;          // meaning of the trailing {…} argument, if any
  intro?: string;            // default intro animation
  keys: Record<string, KeySpec>;
  example: string;
}

const vec = 'vector "x,y"';
const num = 'number | expression';
const color = 'colour name | #hex';

/** Accepted by every object command. */
export const COMMON_KEYS: Record<string, KeySpec> = {
  id: { type: 'identifier', desc: 'Name used by \\Animate, \\FadeOut, \\Indicate, \\Transform, on=…' },
  anim: { type: 'create | write | fade | fadein | grow | growup | none', desc: 'Override the intro animation' },
  run: { type: 'seconds', desc: 'Duration of the intro / action' },
  delay: { type: 'seconds', desc: 'Extra wait before starting' },
  with: { type: 'flag', desc: 'Start together with the previous event instead of after it' },
};

const at = { type: `${vec} | @atom-ref`, desc: 'Position (scene units, origin at centre, y up). @3 = atom map 3', default: '0,0' };
const on = { type: 'axes id', desc: 'Interpret coordinates in this Axes’ data coordinates' };

export const COMMANDS: Record<string, CommandSpec> = {
  Axes: {
    summary: 'A pair of axes with ticks; other objects can plot onto it with on=<id>.',
    intro: 'create',
    keys: {
      at, w: { type: num, desc: 'Width in scene units', default: '6' }, h: { type: num, desc: 'Height in scene units', default: '4' },
      x: { type: 'min,max,step', desc: 'x range and tick step (0 = no ticks)', default: '0,10,1' },
      y: { type: 'min,max,step', desc: 'y range and tick step', default: '-1,1,1' },
      only: { type: 'x | y', desc: 'Draw just one axis' },
      color: { type: color, desc: 'Axis colour', default: 'axis grey' }, width: { type: 'px', desc: 'Stroke width', default: '3' },
    },
    example: '\\Axes[id=ax, at={0,0}, w=8, h=4, x={0,10,1}, y={-1,1,0.5}]',
  },
  Plot: {
    summary: 'Graph of y = f(x). The expression is JavaScript-flavoured maths over x and any ValueTracker.',
    content: 'expression in x, e.g. 0.5*sin(3*x) + noise(4*x, 1)',
    intro: 'create',
    keys: {
      on, domain: { type: 'a,b', desc: 'x interval', default: 'axes x range' },
      samples: { type: 'integer', desc: 'Sample count', default: '400' },
      color: { type: color, desc: 'Line colour', default: 'blue' }, width: { type: 'px', desc: 'Stroke width', default: '5' },
      fill: { type: 'opacity | flag', desc: 'Shade the area down to y=0' },
    },
    example: '\\Plot[on=ax, color=orange]{exp(-(x-5)^2/2)}',
  },
  Line: {
    summary: 'Straight segment.', intro: 'create',
    keys: { from: { type: vec, desc: 'Start' }, to: { type: vec, desc: 'End' }, on, color: { type: color, desc: 'Colour' }, width: { type: 'px', desc: 'Stroke width', default: '4' }, dashed: { type: 'flag', desc: 'Dashed line' } },
    example: '\\Line[from={-3,0}, to={3,0}, dashed]',
  },
  Arrow: {
    summary: 'Straight arrow with a filled tip.', intro: 'create',
    keys: { from: { type: vec, desc: 'Tail' }, to: { type: vec, desc: 'Head' }, on, color: { type: color, desc: 'Colour', default: 'axis grey' }, width: { type: 'px', desc: 'Shaft width', default: '6' }, tip: { type: 'units', desc: 'Tip length', default: '0.36' }, dashed: { type: 'flag', desc: 'Dashed shaft' } },
    example: '\\Arrow[from={-1.5,0}, to={1.5,0}]',
  },
  Dot: {
    summary: 'Filled dot.', intro: 'grow',
    keys: { at, on, r: { type: num, desc: 'Radius (units)', default: '0.1' }, color: { type: color, desc: 'Colour', default: 'fg' }, glow: { type: 'flag', desc: 'Soft glow' } },
    example: '\\Dot[at={10*t-5, 0}, glow]',
  },
  Circle: {
    summary: 'Circle outline (optionally filled).', intro: 'create',
    keys: { at, on, r: { type: num, desc: 'Radius', default: '1' }, color: { type: color, desc: 'Stroke colour' }, width: { type: 'px', desc: 'Stroke width', default: '4' }, fill: { type: 'opacity | flag', desc: 'Fill opacity' } },
    example: '\\Circle[at={0,0}, r=2, color=blue]',
  },
  Rect: {
    summary: 'Rectangle centred on at.', intro: 'create',
    keys: { at, on, w: { type: num, desc: 'Width', default: '2' }, h: { type: num, desc: 'Height', default: '1' }, round: { type: 'units', desc: 'Corner radius' }, color: { type: color, desc: 'Stroke colour' }, width: { type: 'px', desc: 'Stroke width (0 = none)', default: '4' }, fill: { type: 'opacity | flag', desc: 'Fill opacity' } },
    example: '\\Rect[at={0,1}, w=4, h=0.3, color=blue, fill=1, width=0]',
  },
  Band: {
    summary: 'Translucent region: on axes spans a y- or x-interval; otherwise a rectangle.', intro: 'fade',
    keys: { on, x: { type: 'a,b', desc: 'x interval (data coords)' }, y: { type: 'a,b', desc: 'y interval (data coords)' }, at, w: { type: num, desc: 'Width when not on axes' }, h: { type: num, desc: 'Height when not on axes' }, color: { type: color, desc: 'Fill colour', default: 'blue' }, opacity: { type: 'number', desc: 'Fill opacity', default: '0.2' } },
    example: '\\Band[on=ax, y={0.6,1}, color=blue]',
  },
  Bars: {
    summary: 'Histogram / bar chart on an Axes; bars grow from the baseline.', intro: 'growup',
    keys: { on: { ...on, desc: 'Axes id (required)' }, values: { type: 'list', desc: 'Bar heights in data units' }, width: { type: '0–1', desc: 'Bar width as a fraction of the bin', default: '0.8' }, color: { type: color, desc: 'Fill colour', default: 'teal' }, opacity: { type: 'number', desc: 'Fill opacity', default: '1' } },
    example: '\\Bars[on=ax, values={0.1,0.4,1,0.4,0.1}]',
  },
  MathTex: {
    summary: 'TeX maths (MathJax, incl. mhchem \\ce{}), animated with manim’s Write.', content: 'TeX (no $ needed)', intro: 'write',
    keys: { at, on, size: { type: 'px', desc: 'Font size', default: '44' }, color: { type: color, desc: 'Colour', default: 'fg' }, anchor: { type: 'left | center | right', desc: 'Horizontal anchor', default: 'center' }, offset: { type: vec, desc: 'Shift added to at (handy with @atom refs)' } },
    example: '\\MathTex[at={0,2}, color=blue]{q(x) = \\Pr[\\tau_B < \\tau_A]}',
  },
  Text: {
    summary: 'Plain text label (use MathTex for maths).', content: 'text; _2 and ^+ become sub/superscripts', intro: 'fadein',
    keys: { at, on, size: { type: 'px', desc: 'Font size', default: '28' }, color: { type: color, desc: 'Colour', default: 'fg' }, anchor: { type: 'left | center | right', desc: 'Horizontal anchor', default: 'center' }, bold: { type: 'flag', desc: 'Bold' }, offset: { type: vec, desc: 'Shift added to at' } },
    example: '\\Text[at={0,-2}, color=muted, size=22]{launch position}',
  },
  ValueTracker: {
    summary: 'A named number that expressions can reference; animate it with \\Animate.',
    keys: { value: { type: 'number', desc: 'Initial value', default: '0' } },
    example: '\\ValueTracker[id=t, value=0]',
  },
  DecimalNumber: {
    summary: 'Live number typeset in TeX digits; re-evaluates while trackers animate.', intro: 'fade',
    keys: { at, on, value: { type: num, desc: 'Expression to display' }, digits: { type: 'integer', desc: 'Decimal places', default: '2' }, size: { type: 'px', desc: 'Font size', default: '60' }, color: { type: color, desc: 'Colour', default: 'orange' }, anchor: { type: 'left | center | right', desc: 'Anchor', default: 'left' } },
    example: '\\DecimalNumber[at={1,2}, value={sigmoid(10*(t-0.5))}]',
  },
  Molecule: {
    summary: 'Skeletal structure from SMILES. Use atom maps ([C:2]) to address atoms in curly arrows and transforms.', content: 'SMILES, e.g. [CH3:1][C:2](=[O:3])[Cl:4]', intro: 'create',
    keys: {
      at: { type: vec, desc: 'Centre', default: '0,0' }, bond: { type: 'units', desc: 'Bond length', default: '1.45' },
      rotate: { type: 'degrees', desc: 'Rotate the layout (turns off auto-orientation)' }, flip: { type: 'flag', desc: 'Mirror horizontally' },
      orient: { type: 'auto | false', desc: 'Auto-turn reactants to face their curly arrows (nucleophile toward target, leaving group anti)', default: 'auto' },
      carbons: { type: 'auto | none | terminal | all', desc: 'Which carbons get a C label (auto: all of them in molecules with ≤ 3 heavy atoms)', default: 'auto' },
      lp: { type: 'auto | map list | map:count list', desc: 'Lone pairs to draw: auto = all heteroatoms; {3,5}; {3:2}' },
      color: { type: color, desc: 'Bond / label colour', default: 'fg' }, size: { type: 'px', desc: 'Atom label size', default: '0.36 × bond' },
    },
    example: '\\Molecule[id=r, at={-2,0}, lp={3}]{[CH3:1][C:2](=[O:3])[Cl:4]}',
  },
  CurlyArrow: {
    summary: 'Electron-pushing arrow between atom refs: N (atom), N-M (bond / new-bond midpoint), lp:N (lone pair).', intro: 'create',
    keys: { from: { type: 'atom ref', desc: 'Electron source: lp:5, 2=3 (π bond), 2-4 (σ bond)' }, to: { type: 'atom ref', desc: 'Electron sink: 3 (atom), 5-2 (forming bond)' }, bend: { type: 'number', desc: 'Curvature; sign flips side', default: '1 (away from molecule)' }, fishhook: { type: 'flag', desc: 'Single-electron half-head' }, color: { type: color, desc: 'Colour', default: 'orange' }, width: { type: 'px', desc: 'Stroke width', default: '3.5' } },
    example: '\\CurlyArrow[from=lp:5, to=2]',
  },
  ReactionArrow: {
    summary: 'Reaction arrow with optional TeX conditions above/below.', intro: 'create',
    keys: { from: { type: vec, desc: 'Tail' }, to: { type: vec, desc: 'Head' }, above: { type: 'TeX', desc: 'Label above (\\ce{} works)' }, below: { type: 'TeX', desc: 'Label below' }, color: { type: color, desc: 'Colour', default: 'fg' } },
    example: '\\ReactionArrow[from={-1,0}, to={1,0}, above={\\ce{H2O}}, below={\\Delta}]',
  },
};

export const ACTION_SPECS: Record<string, CommandSpec> = {
  Animate: { summary: 'Tween ValueTrackers to new values; everything bound to them redraws.', keys: { run: COMMON_KEYS.run, '<tracker>': { type: num, desc: 'Target value for that tracker' } }, example: '\\Animate[t=1, run=2]' },
  Transform: {
    summary: 'Morph molecule(s) into a new SMILES. With curly arrows drawn, electron pairs first travel along them (bonds shrink, lone pairs and new bonds form where they land), then atoms relax into the product.',
    content: 'product SMILES (same atom maps)',
    keys: { id: { type: 'id | {id,id}', desc: 'Source molecule(s)' }, as: { type: 'identifier', desc: 'Name of the result (default: first source id)' }, at: { type: vec, desc: 'Centre of the product (default: aligned to sources)' }, lp: COMMANDS.Molecule.keys.lp, carbons: COMMANDS.Molecule.keys.carbons, flow: { type: 'auto | false', desc: 'Animate the electrons along the curly arrows first (arrow pushing), then relax into the product', default: 'auto' }, run: COMMON_KEYS.run },
    example: '\\Transform[id={r,nu}]{[CH3:1][C:2]([O-:3])([Cl:4])[OH:5]}',
  },
  TransformTex: {
    summary: 'Morph a MathTex into new TeX, matching identical glyphs (manim TransformMatchingTex).',
    content: 'new TeX',
    keys: { id: { type: 'id', desc: 'MathTex to transform' }, run: COMMON_KEYS.run },
    example: '\\TransformTex[id=eq]{x^2 + 2x + 1 = (x+1)^2}',
  },
  FadeOut: { summary: 'Fade out one object (id=…) or, without id, everything visible.', keys: { id: COMMON_KEYS.id, run: COMMON_KEYS.run }, example: '\\FadeOut[id=ax]' },
  Indicate: { summary: 'Briefly scale up and glow an object.', keys: { id: COMMON_KEYS.id, run: COMMON_KEYS.run }, example: '\\Indicate[id=d]' },
  Wait: { summary: 'Pause the step timeline.', keys: { run: COMMON_KEYS.run }, example: '\\Wait[run=0.5]' },
};

/** Levenshtein distance ≤ 2 suggestion. */
export function suggest(word: string, options: string[]): string | null {
  let best: string | null = null, bestD = 3;
  for (const o of options) {
    const d = lev(word.toLowerCase(), o.toLowerCase());
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

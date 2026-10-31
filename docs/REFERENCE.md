# Scene command reference

> Generated from `src/schema.ts` by `aurora reference --md`. Do not edit by hand.

Scene commands go inside `\begin{scene}[size={W,H}] … \end{scene}` in a frame. Coordinates are in scene units (1 unit = 100 px on the 1920×1080 stage), origin at the centre, y pointing up. `\pause` inside a scene starts a new click step and is shared with the rest of the frame.

## Objects

### `\Axes`

A pair of axes with ticks; other objects can plot onto it with on=<id>. Default intro: **create**.

```latex
\Axes[id=ax, at={0,0}, w=8, h=4, x={0,10,1}, y={-1,1,0.5}]
```

| key | type | default | description |
|---|---|---|---|
| `at` | vector "x,y" \| @atom-ref | 0,0 | Position (scene units, origin at centre, y up). @3 = atom map 3 |
| `w` | number \| expression | 6 | Width in scene units |
| `h` | number \| expression | 4 | Height in scene units |
| `x` | min,max,step | 0,10,1 | x range and tick step (0 = no ticks) |
| `y` | min,max,step | -1,1,1 | y range and tick step |
| `only` | x \| y |  | Draw just one axis |
| `color` | colour name \| #hex | axis grey | Axis colour |
| `width` | px | 3 | Stroke width |

### `\Plot`

Graph of y = f(x). The expression is JavaScript-flavoured maths over x and any ValueTracker. Default intro: **create**.

```latex
\Plot[on=ax, color=orange]{exp(-(x-5)^2/2)}
```

Content `{…}`: expression in x, e.g. 0.5*sin(3*x) + noise(4*x, 1)

| key | type | default | description |
|---|---|---|---|
| `on` | axes id |  | Interpret coordinates in this Axes’ data coordinates |
| `domain` | a,b | axes x range | x interval |
| `samples` | integer | 400 | Sample count |
| `color` | colour name \| #hex | blue | Line colour |
| `width` | px | 5 | Stroke width |
| `fill` | opacity \| flag |  | Shade the area down to y=0 |

### `\Line`

Straight segment. Default intro: **create**.

```latex
\Line[from={-3,0}, to={3,0}, dashed]
```

| key | type | default | description |
|---|---|---|---|
| `from` | vector "x,y" |  | Start |
| `to` | vector "x,y" |  | End |
| `on` | axes id |  | Interpret coordinates in this Axes’ data coordinates |
| `color` | colour name \| #hex |  | Colour |
| `width` | px | 4 | Stroke width |
| `dashed` | flag |  | Dashed line |

### `\Arrow`

Straight arrow with a filled tip. Default intro: **create**.

```latex
\Arrow[from={-1.5,0}, to={1.5,0}]
```

| key | type | default | description |
|---|---|---|---|
| `from` | vector "x,y" |  | Tail |
| `to` | vector "x,y" |  | Head |
| `on` | axes id |  | Interpret coordinates in this Axes’ data coordinates |
| `color` | colour name \| #hex | axis grey | Colour |
| `width` | px | 6 | Shaft width |
| `tip` | units | 0.36 | Tip length |
| `dashed` | flag |  | Dashed shaft |

### `\Dot`

Filled dot. Default intro: **grow**.

```latex
\Dot[at={10*t-5, 0}, glow]
```

| key | type | default | description |
|---|---|---|---|
| `at` | vector "x,y" \| @atom-ref | 0,0 | Position (scene units, origin at centre, y up). @3 = atom map 3 |
| `on` | axes id |  | Interpret coordinates in this Axes’ data coordinates |
| `r` | number \| expression | 0.1 | Radius (units) |
| `color` | colour name \| #hex | fg | Colour |
| `glow` | flag |  | Soft glow |

### `\Circle`

Circle outline (optionally filled). Default intro: **create**.

```latex
\Circle[at={0,0}, r=2, color=blue]
```

| key | type | default | description |
|---|---|---|---|
| `at` | vector "x,y" \| @atom-ref | 0,0 | Position (scene units, origin at centre, y up). @3 = atom map 3 |
| `on` | axes id |  | Interpret coordinates in this Axes’ data coordinates |
| `r` | number \| expression | 1 | Radius |
| `color` | colour name \| #hex |  | Stroke colour |
| `width` | px | 4 | Stroke width |
| `fill` | opacity \| flag |  | Fill opacity |

### `\Rect`

Rectangle centred on at. Default intro: **create**.

```latex
\Rect[at={0,1}, w=4, h=0.3, color=blue, fill=1, width=0]
```

| key | type | default | description |
|---|---|---|---|
| `at` | vector "x,y" \| @atom-ref | 0,0 | Position (scene units, origin at centre, y up). @3 = atom map 3 |
| `on` | axes id |  | Interpret coordinates in this Axes’ data coordinates |
| `w` | number \| expression | 2 | Width |
| `h` | number \| expression | 1 | Height |
| `round` | units |  | Corner radius |
| `color` | colour name \| #hex |  | Stroke colour |
| `width` | px | 4 | Stroke width (0 = none) |
| `fill` | opacity \| flag |  | Fill opacity |

### `\Band`

Translucent region: on axes spans a y- or x-interval; otherwise a rectangle. Default intro: **fade**.

```latex
\Band[on=ax, y={0.6,1}, color=blue]
```

| key | type | default | description |
|---|---|---|---|
| `on` | axes id |  | Interpret coordinates in this Axes’ data coordinates |
| `x` | a,b |  | x interval (data coords) |
| `y` | a,b |  | y interval (data coords) |
| `at` | vector "x,y" \| @atom-ref | 0,0 | Position (scene units, origin at centre, y up). @3 = atom map 3 |
| `w` | number \| expression |  | Width when not on axes |
| `h` | number \| expression |  | Height when not on axes |
| `color` | colour name \| #hex | blue | Fill colour |
| `opacity` | number | 0.2 | Fill opacity |

### `\Bars`

Histogram / bar chart on an Axes; bars grow from the baseline. Default intro: **growup**.

```latex
\Bars[on=ax, values={0.1,0.4,1,0.4,0.1}]
```

| key | type | default | description |
|---|---|---|---|
| `on` | axes id |  | Axes id (required) |
| `values` | list |  | Bar heights in data units |
| `width` | 0–1 | 0.8 | Bar width as a fraction of the bin |
| `color` | colour name \| #hex | teal | Fill colour |
| `opacity` | number | 1 | Fill opacity |

### `\MathTex`

TeX maths (MathJax, incl. mhchem \ce{}), animated with manim’s Write. Default intro: **write**.

```latex
\MathTex[at={0,2}, color=blue]{q(x) = \Pr[\tau_B < \tau_A]}
```

Content `{…}`: TeX (no $ needed)

| key | type | default | description |
|---|---|---|---|
| `at` | vector "x,y" \| @atom-ref | 0,0 | Position (scene units, origin at centre, y up). @3 = atom map 3 |
| `on` | axes id |  | Interpret coordinates in this Axes’ data coordinates |
| `size` | px | 44 | Font size |
| `color` | colour name \| #hex | fg | Colour |
| `anchor` | left \| center \| right | center | Horizontal anchor |
| `offset` | vector "x,y" |  | Shift added to at (handy with @atom refs) |

### `\Text`

Plain text label (use MathTex for maths). Default intro: **fadein**.

```latex
\Text[at={0,-2}, color=muted, size=22]{launch position}
```

Content `{…}`: text; _2 and ^+ become sub/superscripts

| key | type | default | description |
|---|---|---|---|
| `at` | vector "x,y" \| @atom-ref | 0,0 | Position (scene units, origin at centre, y up). @3 = atom map 3 |
| `on` | axes id |  | Interpret coordinates in this Axes’ data coordinates |
| `size` | px | 28 | Font size |
| `color` | colour name \| #hex | fg | Colour |
| `anchor` | left \| center \| right | center | Horizontal anchor |
| `bold` | flag |  | Bold |
| `offset` | vector "x,y" |  | Shift added to at |

### `\ValueTracker`

A named number that expressions can reference; animate it with \Animate.

```latex
\ValueTracker[id=t, value=0]
```

| key | type | default | description |
|---|---|---|---|
| `value` | number | 0 | Initial value |

### `\DecimalNumber`

Live number typeset in TeX digits; re-evaluates while trackers animate. Default intro: **fade**.

```latex
\DecimalNumber[at={1,2}, value={sigmoid(10*(t-0.5))}]
```

| key | type | default | description |
|---|---|---|---|
| `at` | vector "x,y" \| @atom-ref | 0,0 | Position (scene units, origin at centre, y up). @3 = atom map 3 |
| `on` | axes id |  | Interpret coordinates in this Axes’ data coordinates |
| `value` | number \| expression |  | Expression to display |
| `digits` | integer | 2 | Decimal places |
| `size` | px | 60 | Font size |
| `color` | colour name \| #hex | orange | Colour |
| `anchor` | left \| center \| right | left | Anchor |

### `\Molecule`

Skeletal structure from SMILES. Use atom maps ([C:2]) to address atoms in curly arrows and transforms. Default intro: **create**.

```latex
\Molecule[id=r, at={-2,0}, lp={3}]{[CH3:1][C:2](=[O:3])[Cl:4]}
```

Content `{…}`: SMILES, e.g. [CH3:1][C:2](=[O:3])[Cl:4]

| key | type | default | description |
|---|---|---|---|
| `at` | vector "x,y" | 0,0 | Centre |
| `bond` | units | 1.45 | Bond length |
| `rotate` | degrees |  | Rotate the layout (turns off auto-orientation) |
| `flip` | flag |  | Mirror horizontally |
| `orient` | auto \| false | auto | Auto-turn reactants to face their curly arrows (nucleophile toward target, leaving group anti) |
| `carbons` | auto \| none \| terminal \| all | auto | Which carbons get a C label (auto: all of them in molecules with ≤ 3 heavy atoms) |
| `lp` | auto \| map list \| map:count list |  | Lone pairs to draw: auto = all heteroatoms; {3,5}; {3:2} |
| `color` | colour name \| #hex | fg | Bond / label colour |
| `size` | px | 0.36 × bond | Atom label size |

### `\CurlyArrow`

Electron-pushing arrow between atom refs: N (atom), N-M (bond / new-bond midpoint), lp:N (lone pair). Default intro: **create**.

```latex
\CurlyArrow[from=lp:5, to=2]
```

| key | type | default | description |
|---|---|---|---|
| `from` | atom ref |  | Electron source: lp:5, 2=3 (π bond), 2-4 (σ bond) |
| `to` | atom ref |  | Electron sink: 3 (atom), 5-2 (forming bond) |
| `bend` | number | 1 (away from molecule) | Curvature; sign flips side |
| `fishhook` | flag |  | Single-electron half-head |
| `color` | colour name \| #hex | orange | Colour |
| `width` | px | 3.5 | Stroke width |

### `\ReactionArrow`

Reaction arrow with optional TeX conditions above/below. Default intro: **create**.

```latex
\ReactionArrow[from={-1,0}, to={1,0}, above={\ce{H2O}}, below={\Delta}]
```

| key | type | default | description |
|---|---|---|---|
| `from` | vector "x,y" |  | Tail |
| `to` | vector "x,y" |  | Head |
| `above` | TeX |  | Label above (\ce{} works) |
| `below` | TeX |  | Label below |
| `color` | colour name \| #hex | fg | Colour |

## Actions

### `\Animate`

Tween ValueTrackers to new values; everything bound to them redraws.

```latex
\Animate[t=1, run=2]
```

| key | type | default | description |
|---|---|---|---|
| `run` | seconds |  | Duration of the intro / action |
| `<tracker>` | number \| expression |  | Target value for that tracker |

### `\Transform`

Morph molecule(s) into a new SMILES: mapped atoms move, new bonds draw, broken bonds fade.

```latex
\Transform[id={r,nu}]{[CH3:1][C:2]([O-:3])([Cl:4])[OH:5]}
```

Content `{…}`: product SMILES (same atom maps)

| key | type | default | description |
|---|---|---|---|
| `id` | id \| {id,id} |  | Source molecule(s) |
| `as` | identifier |  | Name of the result (default: first source id) |
| `at` | vector "x,y" |  | Centre of the product (default: aligned to sources) |
| `lp` | auto \| map list \| map:count list |  | Lone pairs to draw: auto = all heteroatoms; {3,5}; {3:2} |
| `carbons` | auto \| none \| terminal \| all | auto | Which carbons get a C label (auto: all of them in molecules with ≤ 3 heavy atoms) |
| `run` | seconds |  | Duration of the intro / action |

### `\TransformTex`

Morph a MathTex into new TeX, matching identical glyphs (manim TransformMatchingTex).

```latex
\TransformTex[id=eq]{x^2 + 2x + 1 = (x+1)^2}
```

Content `{…}`: new TeX

| key | type | default | description |
|---|---|---|---|
| `id` | id |  | MathTex to transform |
| `run` | seconds |  | Duration of the intro / action |

### `\FadeOut`

Fade out one object (id=…) or, without id, everything visible.

```latex
\FadeOut[id=ax]
```

| key | type | default | description |
|---|---|---|---|
| `id` | identifier |  | Name used by \Animate, \FadeOut, \Indicate, \Transform, on=… |
| `run` | seconds |  | Duration of the intro / action |

### `\Indicate`

Briefly scale up and glow an object.

```latex
\Indicate[id=d]
```

| key | type | default | description |
|---|---|---|---|
| `id` | identifier |  | Name used by \Animate, \FadeOut, \Indicate, \Transform, on=… |
| `run` | seconds |  | Duration of the intro / action |

### `\Wait`

Pause the step timeline.

```latex
\Wait[run=0.5]
```

| key | type | default | description |
|---|---|---|---|
| `run` | seconds |  | Duration of the intro / action |

## Keys accepted by every object

| key | type | description |
|---|---|---|
| `id` | identifier | Name used by \Animate, \FadeOut, \Indicate, \Transform, on=… |
| `anim` | create \| write \| fade \| fadein \| grow \| growup \| none | Override the intro animation |
| `run` | seconds | Duration of the intro / action |
| `delay` | seconds | Extra wait before starting |
| `with` | flag | Start together with the previous event instead of after it |

## Expressions

Any numeric key may be an expression over ValueTrackers and these functions: `sin cos tan asin acos atan atan2 sinh cosh tanh exp log ln log10 sqrt abs floor ceil round min max pow sign sigmoid clamp(x,a,b) lerp(a,b,t) gauss(x,mu,s) smoothstep(a,b,x) noise(x,seed)` and constants `pi E`. `^` means power.

## Colours

`blue orange red teal green purple yellow white muted fg`, any `\definecolor` name, or `#hex`.


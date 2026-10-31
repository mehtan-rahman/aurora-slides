# Aurora: Beamer → manim-style HTML slides

## 1. What this is

Aurora compiles an ordinary Beamer `.tex` deck into a single self-contained
`.html` file. You click through it like a deck, and the content animates the way
manim does: math is *written* stroke by stroke, curves draw themselves on, dots
grow, counters tick, and value trackers drive live redraws.

It rebuilds a lost earlier prototype. The screen recording in the repo root
(`Screen Recording 2026-05-14 …mov`) is the reference for the look and behavior.

### What the recording shows (the spec we're matching)

| Observed | Requirement |
|---|---|
| Near-black canvas (`#16181c`), white bold sans titles, small **orange uppercase section label** above each title | Theme: `\section` → eyebrow, `\frametitle` → title |
| Math set in Computer Modern (e.g. $z(t)$, $q\approx\frac12$, $w=p/q_\phi$) | Real TeX math via MathJax, rendered to SVG at build time |
| Lines of text appear one click at a time | `\pause`, `\item<n->`, `[<+->]` → click steps |
| Axes grow in, then noisy curves / sigmoids draw on from left to right | `Create` animation on SVG paths |
| Shaded A/B bands, arrows with labels, glowing dots | Scene primitives: `Band`, `Arrow`, `Dot`, `Text`, `MathTex` |
| "fraction reaching B = 0.38 → 0.99" while a dot slides along an A–B line | `ValueTracker` + `DecimalNumber` + expressions bound to trackers |
| Histograms whose bars grow from the baseline | `Bars` with grow-from-baseline |
| Concentric labelled circles drawn one after another | `Circle` + `Text`, played in sequence |
| Served at `127.0.0.1:3000/…/pitch.html` with live preview | `aurora serve` dev server with auto-reload |

Things the prototype had that the recording doesn't show (from the author):
**organic chemistry mechanisms** (molecules, curly electron-pushing arrows,
reactant→product morphs). Those are designed in §6 and scheduled for Milestone 2.

## 2. Goals and non-goals

**Goals**
- Input stays valid Beamer. The same file should still build a (static) PDF with
  `pdflatex` through `aurora.sty`, so nobody gets locked in.
- Animations look like manim: its easing (`smooth`), its Write / Create /
  GrowFromCenter vocabulary, its ValueTracker model.
- Output is one offline-capable HTML file with no CDN and no server needed to present.
- Authoring is fast: `aurora serve deck.tex` rebuilds and reloads on save.
- Chemistry is a first-class feature (M2).

**Non-goals (for now)**
- Full TeX fidelity. We support a well-defined Beamer subset and warn on the rest.
- Arbitrary TikZ. A TikZ subset may come later; scenes are the animation path.
- Rendering to video. Possible later via Playwright capture.

## 3. Architecture

```
deck.tex ──► reader ──► deck/frame converter ──► Deck IR ──► emitter ──► deck.html
              │            │  ├ inline LaTeX → HTML           (slides + scene JSON
              │            │  ├ overlays/\pause → steps        + runtime JS/CSS inlined)
              │            │  └ scene env → SceneSpec
              │            └ MathJax (TeX→SVG, build time, glyph paths kept)
              └ comment stripping, brace/bracket-aware argument reading
```

The compiler runs on Node ≥ 23.6 and is written in TypeScript, which Node runs
directly with no build step. The browser runtime is dependency-free JS.

### 3.1 Compiler (`src/`)

| File | Role |
|---|---|
| `reader.ts` | Cursor over TeX source: `readGroup`, `readOptional`, `readOverlay`, key=value parsing, comment stripping |
| `inline.ts` | Inline LaTeX → HTML (`\textbf`, `\emph`, `\alert`, `\textcolor`, `{\bfseries …}`, `$…$`, `\\`, ligatures/quotes, `\only/\uncover<…>`) |
| `frame.ts` | Block structure of a frame: paragraphs, lists, display math, columns, blocks, images, notes; assigns **steps** |
| `scene.ts` | Parses `\begin{scene}` into a `SceneSpec` (objects + timed events) |
| `deck.ts` | Preamble metadata, `\section` tracking, frame extraction, title slide |
| `math.ts` | MathJax TeX→SVG with `fontCache:'none'`, memoized |
| `emit.ts` | Writes the HTML: stage, slides, embedded scene JSON, digit glyph table, runtime |
| `cli.ts` | `aurora build` and `aurora serve` (HTTP plus SSE live reload) |

### 3.2 Step model (overlays)

Each frame has a step counter that follows Beamer's `beamerpauses` semantics:

- `\pause` moves the start of all following content one step later.
- `\item<3->`, `\only<2>{…}`, `\uncover<2-3>{…}` give explicit ranges as `from` and `until`.
- `[<+->]` on a list makes each item increment the counter.
- Scene events (`\pause` inside a scene) share the frame's counter, so text and
  animation interleave naturally.

After a frame is parsed, the step numbers it actually uses are **compacted** into
`0…n-1`. That avoids the empty "dead clicks" Beamer's counter arithmetic can produce.
Every element carries `data-from`/`data-until`, and the runtime does the rest.

### 3.3 Runtime (`runtime/`)

- **Stage.** A fixed 1920×1080 canvas scaled to fit the window, letterboxed in the
  background color.
- **Player.** Holds `(slide, step)`. → / Space / click / PageDown advance. If
  animations are still running, the first press *finishes them instantly* (manim-slides
  behavior) instead of skipping ahead. ← snaps back to the previous step's final
  state with no animation. Also: Home/End, `#/slide/step` deep links, `f` fullscreen.
- **Animation engine.** One `requestAnimationFrame` loop. Each animation exposes
  `tick(α)` and `finish()`. α is passed through manim's `smooth` rate function
  (sigmoid, inflection 10). Going backward = rebuild and run every earlier event's
  `finish()`, so state is always reproducible and never drifts.
- **Animations:**
  - `Write`: per-glyph stroke draw, then fill, lagged across glyphs. Used for math.
  - `Create`: stroke-dashoffset draw. Used for paths, axes, circles.
  - `FadeIn`: fade with a small upward shift. Used for text.
  - `GrowFromCenter`: scale up. Used for dots.
  - `GrowFromEdge`: scale up from the baseline. Used for bars.
  - `FadeOut`, `Indicate`.
  - `Animate` tracker tween: re-evaluates every bound expression each frame.
- **Expressions.** Any numeric prop may be a JS expression over the trackers and
  `Math` (`at={10*t-5, -2}`, `\Plot{a*sin(3*x)}`; `^` is accepted for powers).
  Objects whose props mention a tracker redraw while that tracker animates,
  which is manim's `always_redraw`.
- **DecimalNumber** uses a build-time glyph table of TeX digits, so live
  counters stay in Computer Modern like the recording.

### 3.4 Theme

Tokens live as CSS variables: `--bg #16181c`, `--fg #ececec`, `--muted #8b9099`,
`--orange #f0a35e`, `--blue #5da9e9`, `--red #d9775a`, `--teal #6cc4a0`,
`--purple #a98be8`, `--yellow #e9c46a`. Beamer color names and `\definecolor`
map onto them. `\alert` is orange. `\setbeamercovered{transparent}` shows
upcoming content dimmed instead of hidden.

## 4. Authoring a scene

Scene commands are capitalized after their manim class names. That makes them
easy to remember and keeps them clear of LaTeX's `\dot`, `\label` and `\circle`.

```latex
\begin{frame}{The trajectory is a deterministic function of the noise}
\begin{scene}[size={16,6.5}]
  \Axes[id=z, at={-4.5,0}, w=5, h=3, x={0,10,5}, y={-1,1,1}]
  \Axes[id=xa, at={4.5,0}, w=5, h=3, x={0,10,5}, y={-1,1,1}]
  \MathTex[at={-4.5,2.2}, color=blue]{z(t)}
  \pause
  \Plot[on=z, color=blue]{0.5*sin(5*x)+0.3*sin(13*x+1)}
  \Arrow[from={-1.2,0}, to={1.2,0}, color=muted]
  \Text[at={0,-0.5}, color=orange, size=24]{each launch draws fresh noise}
  \Band[on=xa, y={0.6,1}, color=blue, with]
  \Plot[on=xa, color=blue]{tanh(x-5)*0.9}
\end{scene}
\end{frame}
```

Common options on every object: `id`, `color`, `anim=create|write|fade|grow|none`,
`run=<seconds>`, `delay=<seconds>`, and the bare flag `with`, which starts the
object alongside the previous event instead of after it.

| Command | Key options | Default intro |
|---|---|---|
| `\Axes` | `at w h x={min,max,step} y={…}` | Create |
| `\Plot{expr}` | `on domain={a,b} samples width` | Create |
| `\Line`, `\Arrow` | `from to width dashed` | Create / grow |
| `\Dot` | `at r on` | GrowFromCenter |
| `\Circle`, `\Rect`, `\Band` | `at r` / `w h` / `on y={a,b}` or `x={a,b}`, `fill` | Create / fade |
| `\Bars` | `on values={…} x0 dx` | grow from baseline |
| `\MathTex{tex}`, `\Text{str}` | `at size anchor` | Write / FadeIn |
| `\ValueTracker` | `id value` | — |
| `\DecimalNumber` | `at value digits size` | FadeIn |
| `\Animate[t=0.99, run=3]` | tracker targets | tween |
| `\FadeOut[id=…]`, `\Indicate[id=…]` | | |

Coordinates are manim-like units: origin at the scene's center, y pointing up,
1 unit = 100 px on the 1920×1080 stage.

## 5. PDF fallback (`aurora.sty`)

`\usepackage{aurora}` defines the scene environment so `pdflatex` still compiles
the deck. In the PDF each scene becomes a framed placeholder, or a
`\includegraphics` of a poster image if one is given with `poster=`. M1 can
replace the placeholder with a static TikZ rendering of the scene's final state.

## 6. Chemistry (Milestone 2)

```latex
\begin{scene}
  \Molecule[id=r, at={-4,0}]{[CH3:1][C:2](=[O:3])[Cl:4]}
  \Molecule[id=nu, at={-7,0}]{[OH-:5]}
  \pause
  \CurlyArrow[from=lp:5, to=2]            % lone pair on atom 5 → atom 2
  \CurlyArrow[from=2=3, to=3, with]       % π bond C=O → O
  \pause
  \Transform[id=r, with=nu]{[CH3:1][C:2]([O-:3])([Cl:4])[OH:5]}
\end{scene}
```

- **Layout.** Build-time 2D coordinates from SMILES. We'll use RDKit's JS/WASM
  build (`@rdkit/rdkit`) in Node so we get canonical depictions plus atom-map
  numbers. smiles-drawer is the lighter fallback.
- **Rendering.** We emit our own SVG: bonds as paths, atom labels as text or
  MathJax. That way Create and Write apply, and every atom is addressable by map number.
- **Curly arrows.** Endpoints resolve to atoms (`2`), bonds (`2=3`, i.e. the bond
  midpoint), or lone pairs (`lp:5`, offset away from neighbors). The arrow is a
  cubic Bézier bowed away from the molecule's centroid, drawn with Create and a
  half-head for single-electron (fishhook) arrows (`fishhook`).
- **Mechanism morphs.** `\Transform` matches atoms by map number. Atoms that
  persist tween position. Bonds that persist tween endpoints. Formed bonds Create,
  broken bonds fade. Charges and lone pairs fade.
- **Extras.** Reaction arrows with conditions above and below
  (`\ReactionArrow{H$_2$O}{Δ}`), partial charges δ+/δ−, transition-state brackets
  with ‡, and an energy-diagram helper built on `Axes` + `Plot`.

## 7. Milestones

| | Scope | Status |
|---|---|---|
| **M0** | Reader, inline/frame conversion, steps/overlays, title slide, columns/blocks/images, MathJax, runtime player and engine, core scene primitives, `build` + `serve`, example deck | done |
| **M1** | `TransformTex` (glyph-matching equation morphs), speaker view synced over BroadcastChannel, overview grid, help overlay, `aurora.sty` PDF fallback, diagnostics with line numbers and suggestions, tables/listings/captions, TikZ/chemfig via LaTeX→SVG with overlays | done |
| **M2** | Chemistry: Molecule (RDKit layout, ACS proportions, lone pairs, circled charges, branch-angle regularisation), CurlyArrow (atom/bond/lone-pair refs, fishhook, routing around labels), Transform (fragment-wise alignment on a 30° grid, curly arrows retire automatically), ReactionArrow | done |
| **M2.5** | Product: `check`/`snapshot`/`init`/`reference` CLI with JSON, agent guide + skill + llms.txt, docs generator, tests, CI, npm packaging | done |
| **M3** | Wedge/hash stereo bonds, resonance arrows and brackets, energy-diagram helper, PDF images (`pdftocairo`), MP4/GIF export from `snapshot`, themes (light theme, custom palettes), a VS Code preview extension | next |

## 8. Open questions

1. Should within-step scene events default to *sequential* (manim's `self.play`
   chain) or *simultaneous*? We chose sequential, with a `with` flag for
   simultaneous. Revisit after real decks.
2. Should we bundle a Computer Modern web font for body text, or keep the sans
   look from the recording? We're keeping sans and leaving it themeable.
3. How much TikZ is worth supporting, given that scenes cover the animated cases?

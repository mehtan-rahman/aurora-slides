# Working on this deck (guide for AI agents)

This folder holds an **Aurora** presentation. `deck.tex` is ordinary Beamer
LaTeX. The `aurora` CLI compiles it to one self-contained, animated `deck.html`
in a manim-like style. **Edit `deck.tex` only. Never edit the generated HTML.**

## The loop

```sh
aurora check deck.tex --json        # parse; lists slides + warnings (with line numbers)
aurora build deck.tex               # writes deck.html
aurora snapshot deck.tex --json     # PNG of every slide's final state + overflow detection
aurora reference                    # every scene command, key, and default
```

1. Make an edit.
2. Run `aurora check deck.tex --json`. Fix **every** warning: each one has a
   `line` and a `message`, often with a "did you mean" suggestion.
3. Run `aurora snapshot deck.tex --json` (needs `npm i -D playwright && npx playwright install chromium`)
   and **look at the PNGs**. Overfull frames are shrunk automatically. Treat any
   slide listed in `shrunk` (below 90%) or `overflowing` as too full: cut text,
   shrink the scene `size`, or split the frame.
4. Repeat. To show the human, use `aurora serve deck.tex`, which live-reloads at
   http://127.0.0.1:3000.

## How slides map

| Beamer | Aurora |
|---|---|
| `\section{X}`, `\subsection{Y}` | Small orange uppercase label (› subsection) above the title of following frames |
| `\tableofcontents[currentsection]`, `\AtBeginSection[]{…}` | Clickable outline, inserted per section |
| `\begin{frame}[c,label=k]{Title}{Subtitle}` | Bold white title. The default alignment is **top**, so add `[c]` to centre. |
| `\pause`, `\item<2->`, `[<+-| alert@+>]`, `\only<2>{}`, `\uncover<2->{}`, `\alt<2>{a}{b}`, `overprint`, `\onslide<3->` | Click steps (animated). `\only`/`\uncover` may wrap images, lists and blocks. |
| `\[…\]`, `align`, `equation` (numbered, `\label`/`\eqref`), overlays inside them | Maths *written* stroke by stroke; overlay changes cross-fade |
| `itemize`, `enumerate[(a)]`, `columns`/`\column`, `block`, theorems, `tabular` (`\multirow`, `\rowcolor`), `lstlisting`/`minted` (highlighted), `semiverbatim` | Native HTML, themed |
| `\includegraphics` (PNG/JPG/SVG/PDF), `\graphicspath`, `figure` + `\caption`, `subfigure` | Embedded images |
| `tikzpicture`, `\chemfig`, `\begin{latex}…\end{latex}` | Compiled with real LaTeX to SVG (overlays and `\pause` inside TikZ work) |
| `\cite{k}` + `\bibliography{refs}` / `\printbibliography` | Citations and references from the `.bib` file |
| `\footnote`, `\hyperlink{label}{…}`, `\SI{9.81}{\meter\per\second\squared}` | Rendered as in Beamer |
| `\input{sections/x}` | Spliced in; warnings show `file:line` |
| `\note{…}`, `\note<2>{…}` | Speaker notes (press `s` in the browser), optionally for one step; `\auroraduration{20}` sets the talk length for the countdown |
| `\auroratheme{light}` in the preamble | Light palette (the default is dark) |
| `\auroraentrance{fade}` in the preamble | Fade each slide's first-step content in (by default a new slide appears at once) |
| `\begin{scene}…\end{scene}` | Animated diagram (see below) |

Full list and known differences: `docs/BEAMER.md` in the Aurora package.

## Scenes

```latex
\begin{frame}{Title}
\begin{scene}[size={16,6}]        % width, height in units; 1 unit = 100 px
  \Axes[id=ax, w=9, h=4, x={0,10,1}, y={-1,1,0.5}]
  \ValueTracker[id=k, value=1]
  \pause                            % next click
  \Plot[on=ax, color=blue]{sin(k*x)}
  \MathTex[at={5.5,1.6}, with]{\sin(kx)}   % `with` = start together with the previous event
  \pause
  \Animate[k=3, run=2]              % everything that mentions k redraws
\end{scene}
\end{frame}
```

- Coordinates: origin at the scene centre, **y up**, units of 100 px.
  `on=<axes id>` switches to that axes' data coordinates.
- Space budget on the 1920×1080 stage: with a title and nothing else, a scene can be
  up to `size={16,7.5}`. With one line of text above it, use about `{16,6}`.
- Within one click step, events play **one after another**. Add `with` to run
  one in parallel with the previous event, and `delay=0.3` to stagger.
- Any numeric key can be a JS-style expression over trackers:
  `at={10*t-5, 0}`, `value={sigmoid(10*(t-0.5))}`. Available helpers:
  `sin cos exp log sqrt abs min max pow sigmoid clamp lerp gauss smoothstep noise(x,seed)`.
- `\Text{…}` is plain text (`H_2O` → H₂O). Use `\MathTex{…}` for maths, without `$`.
- Objects need an `id` to be referenced by `\Animate`, `\FadeOut`, `\Indicate`,
  `\Transform`, `\TransformTex`, or `on=`.
- Colours: `blue orange red teal green purple yellow white muted fg`, or `#hex`.

### Chemistry

```latex
\begin{scene}[size={16,6}]
  \Molecule[id=nu, at={-5,0}, lp=auto]{[OH-:1]}
  \Molecule[id=sub, at={0,0}, lp={4}, with]{[CH3:2][Br:4]}
  \pause
  \CurlyArrow[from=lp:1, to=2]               % lone pair of atom 1 → atom 2
  \CurlyArrow[from=2-4, to=4]                % C–Br bond electrons → Br (draws after the first)
  \pause
  \Transform[id={nu,sub}, lp={1:2,4:4}]{[OH:1][CH3:2].[Br-:4]}
\end{scene}
```

- **Atom maps** (`[C:2]`) name atoms. Keep them unique within a scene and keep
  the same numbers in the product SMILES given to `\Transform`.
- Atom refs: `2` (atom), `2-4` or `2=3` (bond, or the midpoint of a forming bond),
  `lp:1` (lone pair on atom 1). Inside other objects, use `at=@2` with `offset={0.3,0.3}`.
- Separate the products with `.`, e.g. a leaving group `.[Br-:4]`. Each fragment
  stays near where its atoms were.
- Draw a mechanism's curly arrows one after another (no `with`), so each reads on its own.
  The next `\Transform` fades them and follows them: a breaking bond contracts into the
  leaving group, and new bonds grow out of the atom donating the electrons.
- Reactants turn automatically to face their curly arrows (nucleophile toward the
  target, leaving group anti), so don't fight it with coordinates. Use `rotate=`
  or `orient=false` only if you need a specific drawing.
- Lone pairs carry through `\Transform` (recounted). Use `lp={5:0}` to hide them on atom 5.
- `lp=auto` draws lone pairs on all heteroatoms. Use `lp={3}` for specific atoms,
  or `lp={3:2}` to give an explicit count.
- Arrow placement is automatic. If one looks wrong, override it with `side=above|below|left|right`,
  `out=`/`in=` (degrees, TikZ-style: `in=90` means the head arrives from above), or `looseness=`.
- Define shorthands with `\newcommand` in the preamble; they expand inside scenes, e.g.
  `\newcommand{\attack}[2]{\CurlyArrow[from=lp:#1, to=#2]}`.
- Reaction conditions: `\ReactionArrow[from={-1,0}, to={1,0}, above={\ce{H2O}}, below={\Delta}]`.
  `\ce{}` (mhchem) also works in `\MathTex` and in `$…$`.

## Gotchas

- Use `\renewcommand` for macros LaTeX already defines (e.g. `\Pr`), or `pdflatex` breaks.
- Frames with `lstlisting` or `verbatim` need `[fragile]` for pdflatex. Aurora doesn't care.
- `\usepackage{aurora}` (an `aurora.sty` is in this folder) keeps the deck
  compiling to PDF, where scenes appear as placeholders.
- Stereo bonds come from SMILES chirality (`[C@H]`, `[C@@H]`) and draw as wedges and hashes.
- Keep body text to about 6 lines per frame. The stage is 1920×1080 and body text is 29 px.

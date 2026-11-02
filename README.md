# Aurora

**Beamer in, manim-style animated slides out.**

Aurora compiles an ordinary Beamer `.tex` deck into a single self-contained HTML
file that animates like a [manim](https://www.manim.community/) video. Equations
are *written* stroke by stroke, curves draw themselves, numbers tick live, and
organic-chemistry mechanisms play out with curly arrows. You still click through
it like a normal deck.

<p align="center"><img src="docs/images/mechanism.gif" width="760" alt="A nucleophilic acyl substitution animating: curly arrows draw, atoms glide into the tetrahedral intermediate, chloride leaves"></p>

```latex
\begin{frame}{Nucleophilic acyl substitution}
\begin{scene}
  \Molecule[id=nu, at={-4.6,0.2}, lp=auto]{[OH-:5]}
  \Molecule[id=r, at={-0.6,0}, lp={3}, with]{[CH3:1][C:2](=[O:3])[Cl:4]}
  \pause
  \CurlyArrow[from=lp:5, to=2]
  \CurlyArrow[from=2=3, to=3, with]
  \pause
  \Transform[id={r,nu}]{[CH3:1][C:2]([O-:3])([Cl:4])[OH:5]}
\end{scene}
\end{frame}
```

<p align="center">
  <img src="docs/images/plots.gif" width="49%" alt="Axes grow, then a noisy signal and a trajectory draw themselves on">
  <img src="docs/images/tracker.gif" width="49%" alt="A live counter ticks up while a dot slides along a line">
</p>

**Try it:** open [`docs/demo.html`](docs/demo.html) in a browser (or the GitHub Pages
copy once Pages is enabled for `/docs`) and press → to step through.

## Why

- **Keep writing Beamer.** Existing decks compile as they are. That includes the full
  overlay syntax (`<+-| alert@+>`, `\only`, `\alt`, `overprint`, overlays inside
  equations and TikZ), `\input` files, sections with `\tableofcontents` and
  `\AtBeginSection`, theorems, tables, highlighted listings, figures (PDF too),
  footnotes, BibTeX bibliographies, and TikZ rendered by your real LaTeX. Aurora
  matches Beamer's slide count frame for frame. Add a `\usepackage{aurora}` line and
  the same file still builds a PDF with `pdflatex`. See
  [docs/BEAMER.md](docs/BEAMER.md).
- **Manim's look, minus the render loop.** The motion vocabulary is manim's: Write,
  Create, GrowFromCenter, ValueTracker, TransformMatchingTex, all on its easing
  curve. Everything runs live in the browser, so there are no videos to re-render.
- **Chemistry built in.** Molecules come from SMILES and are laid out by RDKit.
  Electron-pushing arrows are addressed by atom-map number. `\Transform` morphs one
  mechanism step into the next: atoms glide, new bonds form, leaving groups drift off.
- **One file to share.** The output is a single offline HTML file with no server
  or CDN. It includes a speaker view with notes and a timer, an overview grid, a
  laser pointer, black screen, and deep links to any step. It also prints to
  PDF: one page per frame, or one per overlay like Beamer.
- **Built for AI agents too.** It has a machine-readable command reference, JSON
  diagnostics with line numbers, PNG snapshots with overflow detection, and an
  agent skill. See [For AI agents](#for-ai-agents).

## Quick start

```sh
npm install -g aurora-slides        # or use `npx aurora-slides …`
aurora init my-talk                 # deck.tex + aurora.sty + AGENTS.md
aurora serve my-talk/deck.tex       # live preview at http://127.0.0.1:3000
aurora build my-talk/deck.tex       # → my-talk/deck.html
aurora pdf my-talk/deck.tex         # → my-talk/deck.pdf (handout-style, one page per frame)
```

This needs Node ≥ 22.18. LaTeX is **optional**: you only need it for TikZ and
chemfig fragments (`latex` + `dvisvgm`, both part of TeX Live / MacTeX) and for
building the PDF version with `pdflatex`. PDF/EPS images need Ghostscript (`gs`).

In the browser:

| Key | |
|---|---|
| → / space / click | Next step. If an animation is still running, the first press finishes it. |
| ← | Previous step (snaps to that step's final state) |
| `o` | Overview grid |
| `s` | Speaker view in a second window, kept in sync: the current slide, a live preview of what the next click shows, this step's notes, a clock, and a talk timer |
| `12` ⏎ | Go to slide 12 |
| `b` / `w` | Black / white screen |
| `l` | Laser pointer (also shown in the speaker window) |
| `f` | Fullscreen |
| ⌘P / Ctrl-P | Print or save as PDF, one page per frame |
| `?` | Help |

In the speaker view:
- The timer starts on your first click. `t` pauses it, and clicking it resets it.
- With `\auroraduration{20}` in the preamble (or pdfpc's `\pdfpcsetup{duration=20}`), it counts down: it turns orange in the last two minutes and red when you run over. Thin bars compare the time used with the slides shown.
- `+` and `−` resize the notes.
- `\note<2>{…}` shows a note only on step 2; a newly appeared note is marked.
- `aurora pdf --notes` prints a notes page after each slide that has notes.

## Writing slides

### Plain Beamer

| You write | You get |
|---|---|
| `\section{Results}`, `\subsection`, `\tableofcontents[currentsection]`, `\AtBeginSection` | Section label above each title, and clickable outlines |
| `\begin{frame}[c,label=key]{Title}{Subtitle}` | Title header, alignment, link target |
| `\pause`, `\item<2->`, `[<+-| alert@+>]`, `\only`, `\uncover`, `\alt`, `\temporal`, `overprint`, `\onslide<3->`, `<1,3>` | Click steps, each animated in. Block-level forms can swap images and lists. |
| `$…$`, `\[…\]`, `align`, `equation` (numbered, `\eqref`), overlays inside | MathJax SVG. Display maths is *written* glyph by glyph, and overlay changes cross-fade. |
| `columns`/`\column`, `block`, `alertblock`, theorems (`\newtheorem`), `tcolorbox`, `quote`, `multicols`, subfigures | Themed layout |
| `tabular` with booktabs, `\multicolumn`, `\multirow`, `\rowcolor`, `\pause` between rows | Native HTML tables |
| `lstlisting`, `minted`, `\lstinputlisting`, `semiverbatim` with `\alert<2>` | Syntax-highlighted code (about 45 languages) |
| `\includegraphics` (PNG/JPG/SVG/PDF), `\graphicspath`, `\movie`, `\animategraphics` | Embedded images, video, and image sequences |
| `tikzpicture` (with `\pause` and `\draw<2->`), `\chemfig`, `circuitikz`, `pgfplots`, `\begin{latex}…\end{latex}` | Compiled with your LaTeX to theme-coloured SVG. Each overlay becomes a step. |
| `\cite`, `\citet`, `\parencite` + `\bibliography{refs}`, `\printbibliography`, `thebibliography` | Citations and a reference list, read straight from the `.bib` file |
| `\footnote`, `\hyperlink`, `\SI{3}{\meter}`, `\href`, accents, `\textcolor{red!50!black}` | Rendered as in Beamer |
| `\note{…}`, `\note<2>{…}`, `\input{…}`, `\newcommand`, `\newenvironment`, `\definecolor` | Speaker notes (per step too), includes, and macros in text, maths and scenes |
| `aspectratio=43`, `handout`, `\usetheme{metropolis}`, `\setbeamercolor{alerted text}{…}` | Stage size, handouts, section pages, accent colours |
| `\auroratheme{light}` (preamble) | Light palette for bright rooms. The default is the dark manim look. |

The full list, with the places Aurora deliberately differs, is in
**[docs/BEAMER.md](docs/BEAMER.md)**.

### Scenes: animated diagrams

Put a `scene` in any frame. Its commands are named after manim classes:

```latex
\begin{scene}[size={16,6}]                          % units; 1 unit = 100 px
  \Axes[id=ax, w=9, h=4, x={0,10,1}, y={-1.2,1.2,0.6}]
  \ValueTracker[id=k, value=1]
  \MathTex[at={5.6,1.7}, color=blue]{\sin(kx)}
  \pause
  \Plot[on=ax, color=blue]{sin(k*x)}               % draws on (Create)
  \pause
  \Animate[k=3, run=2]                              % the curve re-plots live
\end{scene}
```

Objects: `Axes Plot Line Arrow Dot Circle Rect Band Bars MathTex Text
DecimalNumber ValueTracker Molecule CurlyArrow ReactionArrow`.
Actions: `Animate Transform TransformTex FadeOut Indicate Wait`.
Every key is listed in **[docs/REFERENCE.md](docs/REFERENCE.md)** (`aurora reference` prints it too).

- `\pause` inside a scene is a click step, shared with the rest of the frame.
- Within a step, events run in sequence. Add `with` to run one alongside the
  previous event, and `delay=` to stagger.
- Numeric keys accept expressions over trackers (`at={10*t-5, 0}`) using helpers
  such as `sigmoid`, `gauss`, `smoothstep`, and `noise(x, seed)` for stochastic-looking curves.

### Chemistry

<p align="center"><img src="docs/images/sn2.gif" width="640" alt="SN2: hydroxide attacks from the back, the stereocentre inverts, bromide leaves"></p>

- `\Molecule[lp=auto]{SMILES}`: skeletal formula with lone pairs. Atom maps
  (`[C:2]`) name atoms.
- `\CurlyArrow[from=lp:5, to=2]`: refs are `N` (atom), `N-M`/`N=M` (bond, or a
  forming bond's midpoint), and `lp:N` (lone pair). Add `fishhook` for radical chemistry.
  Placement is automatic: tails sit on the electrons, heads aim at the receiving
  atom, and bond → atom arrows arch from the bond's middle. To override, use
  TikZ-style keys: `side=above|below|left|right`, `out=`/`in=` angles in degrees,
  and `looseness=`.
- `\Transform[id={a,b}]{product SMILES}` morphs to the next structure, following the
  curly arrows. A breaking bond lets go of the atom it leaves and contracts into
  the leaving group. A new bond grows from one side: out of the attacking atom, or
  out of the atom whose lone pair forms a π bond. Mapped atoms glide (inversions swing through), and lone
  pairs and charges slide or fade. Separate product fragments with `.`.
- Tetrahedral centres are drawn in perspective (two bonds in the plane, plus a
  wedge and a hash), never as a flat + cross. Stereocentres from the SMILES
  (`[C@H]`) are always drawn as the right enantiomer.
- Reactants turn themselves to face their curly arrows: the nucleophile's lone
  pairs point at the target, and a leaving group sits anti to the attack (true
  backside SN2). Give `rotate=` or `orient=false` to place a molecule yourself.
- `\ReactionArrow[above={\ce{H2O}}, below={\Delta}]`, and `\ce{…}` (mhchem) in any maths.
- Your own `\newcommand`s work inside scenes, so you can define a house style once:

  ```latex
  \newcommand{\attack}[2]{\CurlyArrow[from=lp:#1, to=#2]}
  \newcommand{\leave}[2]{\CurlyArrow[from=#1-#2, to=#2]}
  % in a scene:  \attack{6}{1}  \leave{1}{5}
  ```

## Gallery

| | |
|---|---|
| ![Noise to trajectory](docs/images/noise.png) | ![Histograms](docs/images/histograms.png) |
| ![Equations are written](docs/images/equations.png) | ![Tetrahedral intermediate](docs/images/intermediate.png) |
| ![TikZ with overlays](docs/images/tikz.png) | ![chemfig and code](docs/images/chemfig.png) |

## Command line

```
aurora build <deck.tex> [-o out.html] [--handout] [--json]
aurora serve <deck.tex> [--port 3000]
aurora pdf <deck.tex> [-o out.pdf] [--all-steps] [--handout]
aurora check <deck.tex> [--json] [--strict]
aurora snapshot <deck.tex> [--out dir] [--slides 1,3-5] [--all-steps] [--json]
aurora init [dir] [--template basic|talk|chemistry]
aurora reference [--json | --md]
```

`snapshot` and `pdf` use Playwright, an optional dependency:
`npm i -D playwright && npx playwright install chromium`.

## For AI agents

Aurora is designed so that a coding agent can write a deck end to end and check its own work:

- **`AGENTS.md`** is created by `aurora init` in every new deck folder. It is a
  compact authoring guide covering the edit, check, and look loop, layout budget,
  recipes, and gotchas.
- **[`skills/aurora-slides/SKILL.md`](skills/aurora-slides/SKILL.md)** is an Agent
  Skill. Copy it into `~/.claude/skills/` (or your agent's skills folder).
- **`aurora reference --json`** emits the full command schema: every object, key,
  type, and default.
- **`aurora check --json`** emits structured warnings with line numbers and
  "did you mean" suggestions for misspelled keys and commands.
- **`aurora snapshot --json`** renders a PNG per slide. It reports slides the
  runtime had to shrink to fit (`shrunk`), any that still overflow, and runtime errors.
- **[`llms.txt`](llms.txt)** is a one-page index for LLMs.
- In the browser, `window.aurora` exposes `next()`, `prev()`, `jump(slide, step)`,
  `goto(label)`, `steps(slide)`, `busy()` and `printLayout()` for automation.

## Examples

- [`examples/demo.tex`](examples/demo.tex): the showcase (plots, trackers,
  histograms, mechanisms, equation morphs).
- [`examples/tour/deck.tex`](examples/tour/deck.tex): a tour of everyday Beamer
  ([HTML](docs/tour.html)). It uses `\input` sections, outlines, every overlay form,
  numbered equations, theorems, highlighted code, PDF figures, tables, footnotes,
  and a BibTeX bibliography. It also builds with `pdflatex`.
- [`examples/classic.tex`](examples/classic.tex): an unmodified-style Beamer deck
  with TikZ overlays, booktabs, a listing, and chemfig.
- `templates/`: what `aurora init` starts you with.

## How it works

The compiler (TypeScript, `src/`) reads the TeX, turns overlays into a compact
step timeline, renders maths with MathJax and molecules with RDKit at build time,
and writes one HTML file. That file contains the slides, a JSON description of
each scene, and a small dependency-free runtime (`runtime/aurora.js`): an
animation engine with manim's rate functions, plus a scene renderer and the
player. More detail is in [docs/DESIGN.md](docs/DESIGN.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `npm run check` typechecks, runs the
tests, and validates the demo deck.

## License

[MIT](LICENSE)

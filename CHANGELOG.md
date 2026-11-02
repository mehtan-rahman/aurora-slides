# Changelog

## Unreleased

### Beamer compatibility

Aurora now covers the Beamer that real decks use. The tour deck
(`examples/tour/deck.tex`) builds with `pdflatex` too, and Aurora matches Beamer's
slide count for every frame. The full list is in [docs/BEAMER.md](docs/BEAMER.md).

- **Overlays.** The full spec syntax is supported: `<1,3->`, `<+(1)->`,
  `<+-| alert@+>`, `beamer:`/`handout:` prefixes, and `+` evaluated once per spec.
  - New: block-level `\only`/`\uncover`/`\visible`/`\invisible` (swap images,
    lists, blocks); `\alt`, `\temporal`; bare `\onslide<n->` switches; `overprint`;
    the `onlyenv`/`uncoverenv`/`altenv` family.
  - Overlay-aware `\textbf<2>`, `\textcolor<2>`, `\item<alert@2>`.
  - Overlays inside display and inline maths.
  - `\pause` inside TikZ. Hidden TikZ parts keep the bounding box.
  - Handout mode (`handout` class option or `--handout`).
- **Structure.**
  - `\input`/`\include`/`\subfile`/`\import`, with `file:line` diagnostics.
  - `\subsection`; `\tableofcontents` with its options and clickable entries;
    `\AtBeginSection`.
  - Frame options: `\appendix`, `\againframe`, `[t]`/`[c]`/`[b]`, `label=`,
    `noframenumbering`.
  - `aspectratio=`.
  - Notes after frames, `\note[item]`, and `\mode<article>`.
  - Theme support: metropolis section pages, `[standout]` and the progress bar;
    info-line footlines (Madrid etc.); `\logo` and `\titlegraphic`;
    `\setbeamercolor` for alert and accent colours; the serif font theme.
- **Content.**
  - Numbered equations with `\label`/`\eqref`.
  - Beamer's theorem set plus `\newtheorem`, with optional numbering and ∎ on proofs.
  - `\newenvironment` and optional-argument macros.
  - Enumerate labels from `enumerate`/`enumitem`; `\column`; `multicols`;
    `quote`/`verse`/`abstract`; `tcolorbox`; `subfigure`; `\centering`.
  - Tables: `\multirow`, `\rowcolor`, `\cellcolor`, vertical rules, header rows,
    `\onslide` rows.
  - Footnotes at the foot of the frame; `\hyperlink` and buttons; siunitx; accents;
    xcolor mixing; boxes; `\hfill`.
- **Code.**
  - Syntax highlighting for about 45 languages in `lstlisting`/`minted`/
    `\lstinline`/`\mintinline`.
  - `\lstset`, line numbers, `highlightlines`, `\lstinputlisting`/`\inputminted`.
  - `semiverbatim` with overlays.
  - `%` inside verbatim is no longer treated as a comment.
- **Figures and media.**
  - PDF/EPS images (rasterised with Ghostscript), `\graphicspath`, image rows.
  - `\movie`/`\includemedia`/`\video`, `\animategraphics`.
  - Inline `\tikz`.
- **Bibliography.** `thebibliography`, or `.bib` files read directly (no BibTeX
  run). natbib and biblatex cite commands, numeric or author-year.
- **Player.**
  - Overfull frames shrink to fit.
  - `b`/`w` blank the screen; `l` laser pointer; type a number and ⏎ to jump.
  - The speaker view adds a clock.
  - Videos autoplay; slide transitions.
  - Printing gives one page per frame.
- **CLI.**
  - `aurora pdf` (`--all-steps` for one page per overlay, like Beamer).
  - `snapshot --json` reports `shrunk` slides.

**Fixes after review** (images checked against pdflatex output):

- `width=0.6\textwidth` inside `\centering` and figures no longer renders tiny.
- `angle=` is no longer undone by the fade-in animation, and quarter turns reserve their rotated space.
- `trim`/`clip`/`viewport` crop.
- Images without a size get their physical size from their dpi, as in pdflatex.
- `\resizebox`/`\scalebox` around an image set its size.
- `\ref` to figure and table labels works.
- `\usebackgroundtemplate` works.
- Images inside TikZ nodes compile and embed.
- The logo sits above an info-line footline.
- Fix: with `\setbeamercovered{transparent}`, slides no longer flash their content faintly as they enter.

### Slides

- A new slide now appears at once, as in Beamer, instead of fading its content in item by item. Clicks (`\pause`, `<2->`) still animate their content, and scenes still play their first step. `\auroraentrance{fade}` brings back the fade.

### Examples

- The showcase deck (`examples/demo.tex`) is now topic-neutral, with one slide per capability. The README GIFs and gallery are re-recorded from it.

### Speaker view

- Live preview of what the next click shows, in place of the "next: step 2" text.
- Per-step notes: `\note<2>{…}` appears only on step 2 (and counts as a step, as in Beamer); a newly appeared note is marked.
- Talk timer: starts on the first click, `t` pauses it, and click it to reset. `\auroraduration{20}` (or pdfpc's `\pdfpcsetup{duration=20}`) turns it into a countdown with orange and red warnings and pace bars.
- `+` / `−` resize the notes (remembered). pdfpc's `\pdfpcnote{…}` works as a note.
- `aurora pdf --notes` adds a notes page after each slide that has notes.

### Chemistry

- Curly arrows:
  - Bond → atom arrows are symmetric arches from the bond's middle.
  - The attack side is chosen by room at the target, so arrows no longer land on wedges.
  - Heads keep clear of bare carbons.
  - New keys: `side`, `out`, `in`, `looseness`.
- `\newcommand` macros expand inside scenes, for mechanism shorthands.
- **Mechanism steps follow their curly arrows.**
  - A breaking bond lets go of the atom it leaves and contracts into the leaving group.
  - New bonds grow from one side: out of the attacking atom, or out of the lone-pair donor for a π bond.
- Tetrahedral centres are drawn in perspective (wedge and hash) instead of as a flat + cross.
- Fix: stereocentres are always drawn as the correct enantiomer. Alignment used to mirror SN2 products, which showed retention instead of inversion.
- Curly arrows in the examples draw one after another instead of overlapping.
- Curly arrows follow textbook conventions: tails sit on the electrons, and heads point straight at the receiving atom or bond along smooth arcs.
- Fix: a mechanism step cancelled mid-animation no longer leaves an atom label flipped (e.g. "HOH₃C").
- Chemistry looks and moves like a textbook:
  - Reactants auto-orient to their curly arrows (backside SN2, nucleophile lone pair facing the target). `orient=false` opts out.
  - Lone pairs sit on the free sides of the label, and charges take a free corner. Lone pairs carry through `\Transform`.
  - Curly arrows leave the facing lone pair, stop at label edges, hug bonds for bond → atom pushes, and bow less on long hops.
  - Morphs are concerted: new bonds grow from the attacking atom, broken bonds stretch as they fade, and lone pairs slide to their new places.
- `aurora.seek(ms)` freezes the current step at an exact time, for deterministic frame capture.
- Fix: fast navigation no longer throws when the browser rate-limits `history.replaceState`.
- In a git checkout, `bin/aurora.js` always runs `src/`, so a stale local `dist/` can't shadow edits.

## 0.1.0

First release.

- Beamer → single-file HTML: sections, frames, `\pause`, overlays (`<n->`, `<+->`, `\only`, `\uncover`, `\alert<n>`), lists, columns, blocks and theorems, tables, code listings, images, notes, user macros and colours.
- MathJax maths with manim-style *Write* animation for display equations.
- Scenes: Axes, Plot, Line, Arrow, Dot, Circle, Rect, Band, Bars, MathTex, Text, ValueTracker, DecimalNumber, plus Animate, FadeOut, Indicate, Wait, and TransformTex (glyph-matching equation morphs).
- Chemistry: Molecule (SMILES via RDKit, lone pairs, charges), CurlyArrow (atom, bond, and lone-pair refs; fishhook), Transform (mechanism morphs with fragment-wise alignment), ReactionArrow.
- TikZ, chemfig, and other fragments compiled with the local LaTeX to themed SVG, with Beamer overlays.
- Player: step-accurate navigation, deep links, speaker view synced across windows, overview grid, help overlay, touch swipe.
- CLI: build, serve (live reload), check, snapshot, init, reference; JSON output throughout.
- AI support: AGENTS.md, agent skill, llms.txt, JSON schema reference, diagnostics with suggestions.
- `aurora.sty` so decks still compile with pdflatex.

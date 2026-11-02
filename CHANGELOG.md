# Changelog

## Unreleased

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

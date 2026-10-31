# Changelog

## Unreleased

- Chemistry looks and moves like a textbook:
  - Reactants auto-orient to their curly arrows (backside SN2, nucleophile lone pair facing the target). `orient=false` opts out.
  - Lone pairs sit on the free sides of the label, and charges take a free corner. Lone pairs carry through `\Transform`.
  - Curly arrows leave the facing lone pair, stop at label edges, hug bonds for bond → atom pushes, and bow less on long hops.
  - Morphs are concerted: new bonds grow from the attacking atom, broken bonds stretch as they fade, and lone pairs slide to their new places.
- `aurora.seek(ms)` freezes the current step at an exact time, for deterministic frame capture.
- Fix: fast navigation no longer throws when the browser rate-limits `history.replaceState`.

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

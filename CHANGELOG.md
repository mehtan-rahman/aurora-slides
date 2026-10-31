# Changelog

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

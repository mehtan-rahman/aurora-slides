# AGENTS.md

Guidance for AI agents working in this repository.

- **To write or edit a presentation *with* Aurora**, read
  [`templates/AGENTS.deck.md`](templates/AGENTS.deck.md). It is the deck-author
  guide that `aurora init` copies into new decks.
- **To change Aurora itself**, read on.

## Layout

| Path | What |
|---|---|
| `src/cli.ts` | CLI: build, serve, check, snapshot, init, reference |
| `src/deck.ts` | Document level: preamble metadata, macros, colours, sections, frames, diagnostics |
| `src/frame.ts` | Frame body → HTML blocks (lists, maths, columns, boxes, tables, code, images, LaTeX fragments) |
| `src/inline.ts` | Inline LaTeX → HTML; the `Steps` overlay model (`\pause`, `<2->`, `+`) and step compaction |
| `src/scene.ts` | `\begin{scene}` → `SceneSpec` (objects + step-tagged events); key validation |
| `src/schema.ts` | **Source of truth** for scene commands and their keys (drives validation, `aurora reference`, docs) |
| `src/chem.ts` | RDKit layout from SMILES, lone pairs, fragment-wise alignment for `\Transform` |
| `src/latexsvg.ts` | Fallback: compile fragments (TikZ, chemfig) with `latex` + `dvisvgm`, cached |
| `src/math.ts` | MathJax TeX → SVG (glyphs kept as paths so they can be *written*) |
| `src/emit.ts` | Writes the single HTML file (inlines `runtime/`) |
| `runtime/aurora.js` | Browser runtime: animation engine, scene renderer (incl. molecules, curly arrows, morphs), player, speaker view, overview |
| `runtime/aurora.css` | Theme (CSS variables at the top) |
| `templates/` | `aurora init` starters + the deck-author agent guide |
| `tex/aurora.sty` | PDF fallback so decks still compile with pdflatex |
| `scripts/gen-docs.ts` | Regenerates `docs/REFERENCE.md` and `skills/aurora-slides/SKILL.md` |

## Rules

- Node ≥ 22.18 runs the TypeScript sources directly (`node src/cli.ts …`). Use
  only erasable TS syntax: no enums, no parameter properties, no namespaces.
  Relative imports use the `.ts` extension.
- When you add or change a scene command, update `src/schema.ts` and the
  renderer in `runtime/aurora.js` (`RENDER`, `DEFAULT_INTRO`, `DEFAULT_RUN`), then
  run `npm run docs`.
- When you change `templates/AGENTS.deck.md`, run `npm run docs` to refresh the skill.
- Before finishing: `npm run check` (typecheck + tests + strict check of the demo).
  For visual changes, build `examples/demo.tex` and look at it with `aurora snapshot`.
- The runtime is plain browser JS with no dependencies and no build step. Keep it that way.
- Step numbers in the compiler are Beamer slide numbers (1-based) until
  `Steps.compaction()` maps them to dense 0-based indices per frame.

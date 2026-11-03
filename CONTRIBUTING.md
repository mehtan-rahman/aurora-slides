# Contributing

```sh
git clone https://github.com/mehtan-rahman/aurora-slides.git && cd aurora-slides
npm install
npm run check                    # typecheck + tests + strict check of the demo deck
node src/cli.ts serve examples/demo.tex
```

- The compiler is TypeScript run directly by Node (≥ 22.18). There's no build step
  in development; `npm run build` compiles to `dist/` for publishing.
- The browser runtime (`runtime/aurora.js`) is plain JavaScript with no dependencies.
- Scene commands are declared in `src/schema.ts`. After changing it, or
  `templates/AGENTS.deck.md`, run `npm run docs`.
- Add a test in `test/` for parser changes. For visual changes, attach a
  screenshot (`aurora snapshot`) to your PR.

See [AGENTS.md](AGENTS.md) for a map of the code.

## Releasing

1. Move the `Unreleased` notes in `CHANGELOG.md` under a dated version heading and
   set the same version in `package.json`.
2. `npm run check && npm run examples` (refreshes `docs/demo.html` and `docs/tour.html`).
3. Commit, then tag and push: `git tag v0.2.0 && git push origin main v0.2.0`.
4. The `Release` workflow runs the checks, publishes to npm with provenance, and
   creates the GitHub release. It needs an `NPM_TOKEN` repository secret (an npm
   automation token). To publish by hand instead: `npm publish --access public`.

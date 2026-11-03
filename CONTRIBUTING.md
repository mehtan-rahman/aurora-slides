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

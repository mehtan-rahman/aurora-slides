#!/usr/bin/env node
// Runs the TypeScript sources in a git checkout (Node ≥ 22.18 runs .ts files directly),
// or the compiled CLI when installed from npm (Node won't strip types inside node_modules).
// A checkout always uses src/, so a stale local dist/ can never shadow your edits.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = new URL('../src/cli.ts', import.meta.url);
const inNodeModules = fileURLToPath(import.meta.url).split(/[\\/]/).includes('node_modules');
await import(!inNodeModules && existsSync(src) ? src.href : new URL('../dist/cli.js', import.meta.url).href);

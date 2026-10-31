#!/usr/bin/env node
// Runs the compiled CLI when installed from npm, or the TypeScript sources in a
// git checkout (Node ≥ 22.18 runs .ts files directly).
import { existsSync } from 'node:fs';

const dist = new URL('../dist/cli.js', import.meta.url);
await import(existsSync(dist) ? dist.href : new URL('../src/cli.ts', import.meta.url).href);

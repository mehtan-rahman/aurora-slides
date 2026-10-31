// Regenerates docs/REFERENCE.md and skills/aurora-slides/SKILL.md from their sources
// (src/schema.ts and templates/AGENTS.deck.md). CI fails if they are stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { renderReference } from '../src/reference.ts';

const root = new URL('..', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const write = (p: string, s: string) => writeFileSync(new URL(p, root), s);

write('docs/REFERENCE.md', renderReference('md') + '\n');

const guide = read('templates/AGENTS.deck.md').replace(/^# .*\n/, '');
write('skills/aurora-slides/SKILL.md', `---
name: aurora-slides
description: Create or edit animated presentations with Aurora. Aurora compiles Beamer LaTeX (.tex) into manim-style HTML slides with written equations, animated plots and value trackers, and organic-chemistry mechanisms with curly arrows. Use when the user wants a talk, lecture, or slide deck with animations, maths, or chemistry, or mentions Beamer, manim-style slides, or Aurora.
---

# Aurora slides

> Generated from \`templates/AGENTS.deck.md\` by \`npm run docs\`. Edit that file instead.

## Setup

\`\`\`sh
npx aurora-slides init talk            # new deck in ./talk (deck.tex, aurora.sty, AGENTS.md)
npx aurora-slides serve talk/deck.tex  # live preview for the human
\`\`\`

Use \`npx aurora-slides\` wherever this guide says \`aurora\` if it isn't installed globally
(\`npm i -g aurora-slides\`).
${guide}
## Full command reference

Run \`aurora reference\` (or \`aurora reference --json\`) for every scene command, key, and default.
`);
console.log('docs regenerated');

// Renders the scene-command reference from schema.ts (text, Markdown or JSON).
import { COMMANDS, ACTION_SPECS, COMMON_KEYS, type CommandSpec } from './schema.ts';

export function renderReference(format: 'text' | 'md' | 'json'): string {
  if (format === 'json') return JSON.stringify({ objects: COMMANDS, actions: ACTION_SPECS, commonKeys: COMMON_KEYS }, null, 2);
  const out: string[] = [];
  const md = format === 'md';
  const section = (title: string, specs: Record<string, CommandSpec>) => {
    out.push(md ? `## ${title}\n` : `\n${title.toUpperCase()}\n`);
    for (const [name, s] of Object.entries(specs)) {
      if (md) {
        out.push(`### \`\\${name}\`\n\n${s.summary}${s.intro ? ` Default intro: **${s.intro}**.` : ''}\n`);
        out.push('```latex\n' + s.example + '\n```\n');
        if (s.content) out.push(`Content \`{…}\`: ${s.content}\n`);
        out.push('| key | type | default | description |\n|---|---|---|---|');
        for (const [k, v] of Object.entries(s.keys)) out.push(`| \`${k}\` | ${v.type.replace(/\|/g, '\\|')} | ${v.default ?? ''} | ${v.desc.replace(/\|/g, '\\|')} |`);
        out.push('');
      } else {
        out.push(`\\${name}  ${s.summary}`);
        out.push(`    e.g. ${s.example}`);
        if (s.content) out.push(`    {…}  ${s.content}`);
        for (const [k, v] of Object.entries(s.keys)) out.push(`    ${k.padEnd(9)} ${v.type}${v.default ? ` (default ${v.default})` : ''}: ${v.desc}`);
        out.push('');
      }
    }
  };
  if (md) out.push('# Scene command reference\n\n> Generated from `src/schema.ts` by `aurora reference --md`. Do not edit by hand.\n\nScene commands go inside `\\begin{scene}[size={W,H}] … \\end{scene}` in a frame. Coordinates are in scene units (1 unit = 100 px on the 1920×1080 stage), origin at the centre, y pointing up. `\\pause` inside a scene starts a new click step and is shared with the rest of the frame.\n');
  section('Objects', COMMANDS);
  section('Actions', ACTION_SPECS);
  out.push(md ? '## Keys accepted by every object\n\n| key | type | description |\n|---|---|---|' : '\nCOMMON KEYS (every object)');
  for (const [k, v] of Object.entries(COMMON_KEYS)) out.push(md ? `| \`${k}\` | ${v.type.replace(/\|/g, '\\|')} | ${v.desc} |` : `    ${k.padEnd(9)} ${v.type}: ${v.desc}`);
  out.push(md
    ? '\n## Expressions\n\nAny numeric key may be an expression over ValueTrackers and these functions: `sin cos tan asin acos atan atan2 sinh cosh tanh exp log ln log10 sqrt abs floor ceil round min max pow sign sigmoid clamp(x,a,b) lerp(a,b,t) gauss(x,mu,s) smoothstep(a,b,x) noise(x,seed)` and constants `pi E`. `^` means power.\n\n## Colours\n\n`blue orange red teal green purple yellow white muted fg`, any `\\definecolor` name, or `#hex`.\n'
    : '\nEXPRESSIONS  sin cos tan exp log sqrt abs min max pow sigmoid clamp lerp gauss smoothstep noise(x,seed) pi E; ^ = power\nCOLOURS      blue orange red teal green purple yellow white muted fg, \\definecolor names, #hex');
  return out.join('\n');
}

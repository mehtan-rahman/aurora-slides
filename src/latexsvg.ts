// Fallback renderer: compile a fragment (TikZ, chemfig, tables, anything) with the
// local LaTeX install and embed it as SVG. Results are cached by content hash.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let available: boolean | null = null;
const cacheDir = join(tmpdir(), 'aurora-latex-cache');
let uid = 0;

export function latexAvailable(): boolean {
  if (available === null) {
    try {
      execFileSync('latex', ['--version'], { stdio: 'ignore' });
      execFileSync('dvisvgm', ['--version'], { stdio: 'ignore' });
      available = true;
    } catch { available = false; }
  }
  return available;
}

// Theme colours so LaTeX figures match the deck (redefines xcolor's base names).
const DARK = `\\definecolor{blue}{HTML}{5DA9E9}\\definecolor{orange}{HTML}{F0A35E}\\definecolor{red}{HTML}{D9775A}
\\definecolor{teal}{HTML}{6CC4A0}\\definecolor{green}{HTML}{6CC4A0}\\definecolor{purple}{HTML}{A98BE8}
\\definecolor{yellow}{HTML}{E9C46A}\\definecolor{gray}{HTML}{8B9099}\\definecolor{muted}{HTML}{8B9099}
\\definecolor{fg}{HTML}{ECECEC}\\definecolor{black}{HTML}{ECECEC}\\definecolor{white}{HTML}{16181C}
\\AtBeginDocument{\\ifdefined\\tikzset\\tikzset{every picture/.append style={line width=0.9pt}}\\fi
\\ifdefined\\setchemfig\\setchemfig{bond style={line width=0.9pt}}\\fi}`;

/** Keeps the parts of a Beamer preamble that matter for a standalone fragment. */
export function fragmentPreamble(pre: string): string {
  return pre
    .replace(/\\documentclass(\[[^\]]*\])?\{[^}]*\}/, '')
    .replace(/\\use(color|font|inner|outer)?theme(\[[^\]]*\])?\{[^}]*\}/g, '')
    .replace(/\\setbeamer\w+(\[[^\]]*\])?\{[^}]*\}(\{[^}]*\})?/g, '')
    .replace(/\\usepackage(\[[^\]]*\])?\{[^}]*(beamer|aurora|hyperref)[^}]*\}/g, '')
    .replace(/\\(title|subtitle|author|institute|date|logo|titlegraphic)(\[[^\]]*\])?\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
    .replace(/\\auroratheme\{[^}]*\}/g, '')
    .replace(/\\AtBeginSection(\[[^\]]*\])?\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
}

/**
 * Renders `body` to an SVG string (ids made unique), or throws with the LaTeX
 * error message. `scale` is CSS px per TeX pt.
 */
const LIGHT = DARK
  .replace('5DA9E9', '2F7FC8').replace('F0A35E', 'D9822B').replace('D9775A', 'C4553A')
  .replace(/6CC4A0/g, '2F9E78').replace('A98BE8', '7B5CC9').replace('E9C46A', 'C79A1D')
  .replace(/\{fg\}\{HTML\}\{ECECEC\}/, '{fg}{HTML}{23262C}').replace(/\{black\}\{HTML\}\{ECECEC\}/, '{black}{HTML}{23262C}')
  .replace(/\{white\}\{HTML\}\{16181C\}/, '{white}{HTML}{FBFAF7}');

export function renderLatex(body: string, preamble: string, scale = 3, theme: 'dark' | 'light' = 'dark'): string {
  const THEME = theme === 'light' ? LIGHT : DARK;
  // pgf's dvisvgm driver writes SVG specials directly (no Ghostscript needed).
  const doc = `\\def\\pgfsysdriver{pgfsys-dvisvgm.def}
\\documentclass[border=2pt]{standalone}
\\usepackage{xcolor}
${THEME}
${preamble}
\\begin{document}\\color{fg}%
${body}
\\end{document}
`;
  const hash = createHash('sha1').update(doc).digest('hex').slice(0, 16);
  mkdirSync(cacheDir, { recursive: true });
  const svgPath = join(cacheDir, `${hash}.svg`);
  if (!existsSync(svgPath)) {
    const tex = join(cacheDir, `${hash}.tex`);
    writeFileSync(tex, doc);
    try {
      execFileSync('latex', ['-interaction=nonstopmode', '-halt-on-error', `${hash}.tex`], { cwd: cacheDir, stdio: 'pipe', timeout: 60000 });
    } catch {
      const log = existsSync(join(cacheDir, `${hash}.log`)) ? readFileSync(join(cacheDir, `${hash}.log`), 'utf8') : '';
      const err = /^! (.*)$/m.exec(log)?.[1] ?? 'LaTeX failed';
      throw new Error(err);
    }
    execFileSync('dvisvgm', ['--no-fonts', `${hash}.dvi`, '-o', `${hash}.svg`], { cwd: cacheDir, stdio: 'pipe', timeout: 60000 });
  }
  let svg = readFileSync(svgPath, 'utf8').replace(/<\?xml[^>]*>\s*/, '').replace(/<!--.*?-->\s*/gs, '');
  // Scale pt → px and namespace ids so several figures can share one page.
  svg = svg.replace(/width='([\d.]+)pt' height='([\d.]+)pt'/, (_, w, h) => `width='${(+w * scale).toFixed(1)}' height='${(+h * scale).toFixed(1)}'`);
  const p = `lx${uid++}-`;
  svg = svg.replace(/id='([^']+)'/g, `id='${p}$1'`).replace(/href='#([^']+)'/g, `href='#${p}$1'`).replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`);
  return svg;
}

/**
 * Beamer overlays inside a fragment: produce the body as it looks on slide `k`.
 * Handles \only / \visible / \uncover / \onslide{…} and \draw<2-> style specs.
 */
export function overlaySpecs(body: string): Set<number> {
  const out = new Set<number>();
  for (const m of body.matchAll(/<(\d+)(-?)(\d*)>/g)) {
    out.add(+m[1]);
    if (m[3]) out.add(+m[3] + 1);
  }
  return out;
}

export function atSlide(body: string, k: number): string {
  const inRange = (spec: string) => spec.split(',').some((part) => {
    const [a, b] = part.split('-');
    const lo = a === '' ? 1 : +a;
    const hi = b === undefined ? lo : b === '' ? Infinity : +b;
    return k >= lo && k <= hi;
  });
  let s = body;
  // \cmd<spec>{X} with balanced braces (one level of nesting is enough in practice).
  s = s.replace(/\\(only|visible|uncover|onslide)<([^>]*)>\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g,
    (_, _c, spec, inner) => (inRange(spec) ? inner : ''));
  // TikZ path commands with overlay specs: \draw<2-> ... ;
  s = s.replace(/\\(draw|fill|filldraw|path|node|shade|shadedraw|clip|coordinate)<([^>]*)>([^;]*;)/g,
    (_, cmd, spec, rest) => (inRange(spec) ? `\\${cmd}${rest}` : ''));
  return s;
}

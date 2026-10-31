// TeX -> standalone SVG via MathJax, rendered once at build time.
// fontCache 'none' inlines every glyph as its own <path>, which lets the
// runtime animate math stroke-by-stroke (manim's Write).
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const doc = mathjax.document('', {
  InputJax: new TeX({ packages: AllPackages.filter((p: string) => p !== 'bussproofs') }),
  OutputJax: new SVG({ fontCache: 'none' }),
});

const cache = new Map<string, string>();

export function texToSvg(tex: string, display = false): string {
  const key = (display ? 'D:' : 'I:') + tex;
  const hit = cache.get(key);
  if (hit) return hit;
  const node = doc.convert(tex, { display });
  // convert() wraps the <svg> in <mjx-container>; keep only the svg.
  const svg = adaptor.innerHTML(node);
  cache.set(key, svg);
  return svg;
}

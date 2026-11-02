// Deck → single self-contained HTML file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { texToSvg } from './math.ts';
import type { Deck, Slide } from './deck.ts';

const runtimeDir = fileURLToPath(new URL('../runtime/', import.meta.url));
const asset = (f: string) => readFileSync(runtimeDir + f, 'utf8');

const DIGITS = '0123456789.−';

/** TeX glyphs for DecimalNumber, so live counters stay in Computer Modern. */
function glyphTable(): Record<string, { vb: number[]; body: string }> {
  const out: Record<string, { vb: number[]; body: string }> = {};
  for (const ch of DIGITS) {
    const svg = texToSvg(ch === '−' ? '-' : ch);
    const vb = /viewBox="([^"]+)"/.exec(svg)![1].split(/\s+/).map(Number);
    const body = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    out[ch] = { vb, body };
  }
  return out;
}

function header(sl: Slide, d: Deck): string {
  if (sl.plain || (!sl.title && !sl.section)) return '';
  const progress = d.meta.progress ? `<div class="progress"></div>` : '';
  return `<header data-from="0">` +
    (sl.section ? `<div class="eyebrow">${sl.section}${sl.subsection ? `<span class="eyebrow-sub">${sl.subsection}</span>` : ''}</div>` : '') +
    (sl.title ? `<h1 class="ftitle">${sl.title}</h1>` : '') +
    (sl.subtitle ? `<h2 class="fsub">${sl.subtitle}</h2>` : '') +
    progress + `</header>`;
}

function titleSlide(d: Deck): string {
  const m = d.meta;
  const parts = [
    m.titlegraphic && `<div class="t-graphic" data-from="0">${m.titlegraphic}</div>`,
    m.title && `<h1 class="t-title" data-from="0">${m.title}</h1>`,
    `<div class="t-rule" data-from="0"></div>`,
    m.subtitle && `<p class="t-sub" data-from="0">${m.subtitle}</p>`,
    m.author && `<p class="t-author" data-from="0">${m.author}</p>`,
    m.institute && `<p class="t-inst" data-from="0">${m.institute}</p>`,
    m.date && `<p class="t-date" data-from="0">${m.date}</p>`,
  ].filter(Boolean);
  return parts.join('');
}

function footline(sl: Slide, d: Deck): string {
  if (sl.plain || sl.kind !== 'frame' || d.meta.footline !== 'infolines') return '';
  const m = d.meta;
  return `<footer class="infolines"><span>${m.shortAuthor}</span><span>${m.shortTitle}</span><span>${m.shortDate}</span></footer>`;
}

function slideHtml(sl: Slide, d: Deck): string {
  const attrs = [
    `data-steps="${sl.steps}"`,
    sl.covered ? 'data-covered' : '',
    sl.frameNo !== null ? `data-frame="${sl.frameNo}"` : '',
    sl.label ? `data-label="${sl.label.replace(/"/g, '&quot;')}"` : '',
    `data-sec="${sl.sectionIdx}"`,
    sl.transition ? `data-trans="${sl.transition}"` : '',
  ].filter(Boolean).join(' ');
  const notes = sl.notes.length ? `<aside class="notes">${sl.notes.join('<br>')}</aside>` : '';
  if (sl.kind === 'title') return `<section class="slide title-slide" ${attrs}>${titleSlide(d)}${notes}</section>`;
  if (sl.kind === 'section') return `<section class="slide section-slide" ${attrs}>${sl.html}${notes}</section>`;
  const cls = ['slide', sl.plain ? 'plain' : '', sl.standout ? 'standout' : '', sl.align ? `v-${sl.align}` : ''].filter(Boolean).join(' ');
  const fn = sl.footnotes ? `<div class="footnotes">${sl.footnotes}</div>` : '';
  const bg = sl.background ? `<div class="slide-bg">${sl.background}</div>` : '';
  return `<section class="${cls}" ${attrs}>${bg}${header(sl, d)}<div class="body">${sl.html}</div>${fn}${footline(sl, d)}${notes}</section>`;
}

export function emitHtml(deck: Deck, opts: { live?: boolean } = {}): string {
  const slides = deck.slides.map((sl) => slideHtml(sl, deck));
  const m = deck.meta;
  const vars = { '--stage-w': `${m.width}px`, ...m.vars };
  const rootStyle = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');

  const needsGlyphs = deck.scenes.some((s) => s.objects.some((o) => o.kind === 'DecimalNumber'));
  const data = { scenes: deck.scenes, glyphs: needsGlyphs ? glyphTable() : undefined, width: m.width, footline: m.footline, total: m.totalFrames };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const title = deck.meta.title.replace(/<[^>]+>/g, '') || 'Aurora deck';
  const live = opts.live
    ? `<script>new EventSource('/__aurora_events').onmessage = () => location.reload();</script>`
    : '';

  return `<!doctype html>
<html lang="en"${m.theme === 'light' ? ' data-theme="light"' : ''}${m.serif ? ' data-font="serif"' : ''} style="${rootStyle}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="aurora">
<title>${title}</title>
<style>${asset('aurora.css')}
@page { size: ${m.width}px 1080px; margin: 0; }</style>
</head>
<body>
<div id="stage">
${slides.join('\n')}
${m.logo ? `<div class="logo">${m.logo}</div>` : ''}
<div class="pagenum"></div>
</div>
<script type="application/json" id="aurora-data">${json}</script>
<script>${asset('aurora.js')}</script>
${live}
</body>
</html>
`;
}

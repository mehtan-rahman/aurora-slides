import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDeck } from '../src/deck.ts';
import { naturalSize } from '../src/media.ts';
import { latexAvailable } from '../src/latexsvg.ts';

// Tiny fixtures: only the headers matter to Aurora (CRCs are not checked).
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
};
function png(w: number, h: number, dpi?: number): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (dpi) { const p = Buffer.alloc(9); const ppm = Math.round(dpi / 0.0254); p.writeUInt32BE(ppm, 0); p.writeUInt32BE(ppm, 4); p[8] = 1; parts.push(chunk('pHYs', p)); }
  parts.push(chunk('IDAT', Buffer.alloc(0)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
function jpeg(w: number, h: number, dpi: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

let dir = '';
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'aurora-img-'));
  mkdirSync(join(dir, 'figs'));
  writeFileSync(join(dir, 'figs', 'wide.png'), png(400, 200, 144)); // 200 × 100 bp
  writeFileSync(join(dir, 'figs', 'plain.png'), png(300, 150)); // no dpi: 72 → 300 × 150 bp
  writeFileSync(join(dir, 'photo.jpg'), jpeg(600, 300, 300)); // 144 × 72 bp
  writeFileSync(join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"></svg>');
});

const build = (body: string, pre = '') => parseDeck(`\\documentclass{beamer}\\usepackage{graphicx}\\graphicspath{{figs/}}${pre}\\begin{document}${body}\\end{document}`, dir);
const frame = (body: string, pre = '') => build(`\\begin{frame}${body}\\end{frame}`, pre);
const img = (html: string, alt: string) => html.match(new RegExp(`<img[^>]*alt="${alt}"[^>]*>`))?.[0] ?? '';

test('natural image sizes follow the stored resolution, like pdflatex', () => {
  assert.deepEqual(naturalSize(png(400, 200, 144), '.png')!.map(Math.round), [200, 100]);
  assert.deepEqual(naturalSize(png(300, 150), '.png'), [300, 150]);
  assert.deepEqual(naturalSize(jpeg(600, 300, 300), '.jpg')!.map(Math.round), [144, 72]);
  assert.deepEqual(naturalSize(Buffer.from('<svg width="100" height="50">'), '.svg'), [75, 37.5]);
  assert.deepEqual(naturalSize(png(220, 110), '.png', 220)!.map(Math.round), [72, 36]);
});

test('images without a size get their physical size; scale multiplies it', () => {
  const h = frame('\\includegraphics{wide}\\par\\includegraphics[scale=0.5]{photo.jpg}').slides[0].html;
  // 200 bp at 1920 px per 160 mm ≈ 4.23 px/bp.
  assert.match(img(h, 'wide'), /width:847px/);
  assert.match(img(h, 'photo.jpg'), /width:305px/);
});

test('\\textwidth widths, height, keepaspectratio', () => {
  const h = frame('\\centering\\includegraphics[width=0.6\\textwidth]{wide}').slides[0].html;
  assert.match(h, /class="centered"><div class="figwrap"><img[^>]*style="width:60.0%"/);
  const k = frame('\\includegraphics[width=4cm,height=3cm,keepaspectratio]{wide}').slides[0].html;
  assert.match(k, /width:480px;height:360px;object-fit:contain/);
});

test('angle= rotates without being clobbered by animations; sizes after angle size the rotated box', () => {
  const h = frame('\\includegraphics[height=2cm,angle=90]{wide}').slides[0].html;
  assert.match(h, /data-rot style="height:240px;rotate:-90deg"/);
  assert.doesNotMatch(h, /transform:rotate/);
  const after = frame('\\includegraphics[angle=90,height=2cm]{wide}').slides[0].html;
  assert.match(after, /style="width:240px;rotate:-90deg"/);
});

test('trim/clip and viewport crop the image', () => {
  const h = frame('\\includegraphics[width=5cm,trim=50 0 50 0,clip]{wide}').slides[0].html;
  // (PNG stores dpi as pixels per metre, so 144 dpi round-trips to 143.99: compare loosely.)
  const num = (re: RegExp) => +(re.exec(h)?.[1] ?? NaN);
  assert.match(h, /<span class="fig crop"[^>]*style="width:600px;aspect-ratio:[\d.]+\/[\d.]+;overflow:hidden"><img style="position:absolute/);
  assert.ok(Math.abs(num(/aspect-ratio:([\d.]+)\//) / num(/aspect-ratio:[\d.]+\/([\d.]+)/) - 1) < 1e-3, 'trimmed region is square');
  assert.ok(Math.abs(num(/;width:([\d.]+)%/) - 200) < 0.05, 'image is twice the window');
  assert.ok(Math.abs(num(/left:(-[\d.]+)%/) + 50) < 0.05, 'shifted by the left trim');
  const v = frame('\\includegraphics[viewport=50 0 150 100,clip]{wide}').slides[0].html;
  assert.match(v, /class="fig crop"[^>]*style="width:423px;aspect-ratio:[\d.]+\/[\d.]+;overflow:hidden"/);
});

test('\\resizebox and \\scalebox around one image set its size', () => {
  const h = frame('\\resizebox{0.5\\textwidth}{!}{\\includegraphics{wide}}').slides[0].html;
  assert.match(h, /<div class="figwrap"><img[^>]*style="width:50.0%"/);
  const inl = frame('Text \\resizebox{!}{1cm}{\\includegraphics{wide}} more').slides[0].html;
  assert.match(inl, /style="height:120px"/);
  const sc = frame('\\scalebox{0.5}{\\includegraphics{wide}}').slides[0].html;
  assert.match(sc, /width:423px/);
});

test('figure and subfigure labels resolve with \\ref', () => {
  const d = build(`\\begin{frame}\\begin{figure}\\includegraphics{wide}\\caption{A}\\label{fig:a}\\end{figure}
    \\begin{figure}\\begin{subfigure}{0.4\\textwidth}\\includegraphics{wide}\\caption{x}\\label{fig:x}\\end{subfigure}
    \\begin{subfigure}{0.4\\textwidth}\\includegraphics{wide}\\caption{y}\\label{fig:y}\\end{subfigure}\\caption{B}\\label{fig:b}\\end{figure}
    See \\ref{fig:a}, \\ref{fig:b}, \\ref{fig:y}.\\end{frame}`, '\\usepackage{subcaption}');
  assert.match(d.slides[0].html, /See <span class="ref">1<\/span>, <span class="ref">2<\/span>, <span class="ref">2b<\/span>/);
  assert.equal(d.warnings.length, 0, d.warnings.map((w) => w.message).join('\n'));
});

test('\\usebackgroundtemplate: preamble-wide, or scoped to a group', () => {
  const d = build(`\\begin{frame}A\\end{frame}
    {\\usebackgroundtemplate{\\includegraphics[width=\\paperwidth]{wide}}\\begin{frame}B\\end{frame}}
    \\begin{frame}C\\end{frame}`);
  assert.deepEqual(d.slides.map((s) => !!s.background), [false, true, false]);
  assert.match(d.slides[1].background!, /<img[^>]*width:1920px/);
  const all = build('\\begin{frame}A\\end{frame}\\begin{frame}B\\end{frame}', '\\usebackgroundtemplate{\\includegraphics{wide}}');
  assert.ok(all.slides.every((s) => s.background));
  const tpl = build('{\\setbeamertemplate{background}{\\includegraphics{wide}}\\begin{frame}A\\end{frame}}\\begin{frame}B\\end{frame}');
  assert.deepEqual(tpl.slides.map((s) => !!s.background), [true, false]);
});

test('images inside TikZ are found via \\graphicspath and embedded', { skip: !latexAvailable() && 'latex/dvisvgm not installed' }, () => {
  const d = frame('\\begin{tikzpicture}\\node {\\includegraphics[width=2cm]{photo.jpg}};\\end{tikzpicture}', '\\usepackage{tikz}');
  assert.equal(d.warnings.length, 0, d.warnings.map((w) => w.message).join('\n'));
  assert.match(d.slides[0].html, /xlink:href='data:image\/jpeg;base64,/);
});

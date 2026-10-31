import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../src/deck.ts';

const doc = (body: string, pre = '') => `\\documentclass{beamer}${pre}\\begin{document}${body}\\end{document}`;
const deck = (body: string, pre = '') => parseDeck(doc(body, pre), '.');

test('frame title, subtitle and section eyebrow', () => {
  const d = deck('\\section{Intro}\\begin{frame}{Hello}{World} text \\end{frame}');
  assert.equal(d.slides.length, 1);
  assert.equal(d.slides[0].section, 'Intro');
  assert.equal(d.slides[0].title, 'Hello');
  assert.equal(d.slides[0].subtitle, 'World');
});

test('\\pause creates steps', () => {
  const d = deck('\\begin{frame}A\n\n\\pause B\n\n\\pause C\\end{frame}');
  assert.equal(d.slides[0].steps, 3);
  assert.match(d.slides[0].html, /<p data-from="0">A<\/p>/);
  assert.match(d.slides[0].html, /<p data-from="2">C<\/p>/);
});

test('incremental lists with [<+->]', () => {
  const d = deck('\\begin{frame}\\begin{itemize}[<+->]\\item a \\item b \\item c\\end{itemize}\\end{frame}');
  const froms = [...d.slides[0].html.matchAll(/<li data-from="(\d)"/g)].map((m) => +m[1]);
  assert.deepEqual(froms, [0, 1, 2]);
  assert.equal(d.slides[0].steps, 3);
});

test('explicit overlays compact away gaps', () => {
  const d = deck('\\begin{frame}\\begin{itemize}\\item a \\item<4-> b\\end{itemize}\\end{frame}');
  assert.equal(d.slides[0].steps, 2);
  assert.match(d.slides[0].html, /<li data-from="1">/);
});

test('\\only produces a bounded range', () => {
  const d = deck('\\begin{frame}x \\only<2>{y} z\\end{frame}');
  assert.match(d.slides[0].html, /class="ov only" data-from="1" data-until="2"/);
});

test('inline formatting and math', () => {
  const d = deck('\\begin{frame}\\textbf{b} \\emph{e} $x^2$ -- ``q``\\end{frame}');
  const h = d.slides[0].html;
  assert.match(h, /<strong>b<\/strong>/);
  assert.match(h, /<em>e<\/em>/);
  assert.match(h, /<span class="m"><svg/);
  assert.match(h, /–/);
});

test('display math is marked for Write', () => {
  const d = deck('\\begin{frame}\\[ a=b \\]\\end{frame}');
  assert.match(d.slides[0].html, /class="dmath" data-anim="write"/);
});

test('user macros expand in text', () => {
  const d = deck('\\begin{frame}\\hi{Bob}\\end{frame}', '\\newcommand{\\hi}[1]{Hello #1}');
  assert.match(d.slides[0].html, /Hello Bob/);
});

test('titlepage frame becomes a title slide with metadata', () => {
  const d = deck('\\begin{frame}\\titlepage\\end{frame}', '\\title{T}\\author{A}');
  assert.equal(d.slides[0].kind, 'title');
  assert.equal(d.meta.title, 'T');
  assert.equal(d.meta.author, 'A');
});

test('scene objects, events and shared step counter', () => {
  const d = deck(`\\begin{frame}
    \\begin{scene}[size={10,5}]
      \\Axes[id=ax, x={0,1,0.5}]
      \\pause
      \\Plot[on=ax, color=blue]{sin(x)}
      \\MathTex[at={0,1}, with]{x^2}
      \\ValueTracker[id=t, value=0]
      \\pause
      \\Animate[t=1, run=2]
    \\end{scene}
  \\end{frame}`);
  const sc = d.scenes[0];
  assert.deepEqual(sc.size, [10, 5]);
  assert.equal(d.slides[0].steps, 3);
  assert.deepEqual(sc.events.map((e) => [e.type, e.step]), [['intro', 0], ['intro', 1], ['intro', 1], ['animate', 2]]);
  assert.equal(sc.objects[1].text, 'sin(x)');
  assert.equal(sc.objects[1].props.color, 'var(--blue)');
  assert.match(sc.objects[2].svg!, /^<svg/);
  assert.equal(sc.events[2].with, true);
  assert.deepEqual(sc.events[3].targets, { t: '1' });
});

test('scene indices are global across frames', () => {
  const d = deck('\\begin{frame}\\begin{scene}\\Dot[]\\end{scene}\\end{frame}\\begin{frame}\\begin{scene}\\Dot[]\\end{scene}\\end{frame}');
  assert.match(d.slides[1].html, /data-scene="1"/);
});

test('definecolor maps to hex', () => {
  const d = deck('\\begin{frame}\\textcolor{acc}{x}\\end{frame}', '\\definecolor{acc}{HTML}{FF0000}');
  assert.match(d.slides[0].html, /color:#FF0000/);
});

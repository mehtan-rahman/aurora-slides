import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../src/deck.ts';
import { emitHtml } from '../src/emit.ts';

const deck = (body: string, pre = '') => parseDeck(`\\documentclass{beamer}${pre}\\begin{document}${body}\\end{document}`, '.');
const parts = (notes: string[]) => notes.map((n) => /<div class="note-part"([^>]*)>/.exec(n)?.[1] ?? '?');

test('\\note<n>{…} is shown on its steps only, and counts as a step (as in Beamer)', () => {
  const d = deck(`\\begin{frame}{A}\\begin{itemize}\\item<1-> a \\item<2-> b\\end{itemize}
    \\note{always}\\note<2>{only two}\\note<3->{three on}\\end{frame}`);
  const s = d.slides[0];
  assert.deepEqual(parts(s.notes), ['', ' data-from="1" data-until="2"', ' data-from="2"']);
  assert.equal(s.steps, 3, 'the <3-> note adds slide 3, like Beamer');
  assert.equal(deck('\\begin{frame}x\\note<2>{n}\\end{frame}').slides[0].steps, 2);
});

test('notes after a frame, \\note[item] and pdfpc\'s \\pdfpcnote', () => {
  const d = deck(`\\begin{frame}{A}\\item<1-> a \\item<2-> b \\item<3-> c\\end{frame}
    \\note<2-3>{later}\\note[item]{bullet}
    \\begin{frame}{B}x\\pdfpcnote{from pdfpc}\\end{frame}`);
  assert.deepEqual(parts(d.slides[0].notes), [' data-from="1" data-until="3"', '']);
  assert.match(d.slides[0].notes[1], /<ul class="note-items"><li>bullet<\/li><\/ul>/);
  assert.match(d.slides[1].notes[0], /from pdfpc/);
});

test('talk length for the speaker view countdown: \\auroraduration or pdfpc\'s duration=', () => {
  assert.equal(deck('\\begin{frame}x\\end{frame}', '\\auroraduration{20}').meta.duration, 20);
  assert.equal(deck('\\begin{frame}x\\end{frame}', '\\pdfpcsetup{duration=25, last minutes=5}').meta.duration, 25);
  assert.equal(deck('\\begin{frame}x\\end{frame}').meta.duration, undefined);
  const html = emitHtml(deck('\\begin{frame}x\\note{n}\\end{frame}', '\\auroraduration{12.5}'));
  assert.match(html, /"duration":12.5/);
  assert.match(html, /<aside class="notes"><div class="note-part"><p>n<\/p><\/div><\/aside>/);
});

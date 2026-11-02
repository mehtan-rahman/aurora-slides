import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBib, parseNames, authorShort, year, formatEntry, type BibEntry } from '../src/bib.ts';

const tex = (s: string) => s.replace(/[{}]/g, '');

test('parseBib: braces, quotes, numbers, @string, #, comments, CRLF', () => {
  const src = [
    '% junk before',
    '@String{jacs = "J. Am. Chem. Soc."}',
    '@comment{ignored @article{nope, title={x}} }',
    '@PREAMBLE{ "\\newcommand{\\foo}{}" }',
    'some junk text',
    '@Article{smith2020,',
    '  Author = {Smith, John and Jones, B.},',
    '  title = {The {DNA} of {nested {braces}}},',
    '  journal = jacs # " Lett.",',
    '  year = 2020,',
    '  month = mar,',
    '  note = "a {"} quote",',
    '}',
    '@book(knuth, title = {TeX}, )',
  ].join('\r\n');
  const bib = parseBib(src);
  assert.deepEqual(bib.map((e) => e.key), ['smith2020', 'knuth']);
  const a = bib[0];
  assert.equal(a.type, 'article');
  assert.equal(a.fields.author, 'Smith, John and Jones, B.');
  assert.equal(a.fields.title, 'The {DNA} of {nested {braces}}');
  assert.equal(a.fields.journal, 'J. Am. Chem. Soc. Lett.');
  assert.equal(a.fields.year, '2020');
  assert.equal(a.fields.month, 'March');
  assert.equal(a.fields.note, 'a {"} quote');
  assert.equal(bib[1].type, 'book');
  assert.equal(bib[1].fields.title, 'TeX');
});

test('parseBib: malformed entries are skipped without throwing', () => {
  const src = `
@article{bad1, title = {unclosed
@misc{good1, title = {Fine}}
@article{bad2 title = {no comma}}
@misc{good2, title = "ok", year = 1999}
@{nokey}
@misc{bad3, = {x}}
@misc{good3}`;
  const bib = parseBib(src);
  assert.deepEqual(bib.map((e) => e.key), ['good1', 'good2', 'good3']);
  assert.doesNotThrow(() => parseBib('@@@{{{"""'));
  assert.deepEqual(parseBib(''), []);
});

test('parseNames: forms, von, Jr, braced corporate authors', () => {
  const ns = parseNames('Knuth, Donald E. and Ludwig van Beethoven and {Barnes and Noble} and de la Fontaine, Jean and Ford, Jr., Henry and Alan Mathison Turing');
  assert.equal(ns.length, 6);
  assert.deepEqual(ns[0], { first: 'Donald E.', last: 'Knuth', von: '', jr: '' });
  assert.deepEqual(ns[1], { first: 'Ludwig', last: 'Beethoven', von: 'van', jr: '' });
  assert.deepEqual(ns[2], { first: '', last: '{Barnes and Noble}', von: '', jr: '' });
  assert.deepEqual(ns[3], { first: 'Jean', last: 'Fontaine', von: 'de la', jr: '' });
  assert.deepEqual(ns[4], { first: 'Henry', last: 'Ford', von: '', jr: 'Jr.' });
  assert.deepEqual(ns[5], { first: 'Alan Mathison', last: 'Turing', von: '', jr: '' });
  assert.deepEqual(parseNames('John von Neumann')[0], { first: 'John', last: 'Neumann', von: 'von', jr: '' });
});

const entry = (type: string, fields: Record<string, string>, key = 'k'): BibEntry => ({ key, type, fields });

test('authorShort and year', () => {
  assert.equal(authorShort(entry('misc', { author: 'Smith, J.' })), 'Smith');
  assert.equal(authorShort(entry('misc', { author: 'Smith, J. and Jones, B.' })), 'Smith and Jones');
  assert.equal(authorShort(entry('misc', { author: 'Smith, J. and Jones, B. and Lee, C.' })), 'Smith et al.');
  assert.equal(authorShort(entry('misc', { author: 'Smith, J. and others' })), 'Smith et al.');
  assert.equal(authorShort(entry('misc', { author: 'John von Neumann' })), 'von Neumann');
  assert.equal(authorShort(entry('misc', { author: '{World Health Organization}' })), 'World Health Organization');
  assert.equal(authorShort(entry('book', { editor: 'Doe, Jane' })), 'Doe');
  assert.equal(authorShort(entry('misc', { title: 'A {DNA} story' })), 'A DNA story');
  assert.equal(authorShort(entry('misc', {}, 'key1')), 'key1');
  assert.equal(year(entry('misc', { year: '2020' })), '2020');
  assert.equal(year(entry('misc', { date: '2021-05-01' })), '2021');
  assert.equal(year(entry('misc', {})), '');
});

test('formatEntry: article', () => {
  const [e] = parseBib(`@article{a, author = {Alan Mathison Turing and Jean-Paul Sartre and Lee, Christine},
    title = {On {Computable} Numbers}, journal = {Proc. LMS}, volume = 42, number = 3, pages = {230--265},
    year = 1936, doi = {10.1112/plms/s2-42.1.230}}`);
  const html = formatEntry(e, tex);
  assert.equal(html,
    '<span class="bib-author">A. M. Turing, J.-P. Sartre, and C. Lee</span>. ' +
    '<span class="bib-title">On Computable Numbers</span>. ' +
    '<span class="bib-venue"><em>Proc. LMS</em> 42(3):230–265</span>, <span class="bib-year">1936</span>. ' +
    '<a class="bib-link" href="https://doi.org/10.1112/plms/s2-42.1.230" target="_blank">doi:10.1112/plms/s2-42.1.230</a>');
});

test('formatEntry: inproceedings, book, misc', () => {
  const ip = formatEntry(entry('inproceedings', { author: 'Vaswani, Ashish and Shazeer, Noam', title: 'Attention is all you need', booktitle: 'NeurIPS', pages: '5998-6008', year: '2017' }), tex);
  assert.match(ip, /<span class="bib-author">A. Vaswani and N. Shazeer<\/span>/);
  assert.match(ip, /<span class="bib-venue">In <em>NeurIPS<\/em>, 5998–6008<\/span>, <span class="bib-year">2017<\/span>\.$/);

  const bk = formatEntry(entry('book', { author: 'Knuth, Donald E.', title: 'The {\\TeX}book', publisher: 'Addison-Wesley', year: '1984' }), tex);
  assert.match(bk, /D\. E\. Knuth/);
  assert.match(bk, /<span class="bib-title">The \\TeXbook<\/span>/);
  assert.match(bk, /<span class="bib-venue">Addison-Wesley<\/span>/);

  const mc = formatEntry(entry('misc', { author: 'Doe, J.', title: 'Preprint?', eprint: '2101.00001', archiveprefix: 'arXiv', url: 'https://example.com/a?b=1&c="2"', year: '2021' }), tex);
  assert.match(mc, /Preprint\?<\/span> <span class="bib-venue">arXiv:2101.00001<\/span>/);
  assert.match(mc, /href="https:\/\/example.com\/a\?b=1&amp;c=&quot;2&quot;"/);

  const many = formatEntry(entry('misc', { author: 'A, A and B, B and C, C and D, D and E, E and F, F and G, G', title: 'T' }), tex);
  assert.match(many, /F\. F et al\./);
  assert.doesNotMatch(many, /G\. G/);
});

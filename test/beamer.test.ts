// Beamer compatibility: overlays, document structure, content environments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDeck } from '../src/deck.ts';
import { loadSource, stripCommentsMapped } from '../src/preprocess.ts';
import { Steps } from '../src/overlay.ts';

const doc = (body: string, pre = '') => `\\documentclass{beamer}${pre}\\begin{document}${body}\\end{document}`;
const deck = (body: string, pre = '') => parseDeck(doc(body, pre), '.');
const frame = (body: string, pre = '') => deck(`\\begin{frame}${body}\\end{frame}`, pre).slides[0];
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- fidelity against real Beamer

test('tour deck: per-frame slide counts match pdflatex/beamer', () => {
  // From the .nav file of `pdflatex examples/tour/deck.tex` (beamer 3.x).
  const beamer = [1, 1, 1, 6, 3, 4, 3, 1, 1, 3, 1, 1, 2, 4, 4, 1, 3, 1, 1, 1, 1, 1, 1];
  const path = join(root, 'examples/tour/deck.tex');
  const d = parseDeck(loadSource(path), dirname(path), { mainFile: 'deck.tex' });
  assert.deepEqual(d.slides.map((s) => s.steps), beamer);
});

// ---------------------------------------------------------------- overlay specifications

test('overlay specs: + shares one value per spec, offsets, dot', () => {
  const s = new Steps();
  const a = s.spec('+-| alert@+');
  assert.deepEqual(a.vis, { from: 1 });
  assert.deepEqual(a.alert, { from: 1, until: 2 });
  assert.deepEqual(s.spec('+(1)-').vis, { from: 3 });
  assert.deepEqual(s.spec('.-').vis, { from: 2 });
});

test('overlay specs: multiple ranges and mode prefixes', () => {
  const s = new Steps();
  assert.deepEqual(s.spec('1,3-4').vis, { from: 1, on: [[1, 2], [3, 5]] });
  assert.deepEqual(s.spec('-2').vis, { from: 1, until: 3 });
  assert.deepEqual(s.spec('beamer:2-|handout:0').vis, { from: 2 });
  assert.deepEqual(s.spec('handout:1').vis, null);
});

test('handout mode collapses every frame to one step', () => {
  const d = parseDeck(doc('\\begin{frame}a\\pause b \\only<3>{c}\\uncover<2>{d}\\end{frame}').replace('{beamer}', '[handout]{beamer}'), '.');
  assert.equal(d.slides[0].steps, 1);
  assert.equal(d.meta.handout, true);
});

test('<1,3> renders as data-on intervals', () => {
  const sl = frame('\\begin{itemize}\\item<1,3> x \\item<2> y \\item<3> z\\end{itemize}');
  assert.match(sl.html, /data-on="0:1 2:3"/);
  assert.equal(sl.steps, 3);
});

test('item alert@ specs mark list items', () => {
  const sl = frame('\\begin{itemize}[<+-| alert@+>]\\item a \\item b\\end{itemize}');
  assert.match(sl.html, /<li class="fx fx-alert" data-from="0" data-fxclass="fx-alert" data-fx-from="0" data-fx-until="1">/);
  assert.match(sl.html, /<li class="fx fx-alert" data-from="1" data-fxclass="fx-alert" data-fx-from="1">/);
});

test('ends of intervals do not add trailing empty steps', () => {
  assert.equal(frame('\\only<1>{a}\\only<2>{b}').steps, 2);
  assert.equal(frame('\\begin{overprint}\\onslide<1>a\\onslide<2>b\\end{overprint}').steps, 2);
});

test('block-level \\only swaps images and lists', () => {
  const sl = frame('\\only<1>{\\begin{itemize}\\item a\\end{itemize}}\\only<2>{\\begin{itemize}\\item b\\end{itemize}}');
  assert.match(sl.html, /<div class="ovb only" data-from="0" data-until="1"><ul data-from="0" data-until="1">/);
  assert.match(sl.html, /<div class="ovb only" data-from="1">/);
});

test('\\alt, \\temporal and \\invisible', () => {
  const alt = frame('\\alt<2>{yes}{no}').html;
  assert.match(alt, /<span class="ov only" data-from="1" data-until="2">yes<\/span><span class="ov only" data-from="0" data-on="0:1 2:">no<\/span>/);
  const tmp = frame('\\temporal<2>{before}{during}{after} \\pause x \\pause y').html;
  assert.match(tmp, /data-from="0" data-until="1">before/);
  assert.match(tmp, /data-from="2">after/);
  assert.match(frame('\\invisible<2>{hidden} \\pause x').html, /data-from="0" data-on="0:1 2:"|data-from="0" data-until="1"/);
});

test('bare \\onslide<n-> switch applies to following content', () => {
  const sl = frame('a\n\n\\onslide<3->\nlater\n\n\\onslide\nalways');
  assert.match(sl.html, /<p data-from="1">later<\/p>/);
  assert.match(sl.html, /<p data-from="0">always<\/p>/);
});

test('overlay-aware text commands: \\textbf<2>, \\textcolor<2>', () => {
  const h = frame('\\textbf<2>{b} \\textcolor<3>{red}{r}').html;
  assert.match(h, /<span class="fx fx-bold" data-fx-from="1" data-fx-until="2">b<\/span>/);
  assert.match(h, /class="fx fx-color" style="--fx:var\(--red\)" data-fx-from="2">/);
});

test('overlays inside display maths become per-step layers', () => {
  const sl = frame('\\[ x \\only<2>{+ y} \\alert<3>{= z} \\]');
  assert.equal(sl.steps, 3);
  const layers = sl.html.match(/class="layer"/g) ?? [];
  assert.ok(layers.length >= 3);
  assert.match(sl.html, /data-anim="write"/);
  assert.match(sl.html, /data-anim="swap"/);
});

test('\\pause inside TikZ keeps one bounding box (hidden parts drawn transparent)', async () => {
  const { atSlide, resolveRelative } = await import('../src/overlay.ts');
  const s = new Steps();
  const r = resolveRelative('\\begin{tikzpicture}\\draw (0,0);\\pause\\draw (1,1);\\end{tikzpicture}', s);
  const one = atSlide(r, 1, 'tikz');
  assert.match(one, /\\begin\{scope\}\[opacity=0\]\\draw \(1,1\);\\end\{scope\}\\end\{tikzpicture\}/);
  assert.doesNotMatch(atSlide(r, 2, 'tikz'), /opacity=0/);
  assert.equal(s.cur, 2);
});

// ---------------------------------------------------------------- preprocessing

test('comments are kept inside verbatim and \\verb, dropped elsewhere', () => {
  const { text } = stripCommentsMapped('a % gone\n\\begin{lstlisting}\nx = 5 % 2\n\\end{lstlisting}\n\\verb|100%| b');
  assert.match(text, /x = 5 % 2/);
  assert.match(text, /\\verb\|100%\|/);
  assert.doesNotMatch(text, /gone/);
});

test('comment environments and \\iffalse blocks are removed', () => {
  const { text } = stripCommentsMapped('a\\begin{comment}secret\\end{comment}b\\iffalse hidden \\ifx x\\fi more\\fi c');
  assert.equal(text, 'ab c');
});

test('\\mode<article> content is dropped, \\mode<presentation> kept', () => {
  const d = deck('\\mode<article>{\\begin{frame}article\\end{frame}}\\mode<presentation>{\\begin{frame}talk\\end{frame}}');
  assert.equal(d.slides.length, 1);
  assert.match(d.slides[0].html, /talk/);
});

test('\\input files are spliced in and diagnostics point into them', () => {
  const path = join(root, 'examples/tour/deck.tex');
  const src = loadSource(path);
  assert.ok(src.files.some((f) => f.endsWith('sections/overlays.tex')));
  const at = src.text.indexOf('TikZ with overlays');
  assert.equal(src.origin(at).file, 'sections/overlays.tex');
});

// ---------------------------------------------------------------- structure

test('sections, subsections and \\tableofcontents[currentsection]', () => {
  const d = deck('\\section{A}\\subsection{A1}\\begin{frame}\\tableofcontents[currentsection]\\end{frame}\\section{B}\\begin{frame}x\\end{frame}');
  const h = d.slides[0].html;
  assert.match(h, /<ol class="toc">/);
  assert.match(h, /<li class="current"[^>]*><a class="jump" data-goto="sec:1">A<\/a><ul><li>A1<\/li><\/ul>/);
  assert.match(h, /<li class="shaded"[^>]*><a class="jump" data-goto="sec:2">B<\/a>/);
  assert.equal(d.slides[0].subsection, 'A1');
  assert.equal(d.slides[1].sectionIdx, 2);
});

test('\\AtBeginSection in the preamble inserts a frame per section', () => {
  const d = deck('\\section{A}\\begin{frame}x\\end{frame}\\section*{Star}\\begin{frame}y\\end{frame}', '\\AtBeginSection[]{\\begin{frame}{Outline}\\tableofcontents[currentsection]\\end{frame}}');
  assert.deepEqual(d.slides.map((s) => s.title), ['Outline', undefined, undefined]);
});

test('metropolis themes get section pages; [standout] frames', () => {
  const d = deck('\\section{Intro}\\begin{frame}[standout]Thanks\\end{frame}', '\\usetheme{metropolis}');
  assert.equal(d.slides[0].kind, 'section');
  assert.match(d.slides[0].html, /<h1>Intro<\/h1>/);
  assert.equal(d.slides[1].standout, true);
});

test('frame options: label, plain, alignment, noframenumbering, \\againframe', () => {
  const d = deck('\\begin{frame}[label=key,c]{K}a\\pause b\\end{frame}\\begin{frame}[plain,noframenumbering]p\\end{frame}\\againframe{key}');
  assert.equal(d.slides[0].label, 'key');
  assert.equal(d.slides[0].align, 'c');
  assert.equal(d.slides[1].plain, true);
  assert.equal(d.slides[1].frameNo, null);
  assert.equal(d.slides[2].title, 'K');
  assert.equal(d.slides[2].steps, 2);
  assert.equal(d.meta.totalFrames, 1);
});

test('aspect ratio from the class options', () => {
  const d = parseDeck(doc('\\begin{frame}x\\end{frame}').replace('{beamer}', '[aspectratio=43]{beamer}'), '.');
  assert.equal(d.meta.width, 1440);
});

test('\\hyperlink, \\hypertarget and buttons', () => {
  const h = frame('\\hyperlink{key}{\\beamergotobutton{Go}} \\hypertarget{t}{here}').html;
  assert.match(h, /<a class="jump" data-goto="key"><span class="button">→ Go<\/span><\/a>/);
  assert.match(h, /data-target="t"/);
});

test('notes: \\note[item], and \\note after a frame', () => {
  const d = deck('\\begin{frame}x\\note[item]{one}\\end{frame}\\note{after}');
  assert.equal(d.slides[0].notes.length, 2);
  assert.match(d.slides[0].notes[0], /note-items/);
  assert.match(d.slides[0].notes[1], /after/);
});

test('footnotes collect at the bottom of the frame', () => {
  const sl = frame('Text\\footnote{A note.} more');
  assert.match(sl.html, /<sup class="fnmark">1<\/sup>/);
  assert.match(sl.footnotes, /<div class="fnote" data-from="0"><sup>1<\/sup> A note.<\/div>/);
});

test('title metadata: short forms, \\and, \\inst', () => {
  const d = deck('\\titlepage', '\\title[Short]{Long Title}\\author[A \\and B]{Ann\\inst{1} \\and Bob\\inst{2}}\\date[D]{Long date}');
  assert.equal(d.meta.shortTitle, 'Short');
  assert.equal(d.meta.shortAuthor, 'A, B');
  assert.match(d.meta.author, /<span class="t-person">Ann<sup>1<\/sup><\/span><span class="t-person">Bob<sup>2<\/sup><\/span>/);
  assert.equal(d.meta.shortDate, 'D');
});

test('theme colours: \\setbeamercolor and \\usecolortheme[named=…]', () => {
  const d = deck('\\begin{frame}x\\end{frame}', '\\setbeamercolor{alerted text}{fg=teal}\\usecolortheme[named=purple]{structure}');
  assert.equal(d.meta.vars['--alert'], 'var(--teal)');
  assert.equal(d.meta.vars['--accent'], 'var(--purple)');
});

// ---------------------------------------------------------------- content

test('numbered equations, \\label and \\eqref', () => {
  const sl = frame('See \\eqref{e}.\\begin{equation}a=b\\label{e}\\end{equation}\\begin{align}x&=1\\\\y&=2\\notag\\end{align}');
  assert.match(sl.html, /See <span class="ref">\(1\)<\/span>/);
  const d = deck('\\begin{frame}\\begin{equation*}q\\end{equation*}\\begin{align}a\\\\b\\end{align}\\end{frame}');
  assert.ok(d.warnings.length === 0);
});

test('theorems: Beamer defaults, \\newtheorem, numbering, proof', () => {
  const sl = frame('\\begin{theorem}[Big]T\\end{theorem}\\begin{conj}C\\end{conj}\\begin{proof}P\\end{proof}', '\\newtheorem{conj}[theorem]{Conjecture}\\setbeamertemplate{theorems}[numbered]');
  assert.match(sl.html, /<div class="box-title">Theorem 1 \(Big\)<\/div>/);
  assert.match(sl.html, /<div class="box-title">Conjecture 2<\/div>/);
  assert.match(sl.html, /box-proof[\s\S]*box-body qed/);
});

test('\\newenvironment and optional-argument macros', () => {
  const sl = frame('\\begin{tip}[Hint]body\\end{tip} \\greet \\greet[Bo]', '\\newenvironment{tip}[1][Tip]{\\begin{block}{#1}}{\\end{block}}\\newcommand{\\greet}[1][world]{Hi #1.}');
  assert.match(sl.html, /<div class="box-title">Hint<\/div>/);
  assert.match(sl.html, /Hi world\. Hi Bo\./);
});

test('enumerate labels: enumerate package and enumitem', () => {
  assert.match(frame('\\begin{enumerate}[(a)]\\item x\\item y\\end{enumerate}').html, /data-label="\(b\)"/);
  assert.match(frame('\\begin{enumerate}[label=\\Roman*.]\\item x\\item y\\end{enumerate}').html, /data-label="II\."/);
});

test('\\column command form and column alignment', () => {
  const h = frame('\\begin{columns}\\column{0.3\\textwidth} L \\column[b]{0.6\\textwidth} R\\end{columns}').html;
  assert.match(h, /flex:0 1 30\.0%"/);
  assert.match(h, /flex:0 1 60\.0%;align-self:flex-end/);
});

test('tables: multirow, multicolumn, rowcolor, cellcolor, vertical rules, header rows', () => {
  const h = frame('\\begin{tabular}{l|c}\\toprule\\multirow{2}{*}{M} & \\multicolumn{1}{c}{E}\\\\ & x\\\\\\midrule\\rowcolor{blue!20} a & \\cellcolor{red}b\\\\\\bottomrule\\end{tabular}').html;
  assert.match(h, /<th rowspan="2" style="border-right:1px solid var\(--muted\);text-align:left">M<\/th>/);
  assert.match(h, /style="background:color-mix\(in srgb, var\(--blue\) 20%, var\(--bg\)\)"/);
  assert.match(h, /background:var\(--red\)/);
  assert.match(h, /<tr class="rule-mid"/);
});

test('listings: language highlighting, numbers, highlightlines, \\lstset defaults', () => {
  const h = frame('\\begin{lstlisting}\ndef f():\n    return 1\n\\end{lstlisting}', '\\lstset{language=Python,numbers=left}').html;
  assert.match(h, /<span class="tk-kw">def<\/span>/);
  assert.match(h, /class="code numbered lang-python"/);
  assert.match(h, /data-n="2"/);
  const m = frame('\\begin{minted}[highlightlines=2]{c}\nint a;\nint b;\n\\end{minted}').html;
  assert.match(m, /<span class="line hl"><span class="tk-ty">int<\/span> b;<\/span>/);
});

test('semiverbatim keeps \\alert<2> and \\pause working', () => {
  const sl = frame('\\begin{semiverbatim}\nx \\alert<2>{y}\n\\pause\nz \\{\\}\n\\end{semiverbatim}');
  assert.match(sl.html, /class="fx fx-alert"/);
  assert.match(sl.html, /z \{\}/);
  assert.equal(sl.steps, 2);
});

test('inline text features: accents, \\hl, \\sout, colour mixing, siunitx, ding', () => {
  const h = frame('G\\"odel \\v{C}ech \\hl{m} \\sout{s} \\textcolor{red!50!black}{c} \\SI{3}{\\meter\\per\\second} \\ding{51}').html;
  assert.match(h, /Gödel Čech/);
  assert.match(h, /<mark>m<\/mark> <s>s<\/s>/);
  assert.match(h, /color-mix\(in srgb, var\(--red\) 50%, var\(--fg\)\)/);
  assert.match(h, /<svg/);
  assert.match(h, /✓/);
});

test('bibliography: thebibliography numbering and \\cite', () => {
  const sl = frame('As in \\cite{b,a}.\\begin{thebibliography}{9}\\bibitem{a} A. Paper.\\bibitem{b} B. Book.\\end{thebibliography}');
  assert.match(sl.html, /As in <span class="cite">\[2, 1\]<\/span>/);
  assert.match(sl.html, /<ol class="bib"/);
});

test('bibliography from a .bib file, author-year with natbib', () => {
  const path = join(root, 'examples/tour/deck.tex');
  const d = parseDeck(loadSource(path), dirname(path), { mainFile: 'deck.tex' });
  const rel = d.slides.find((s) => s.title === 'Related work')!;
  assert.match(rel.html, /Fourier \(1822\)/);
  assert.match(rel.html, /\(see Evans, 2010, ch\.&nbsp;2\)/);
  const refs = d.slides.find((s) => s.title === 'References')!;
  assert.match(refs.html, /Théorie analytique de la chaleur/);
});

test('verbatim keeps % and unknown commands do not crash a frame', () => {
  const d = deck('\\begin{frame}[fragile]\\begin{verbatim}\n50% off \\foo{\n\\end{verbatim}\\end{frame}');
  assert.match(d.slides[0].html, /50% off \\foo\{/);
});

test('multicols, quote, \\centering, \\resizebox around a table', () => {
  const h = frame('\\begin{multicols}{2}a\\end{multicols}\\begin{quote}q\\end{quote}\\resizebox{\\textwidth}{!}{\\begin{tabular}{c}x\\end{tabular}}').html;
  assert.match(h, /class="multicols" style="column-count:2"/);
  assert.match(h, /<blockquote class="quote"/);
  assert.match(h, /<div class="fitwidth">/);
  assert.match(frame('\\centering text').html, /<div class="centered"><p/);
});

test('every `aurora init` template parses without warnings', async () => {
  const { readdirSync } = await import('node:fs');
  const { initChem } = await import('../src/chem.ts');
  await initChem();
  for (const f of readdirSync(join(root, 'templates')).filter((x) => x.endsWith('.tex'))) {
    const path = join(root, 'templates', f);
    const d = parseDeck(loadSource(path), dirname(path), { mainFile: f });
    assert.deepEqual(d.warnings, [], f);
    assert.ok(d.slides.length > 0, f);
  }
});

# Beamer compatibility

Aurora compiles ordinary Beamer decks. This page lists what it understands, how
each feature looks in the HTML, and where it deliberately differs. Anything not
listed is either rendered from its contents with a warning (`aurora check`
tells you) or, for drawing packages, compiled by your local LaTeX.

The [tour deck](../examples/tour/deck.tex) exercises most of this page. It also
compiles with `pdflatex`, and Aurora reproduces Beamer's slide count for every
frame (the test suite checks this against Beamer's own `.nav` output).

## Document structure

| Beamer | Aurora |
|---|---|
| `\documentclass[aspectratio=43]{beamer}` | Stage size follows `aspectratio` (169, 1610, 149, 141, 54, 43, 32). Without it Aurora uses 16:9, where Beamer uses 4:3. |
| `\documentclass[handout]{beamer}` or `aurora build --handout` | Every frame becomes one step. `<handout:0>` hides content. |
| `\input`, `\include`, `\subfile`, `\import` | Spliced in. Diagnostics point at `file:line`, and `aurora serve` reloads when included files change. |
| `\title[short]{…}`, `\subtitle`, `\author[short]{A \and B}`, `\institute`, `\inst{1}`, `\date[short]{…}`, `\titlegraphic`, `\logo` | Title slide, footline and logo. `\date{}` leaves the date out. Without `\date`, Aurora shows today's date. |
| `\titlepage`, `\maketitle`, `\frame{\titlepage}` | Title slide |
| `\section[short]{…}`, `\subsection`, `\section*` | Eyebrow above each frame title, with the subsection after a ›. Starred sections stay out of the TOC. |
| `\tableofcontents[currentsection, hideallsubsections, pausesections, sections={2-3}, …]` | Numbered outline. Entries are links. |
| `\AtBeginSection[]{…}`, `\AtBeginSubsection`, `\AtBeginPart` | The frame is inserted at each section |
| `\usetheme{metropolis}` (or `moloch`) | Automatic section pages, `[standout]` frames, `progressbar=frametitle` |
| `\usetheme{Madrid}` and other info-line themes, `\useoutertheme{infolines}` | Footline with short author, short title and date |
| `\appendix` with `appendixnumberbeamer` | Backup frames are not counted in the total |
| `\againframe<2->{label}` | Repeats a labelled frame, optionally from a step |
| `\note{…}`, `\note[item]{…}`, `\note` after a frame | Speaker notes (press `s`) |
| `\note<2>{…}`, `\note<3->{…}` | Shown in the speaker view on those steps only. As in Beamer, the overlay counts toward the frame's steps. |
| pdfpc: `\pdfpcnote{…}`, `\pdfpcsetup{duration=20}` | A note, and the talk length for the speaker view's countdown (also `\auroraduration{20}`) |
| `\mode<article>{…}`, `\mode<presentation>{…}` | Article-only material is dropped |
| `comment` environment, `\iffalse … \fi` | Dropped |

## Frames

| Beamer | Aurora |
|---|---|
| `\begin{frame}{Title}{Subtitle}`, `\frametitle`, `\framesubtitle`, `\frame{…}` | Frame header |
| `[t]`, `[c]`, `[b]` | Vertical alignment. Aurora's default is top, where Beamer's is centred, so add `[c]` for centred frames. |
| `[plain]` | No header, footline or logo |
| `[fragile]` | Accepted. It is never needed, because verbatim is always safe. |
| `[label=name]` | Target for `\hyperlink`, `\againframe` and `\ref` |
| `[noframenumbering]` | Not counted |
| `[shrink]`, `[squeeze]`, `[allowframebreaks]` | Aurora shrinks *every* frame whose content would overflow. Frames are never split. |
| `[standout]` (metropolis) | Full-bleed accent frame |
| `\transfade`, `\transdissolve`, … | The slide fades in |
| (none) | As in Beamer, a new slide appears at once. Content revealed by clicks animates, and so do scenes. `\auroraentrance{fade}` in the preamble fades first-step content in instead. |

## Overlays

The complete overlay specification syntax is supported:
`<2>`, `<2->`, `<-3>`, `<1,3-4>`, `<+->`, `<+(1)->`, `<.->`, `<+-| alert@+>`,
`<beamer:2|handout:0>`. All `+` in one spec share a value, as in Beamer.

| Beamer | Aurora |
|---|---|
| `\pause` (anywhere, including in TikZ) | Next click |
| `\item<2->`, `\begin{itemize}[<+->]`, `[<+-| alert@+>]`, `\item<alert@2>` | Items appear, or are highlighted, on their step |
| `\only<2>{…}`, `\uncover<2->{…}`, `\visible`, `\invisible`, `\onslide<2->{…}` | Inline or block-level: they may wrap images, lists, blocks and equations |
| `\onslide<3->` (bare switch) | Applies to everything after it |
| `\alt<2>{a}{b}`, `\temporal<3>{before}{during}{after}` | Alternatives swap in place |
| `overprint` with `\onslide<n>` parts | Parts swap. Space is reserved for the tallest part. |
| `onlyenv`, `uncoverenv`, `visibleenv`, `invisibleenv`, `altenv`, `actionenv` | Supported |
| `\alert<2>`, `\textbf<2>`, `\textit<2>`, `\textcolor<2>{red}{…}`, `\color<2>`, `\structure<2>` | Styling animates on its step |
| `\setbeamercovered{transparent}` | Future content shows faintly |
| `\includegraphics<2>`, `\hyperlink<2>` | Supported |
| Overlays inside `\[…\]`, `align`, `$…$` | Each step is rendered and the versions cross-fade. `\uncover` keeps space via `\phantom`. |
| Overlays inside TikZ: `\draw<2->`, `\node<3>`, `\only`, `\visible`, `\pause` | Rendered by LaTeX per step. Hidden parts are drawn transparent, so the picture never jumps (Beamer removes them). |

## Text

- Formatting: `\textbf \textit \emph \textsc \texttt \textsf \underline \sout \hl \uline`,
  the declaration forms (`\bfseries`, `{\itshape …}`) and sizes from `\tiny` to `\Huge`.
- Colour: `\textcolor`, `\color`, `\colorbox`, `\fcolorbox`, and xcolor expressions
  (`blue!30`, `red!50!black`, `\definecolor` in HTML/rgb/RGB/gray/cmyk, `\colorlet`).
  Tints such as `blue!20` mix with the page background, so they stay subtle on the
  dark theme.
- Theme colours: `\setbeamercolor{alerted text}{fg=…}` and
  `\setbeamercolor{structure}{fg=…}`/`\usecolortheme[named=…]{structure}` recolour
  alerts and accents (bullets, eyebrows, rules). `\usefonttheme{serif}` switches to a serif face.
- Accents and symbols: `\'e \"o \v{c} \c{c} \H{o} \AA \ss`, `--`, `---`, quotes,
  `\ldots \checkmark \textdegree \euro \copyright`, `\ding{51}`.
- Links: `\url`, `\href`, `\hyperlink`, `\hypertarget`, `\beamerbutton`,
  `\beamergotobutton`, `\beamerreturnbutton`. Internal links jump to the target frame.
- Footnotes: `\footnote`, `\footnotemark`/`\footnotetext`, `\footcite`. They collect at the foot of the frame.
- Units (siunitx): `\SI`, `\si`, `\qty`, `\unit`, `\num`, `\ang`, `\SIrange`, `\qtyrange`, `\numrange`, `\SIlist`.
- Chemistry: `\ce{…}` (mhchem) in text and maths.
- Spacing: `\hfill` (pushes content apart), `\hspace`, `\vspace` (negative too),
  `\vfill`, `\\[1em]`, `\medskip` and the rest.
- Boxes: `\fbox`, `\framebox`, `\makebox`, `\parbox`, `\raisebox`, `\scalebox`,
  `\rotatebox`, `\resizebox{\textwidth}{!}{…}` around tables or figures.
- Your macros: `\newcommand` (with optional arguments), `\renewcommand`,
  `\providecommand`, `\def\x#1{…}`, `\DeclareMathOperator` and `\NewDocumentCommand`
  (m/O arguments). They work in text, maths and scenes. `\newenvironment` also works.

## Blocks and layout

| Beamer | Aurora |
|---|---|
| `block`, `alertblock`, `exampleblock` (with overlays) | Themed boxes |
| `theorem corollary definition definitions fact example examples lemma proof problem solution` | Beamer's predefined environments. `\setbeamertemplate{theorems}[numbered]` numbers them, and `proof` ends with ∎. |
| `\newtheorem{conj}[theorem]{Conjecture}`, `\newtheorem*` | Shared or separate counters |
| `columns` (`[T]`, `[b]`, `[onlytextwidth]`), `column`, `\column{0.5\textwidth}` | Flex columns, with per-column alignment |
| `\centering`, `center`, `flushleft`, `flushright`, `minipage` | Supported |
| `figure`, `table`, `\caption`, `subfigure`, `subtable`, `\subfloat` | Captions and side-by-side panels |
| `quote`, `quotation`, `verse`, `abstract`, `multicols` | Supported |
| `tcolorbox[title=, colback=, colframe=]`, `beamercolorbox`, `mdframed`, `framed` | Boxes |
| `itemize`, `enumerate`, `description`, nested | Lists. Enumerate labels from the `enumerate` package (`[(a)]`, `[i.]`) and enumitem (`label=\alph*)`, `start=3`, `label=--`). |

## Maths

MathJax renders all of amsmath, amssymb, mathtools, physics, braket, cancel, mhchem
and the other standard packages. Display maths is *written* stroke by stroke.

- Unstarred `equation`, `align`, `gather`, `multline`, `flalign`, `alignat` are
  numbered, with `\notag`/`\nonumber`/`\tag` respected. `\label` with
  `\eqref`/`\ref` gives `(n)`.
- `\color{red}` in maths uses the deck palette.

## Tables

`tabular`, `tabularx`, `tabular*`, `longtable`, `array` and `tblr` become native HTML
tables with:

- the `l c r p{} m{} X S` column types, `>{\centering}`, `*{n}{…}`, and `|` vertical rules
- booktabs rules (`\toprule \midrule \bottomrule \cmidrule`), `\hline`, `\cline`
- `\multicolumn`, `\multirow`, `\rowcolor`, `\cellcolor`, `\rowcolors`
- header rows: everything above the first `\midrule`/`\hline`
- `\pause` or `\onslide<n->` at the start of a row, to reveal row by row

## Code

| Beamer | Aurora |
|---|---|
| `lstlisting[language=…, numbers=left, firstline, lastline, caption]`, `\lstset{…}` | Syntax-highlighted listing |
| `minted[linenos, highlightlines={2,4-5}]{lang}`, `\setminted` | Highlighted listing; highlighted lines are tinted |
| `\lstinputlisting{file}`, `\inputminted{lang}{file}`, `\VerbatimInput` | Language guessed from the file extension |
| `\lstinline|…|`, `\mintinline{lang}{…}`, `\verb|…|` | Inline code |
| `verbatim`, `Verbatim` | Plain listing |
| `semiverbatim` | Code that builds up: `\alert<2>{…}`, `\only<3>{…}`, `\pause` and `\\ \{ \}` work inside |

The highlighter covers about 45 languages, including Python, C/C++, Java,
JavaScript/TypeScript, Rust, Go, Julia, R, MATLAB, Haskell, SQL, shell, TeX,
HTML/XML, JSON/YAML and diff. `%` inside any verbatim environment is safe.

## Figures and media

| Beamer | Aurora |
|---|---|
| `\includegraphics[width=, height=, scale=, angle=, page=, keepaspectratio]{…}` | PNG/JPG/SVG/GIF/WebP are embedded. PDF and EPS are rasterised with Ghostscript (`gs`; on macOS, `sips` is the fallback for PDFs). Without a size, an image gets its physical size from its stored dpi (72 if none), as in pdflatex, and `scale=` multiplies that. A size given after `angle=` sizes the rotated box, as in graphicx. |
| `trim=l b r t, clip`, `viewport=llx lly urx ury` | Cropped to that window (bp by default, or any TeX unit) |
| `\resizebox{0.5\textwidth}{!}{\includegraphics{…}}`, `\scalebox{0.5}{…}` | Sets the image's size |
| `\usebackgroundtemplate{…}`, `\setbeamertemplate{background}{…}` | Background behind the frame. Set in the preamble for every frame, or inside `{ … }` for the frames in that group. |
| `\caption` + `\label` in `figure`/`table` (and `subfigure`) | `\ref` gives the figure or table number (`1`, `2b`) |
| `\graphicspath{{figures/}}`, extension-less names | Resolved the way graphicx does |
| Several images in one paragraph, with `\hfill` | Laid out in a row |
| `tikzpicture`, `circuitikz`, `tikzcd`, `forest`, `pgfplots`' `axis`, `\tikz …;` (inline too), `\chemfig`, `algorithm`/`algorithmic`, `\begin{latex}…\end{latex}` | Compiled with your LaTeX (`latex` + `dvisvgm`) to SVG in the deck's colours. `\includegraphics` inside them (a photo in a TikZ node) uses `\graphicspath` and is embedded. |
| `\movie[autostart, loop]{poster}{file.mp4}`, `\includemedia`, `\video{file}` | Embedded `<video>`. Files over 40 MB are linked instead. |
| `\animategraphics[autoplay, loop]{12}{frame-}{0}{59}` | Embedded image sequence. Click it to play or pause. |

## Bibliography

| Beamer | Aurora |
|---|---|
| `thebibliography` + `\bibitem` | Numbered list. `\cite` gives `[n]`. |
| `\bibliography{refs}` or `\addbibresource{refs.bib}` + `\printbibliography` | `.bib` parsed directly; no BibTeX or biber run is needed. Entries are listed in citation order (numeric) or by author (author-year). |
| natbib `\citet \citep \citeauthor \citeyear`, biblatex `\textcite \parencite \autocite \footcite \fullcite`, `[pre][post]` notes, `\nocite{*}` | Numeric or author-year: author-year when natbib is loaded without `numbers` or biblatex uses an authoryear-like style |

## In the browser

Every frame lives in one offline HTML file. `→`/space/click advances, and `←` goes back.
`o` opens the overview, `s` the speaker view (the current slide, a live preview of the next step, this step's notes, a clock and a talk timer), `b`/`w`
blanks the screen black or white, `l` turns on a laser pointer (mirrored to the
speaker window), `12⏎` jumps to slide 12, and `f` goes fullscreen. **Ctrl/⌘-P** prints
one page per frame. `aurora pdf deck.tex` does the same from the command line, and
`--all-steps` gives one page per overlay, like Beamer's PDF. `--notes` adds a notes page after each slide that has notes.

## Known differences

- **Look.** Beamer themes' colour schemes and decorations are not reproduced. Aurora
  keeps its own dark (or `\auroratheme{light}`) look and maps only theme colours,
  info-line footlines and metropolis section pages.
- **Black-ink figures** (PDF plots with black axes) are hard to read on the dark
  theme. Use `\auroratheme{light}`, or export figures with light ink.
- **`[allowframebreaks]`** shrinks instead of splitting. For a long bibliography, use
  several frames.
- **TikZ `remember picture, overlay`** (absolute page positions, `\tikzmark`) is
  not supported.
- **Overlays inside `lstlisting`** (`escapeinside`) are not supported. Use
  `semiverbatim` for code that builds up.
- **`\pause` inside `align`** works only for rows without alignment points. Prefer
  `\only`/`\uncover` per row.
- **Fonts.** Text uses the system sans-serif (or serif with `\usefonttheme{serif}`).
  Maths is always Computer Modern.

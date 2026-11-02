// BibTeX / biblatex parsing and compact HTML formatting of references.

export interface BibEntry { key: string; type: string; fields: Record<string, string> }
export interface BibName { first: string; last: string; von: string; jr: string }

const MONTHS: Record<string, string> = {
  jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June',
  jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December',
};

class BibError extends Error {}

/** Parse a .bib source. Malformed entries are skipped; never throws. */
export function parseBib(src: string): BibEntry[] {
  const s = src.replace(/\r\n?/g, '\n');
  const out: BibEntry[] = [];
  const macros: Record<string, string> = { ...MONTHS };
  let i = 0;
  const n = s.length;

  const ws = () => { while (i < n && /\s/.test(s[i])) i++; };
  const ident = (): string => {
    const m = /^[^\s"#%'(),={}@]+/.exec(s.slice(i, i + 200));
    if (!m) throw new BibError('identifier expected');
    i += m[0].length;
    return m[0];
  };
  // Reads a balanced {...} group starting at s[i] === '{'; returns the inside.
  const braced = (): string => {
    let depth = 0;
    const start = i;
    for (; i < n; i++) {
      if (s[i] === '\\') { i++; continue; }
      if (s[i] === '{') depth++;
      else if (s[i] === '}' && --depth === 0) { i++; return s.slice(start + 1, i - 1); }
    }
    throw new BibError('unbalanced braces');
  };
  const quoted = (): string => {
    let depth = 0;
    const start = ++i;
    for (; i < n; i++) {
      const c = s[i];
      if (c === '\\') { i++; continue; }
      if (c === '{') depth++;
      else if (c === '}') { if (--depth < 0) throw new BibError('unbalanced braces'); }
      else if (c === '"' && depth === 0) { i++; return s.slice(start, i - 1); }
    }
    throw new BibError('unterminated string');
  };
  const value = (): string => {
    let v = '';
    for (;;) {
      ws();
      const c = s[i];
      if (c === '{') v += braced();
      else if (c === '"') v += quoted();
      else if (c !== undefined && /\d/.test(c)) { const m = /^\d+/.exec(s.slice(i))!; v += m[0]; i += m[0].length; }
      else {
        const id = ident().toLowerCase();
        v += macros[id] ?? '';
      }
      ws();
      if (s[i] === '#') { i++; continue; }
      return v;
    }
  };
  // Parse `name = value` pairs until the closing delimiter.
  const fields = (close: string): Record<string, string> => {
    const f: Record<string, string> = {};
    for (;;) {
      ws();
      if (s[i] === close) { i++; return f; }
      if (s[i] === ',') { i++; continue; }
      if (i >= n) throw new BibError('unterminated entry');
      const name = ident().toLowerCase();
      ws();
      if (s[i] !== '=') throw new BibError('= expected');
      i++;
      const v = value();
      f[name] = v.replace(/\s+/g, ' ').trim();
      ws();
      if (s[i] !== ',' && s[i] !== close) throw new BibError(', expected');
    }
  };

  while (i < n) {
    const at = s.indexOf('@', i);
    if (at < 0) break;
    i = at + 1;
    try {
      ws();
      const type = ident().toLowerCase();
      ws();
      const open = s[i];
      if (open !== '{' && open !== '(') {
        if (type === 'comment') continue;
        throw new BibError('{ expected');
      }
      const close = open === '{' ? '}' : ')';
      if (type === 'comment' || type === 'preamble') {
        if (open === '{') braced();
        else { const e = s.indexOf(')', i); i = e < 0 ? n : e + 1; }
        continue;
      }
      i++;
      if (type === 'string') {
        const f = fields(close);
        Object.assign(macros, f);
        continue;
      }
      ws();
      const km = /^[^\s,{}()"#=]*/.exec(s.slice(i))!;
      const key = km[0];
      i += key.length;
      ws();
      if (s[i] === close) { i++; out.push({ key, type, fields: {} }); continue; }
      if (s[i] !== ',') throw new BibError(', expected after key');
      i++;
      const f = fields(close);
      out.push({ key, type, fields: f });
    } catch (err) {
      if (!(err instanceof BibError)) throw err;
      i = at + 1; // resume scanning after the bad entry's '@'
    }
  }
  return out;
}

// ---------------------------------------------------------------- names

/** Split `s` on a separator regex at brace depth 0. */
function splitTop(s: string, sep: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0, last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0) {
      sep.lastIndex = i;
      const m = sep.exec(s);
      if (m && m.index === i) {
        parts.push(s.slice(last, i));
        last = i + m[0].length;
        i = last - 1;
      }
    }
  }
  parts.push(s.slice(last));
  return parts;
}

/** BibTeX "von" test: first letter at brace depth 0 is lower-case. */
function isVon(w: string): boolean {
  let depth = 0;
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    if (c === '{') {
      // {\x ...} special character at depth 0: look at its first letter after the command
      if (depth === 0 && w[i + 1] === '\\') {
        const m = /^\{\\(?:[a-zA-Z]+|.)\s*\{?\s*([a-zA-Z])/.exec(w.slice(i));
        if (m) return m[1] === m[1].toLowerCase();
      }
      depth++; continue;
    }
    if (c === '}') { depth--; continue; }
    if (depth === 0 && /\p{L}/u.test(c)) return c === c.toLowerCase() && c !== c.toUpperCase();
    if (c === '\\') { const m = /^\\[a-zA-Z]+/.exec(w.slice(i)); if (m) i += m[0].length - 1; }
  }
  return false;
}

const words = (s: string) => splitTop(s.trim(), /[\s~]+/y).filter((w) => w !== '');

/** Parsed names from an author/editor field ("Last, First and First von Last and {Barnes and Noble}"). */
export function parseNames(field: string): BibName[] {
  const out: BibName[] = [];
  for (const raw of splitTop(field, /\s+and\s+/iy)) {
    const name = raw.trim();
    if (!name) continue;
    const parts = splitTop(name, /,/y).map((p) => p.trim());
    let first = '', von = '', last = '', jr = '';
    if (parts.length === 1) {
      const w = words(parts[0]);
      if (w.length === 0) continue;
      const body = w.slice(0, -1);
      const vs = body.findIndex(isVon);
      if (vs < 0) { first = body.join(' '); last = w[w.length - 1]; }
      else {
        let ve = vs;
        for (let k = vs; k < body.length; k++) if (isVon(body[k])) ve = k;
        first = body.slice(0, vs).join(' ');
        von = body.slice(vs, ve + 1).join(' ');
        last = w.slice(ve + 1).join(' ');
      }
    } else {
      const w = words(parts[0]);
      let ve = -1;
      for (let k = 0; k < w.length - 1; k++) { if (isVon(w[k])) ve = k; else if (ve < 0) break; }
      von = w.slice(0, ve + 1).join(' ');
      last = w.slice(ve + 1).join(' ');
      if (parts.length === 2) first = parts[1];
      else { jr = parts[1]; first = parts.slice(2).join(', '); }
    }
    out.push({ first, last, von, jr });
  }
  return out;
}

// ---------------------------------------------------------------- helpers

/** Remove pure grouping braces ({DNA} → DNA); keep braces of commands, accents, scripts and maths. */
export function stripBraces(s: string): string {
  let out = '';
  const keep: boolean[] = [];
  let math = false;
  let lastClosedKept = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      const m = /^\\(?:[a-zA-Z]+|.)/s.exec(s.slice(i))!;
      out += m[0]; i += m[0].length - 1; lastClosedKept = false; continue;
    }
    if (c === '$') { math = !math; out += c; lastClosedKept = false; continue; }
    if (c === '{') {
      const before = out.replace(/\s+$/, '');
      const k = math || /\\(?:[a-zA-Z]+|[^a-zA-Z\s])$/.test(before) || /[\^_]$/.test(before)
        || (lastClosedKept && /\}$/.test(before)) || s[i + 1] === '\\';
      keep.push(k);
      if (k) out += c;
      lastClosedKept = false;
      continue;
    }
    if (c === '}') {
      const k = keep.length ? keep.pop()! : true;
      if (k) out += c;
      lastClosedKept = k;
      continue;
    }
    if (!/\s/.test(c)) lastClosedKept = false;
    out += c;
  }
  return out;
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescUrl = (s: string) => s.trim().replace(/^\\url\{(.*)\}$/s, '$1').replace(/\\([%_&#~$])/g, '$1');

function initial(w: string): string {
  if (/^.\.$/u.test(w)) return w;
  let m: RegExpExecArray | null;
  if (w.startsWith('{')) {
    // {\"O}scar → {\"O}; {Ch}ristopher → Ch
    let depth = 0, k = 0;
    for (; k < w.length; k++) {
      if (w[k] === '\\') { k++; continue; }
      if (w[k] === '{') depth++;
      else if (w[k] === '}' && --depth === 0) break;
    }
    const g = w.slice(0, k + 1);
    return (g[1] === '\\' ? g : g.slice(1, -1)) + '.';
  }
  if ((m = /^\\(?:[a-zA-Z]+\s*|[^a-zA-Z])(?:\{[^}]*\}|\p{L})/u.exec(w))) return m[0] + '.';
  const ch = /\p{L}|\d/u.exec(w);
  return ch ? ch[0] + '.' : '';
}

function initials(first: string): string {
  return words(first)
    .map((w) => splitTop(w, /-/y).map(initial).filter(Boolean).join('-'))
    .filter(Boolean)
    .join(' ');
}

function fullName(p: BibName): string {
  const parts = [initials(p.first), p.von, p.last].filter(Boolean).join(' ');
  return stripBraces(p.jr ? `${parts}, ${p.jr}` : parts);
}

const isOthers = (p: BibName) => p.last === 'others' && !p.first && !p.von;
const surname = (p: BibName) => stripBraces([p.von, p.last].filter(Boolean).join(' '));

/** Citation label for author-year styles: "Smith", "Smith and Jones", "Smith et al." (3+ authors);
 *  falls back to editor, then title, then key. TeX left in (caller renders it). */
export function authorShort(e: BibEntry): string {
  const f = e.fields;
  const src = f.author || f.editor;
  if (src) {
    const ns = parseNames(src);
    if (ns.length) {
      const real = ns.filter((p) => !isOthers(p));
      const more = real.length < ns.length;
      if (real.length >= 3 || (more && real.length >= 1)) return `${surname(real[0])} et al.`;
      if (real.length === 2) return `${surname(real[0])} and ${surname(real[1])}`;
      if (real.length === 1) return surname(real[0]);
    }
  }
  if (f.title) return stripBraces(f.title);
  return e.key;
}

/** Year from `year`, or from biblatex `date` (2020-05-01 → 2020); '' if none. */
export function year(e: BibEntry): string {
  const y = e.fields.year?.trim();
  if (y) return y;
  const m = /\d{4}/.exec(e.fields.date ?? '');
  return m ? m[0] : '';
}

const pages = (p: string) => p.replace(/\s*(?:--?-?|–|—)\s*/g, '–');

/** One reference as HTML (see bib.ts header for the format). */
export function formatEntry(e: BibEntry, tex: (s: string) => string): string {
  const f = e.fields;
  const T = (s: string) => tex(stripBraces(s));
  const segs: string[] = [];

  let who = '';
  let names = f.author;
  let eds = false;
  if (!names && f.editor) { names = f.editor; eds = true; }
  if (names) {
    const ns = parseNames(names);
    const real = ns.filter((p) => !isOthers(p));
    let etal = real.length < ns.length;
    let list = real;
    if (list.length > 6) { list = list.slice(0, 6); etal = true; }
    const fn = list.map((p) => tex(fullName(p)));
    if (etal) who = fn.join(', ') + ' et al.';
    else if (fn.length <= 2) who = fn.join(' and ');
    else who = fn.slice(0, -1).join(', ') + ', and ' + fn[fn.length - 1];
    if (eds) who += ns.length > 1 ? ', editors' : ', editor';
    if (who) segs.push(`<span class="bib-author">${who}</span>`);
  }

  if (f.title) segs.push(`<span class="bib-title">${T(f.title)}</span>`);

  const type = e.type;
  const venue: string[] = [];
  const em = (s: string) => `<em>${T(s)}</em>`;
  if (type === 'article') {
    let v = f.journal || f.journaltitle ? em(f.journal || f.journaltitle) : '';
    if (f.volume) v += (v ? ' ' : '') + T(f.volume);
    if (f.number || f.issue) v += `(${T(f.number || f.issue)})`;
    if (f.pages) v += (f.volume || f.number ? ':' : v ? ', ' : '') + T(pages(f.pages));
    if (v) venue.push(v);
  } else if (type === 'inproceedings' || type === 'incollection' || type === 'conference' || type === 'inbook') {
    const parts: string[] = [];
    if (f.booktitle) parts.push(`In ${em(f.booktitle)}`);
    else if (type === 'inbook' && f.chapter) parts.push(`Chapter ${T(f.chapter)}`);
    if (f.pages) parts.push(T(pages(f.pages)));
    if (f.publisher) parts.push(T(f.publisher));
    if (parts.length) venue.push(parts.join(', '));
  } else if (type === 'book' || type === 'booklet' || type === 'proceedings' || type === 'collection') {
    const parts: string[] = [];
    if (f.edition) parts.push(`${T(f.edition)} edition`);
    if (f.publisher) parts.push(T(f.publisher));
    else if (f.howpublished) parts.push(T(f.howpublished));
    if (parts.length) venue.push(parts.join(', '));
  } else if (type === 'phdthesis' || type === 'mastersthesis' || type === 'thesis') {
    const kind = f.type ? T(f.type) : type === 'phdthesis' ? 'PhD thesis' : type === 'mastersthesis' ? 'Master’s thesis' : 'Thesis';
    venue.push(f.school || f.institution ? `${kind}, ${T(f.school || f.institution)}` : kind);
  } else if (type === 'techreport' || type === 'report') {
    const parts: string[] = [];
    if (f.institution) parts.push(T(f.institution));
    const kind = f.type ? T(f.type) : 'Technical Report';
    parts.push(f.number ? `${kind} ${T(f.number)}` : kind);
    venue.push(parts.join(', '));
  } else {
    const parts: string[] = [];
    const host = f.howpublished || f.journal || f.journaltitle || f.booktitle || f.publisher || f.institution || f.school || f.organization;
    if (host) parts.push(T(host));
    if (f.eprint) {
      const kind = (f.archiveprefix || f.eprinttype || 'arXiv').trim();
      parts.push(tex(`${/arxiv/i.test(kind) ? 'arXiv' : kind}:${f.eprint.trim()}`));
    }
    if (parts.length) venue.push(parts.join(', '));
  }

  const y = year(e);
  const tail = [venue.length ? `<span class="bib-venue">${venue.join(', ')}</span>` : '', y ? `<span class="bib-year">${tex(y)}</span>` : '']
    .filter(Boolean).join(', ');
  if (tail) segs.push(tail);

  let html = '';
  for (const seg of segs) {
    if (html) html += /[.?!]$/.test(html.replace(/<[^>]*>/g, '').trim()) ? ' ' : '. ';
    html += seg;
  }
  if (!segs.length) html = tex(e.key);
  if (!/[.?!]$/.test(html.replace(/<[^>]*>/g, '').trim())) html += '.';

  let href = '', label = '';
  if (f.doi) {
    const doi = unescUrl(f.doi).replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)/i, '');
    href = `https://doi.org/${doi}`; label = `doi:${doi}`;
  } else if (f.url) {
    href = unescUrl(f.url); label = href.replace(/^https?:\/\//, '');
  } else if (f.eprint && /arxiv/i.test(f.archiveprefix || f.eprinttype || 'arXiv')) {
    href = `https://arxiv.org/abs/${f.eprint.trim()}`; label = `arXiv:${f.eprint.trim()}`;
  }
  if (href && /^(?:https?:|ftp:|mailto:|\/|\.)/i.test(href)) {
    html += ` <a class="bib-link" href="${escAttr(href)}" target="_blank">${escAttr(label)}</a>`;
  }
  return html;
}

// siunitx subset: \num, \si/\unit, \SI/\qty, ranges and \ang → TeX maths strings.

// ---------------------------------------------------------------- numbers

function group(digits: string, fromLeft: boolean): string {
  if (digits.length < 5) return digits;
  const out: string[] = [];
  if (fromLeft) for (let i = 0; i < digits.length; i += 3) out.push(digits.slice(i, i + 3));
  else for (let i = digits.length; i > 0; i -= 3) out.unshift(digits.slice(Math.max(0, i - 3), i));
  return out.join('\\,');
}

interface Num { tex: string; exp: string }

function parseOne(s: string): Num | null {
  const m = /^([+-]?)(\d*)(?:[.,](\d*))?(\(\d+(?:[.,]\d+)?\))?(?:[eEdD]([+-]?\d+))?$/.exec(s);
  if (!m || (!m[2] && !m[3] && m[5] === undefined)) return null;
  const [, sign, int, frac, unc, exp] = m;
  let tex = '';
  if (int || frac !== undefined) {
    tex = sign + group(int || '0', false);
    if (frac) tex += '.' + group(frac, true);
    if (unc) tex += unc.replace(',', '.');
  } else tex = sign;
  let e = '';
  if (exp !== undefined) {
    const em = /^([+-]?)0*(\d+)$/.exec(exp)!;
    e = (em[1] === '-' ? '-' : '') + em[2];
  }
  return { tex, exp: e };
}

const withExp = (mant: string, exp: string) =>
  exp === '' ? mant : mant === '' || mant === '+' || mant === '-' ? `${mant}10^{${exp}}` : `${mant}\\times10^{${exp}}`;

function factor(s: string): string {
  const parts = s.split('±');
  const nums = parts.map(parseOne);
  if (nums.some((x) => x === null)) return s.replace(/±/g, '\\pm');
  const ns = nums as Num[];
  if (ns.length === 1) return withExp(ns[0].tex, ns[0].exp);
  // a ± b with an exponent on the last part: (a ± b) × 10^e
  const exp = ns[ns.length - 1].exp;
  const body = ns.map((x, k) => (k === ns.length - 1 || x.exp === exp ? x.tex : withExp(x.tex, x.exp))).join('\\pm');
  return exp ? `(${body})\\times10^{${exp}}` : body;
}

/** \num{…} → TeX maths. */
export function siNum(s: string): string {
  const t = s
    .replace(/\\pm(?![a-zA-Z])|\+-|\+\/-/g, '±')
    .replace(/\\times(?![a-zA-Z])|\\cdot(?![a-zA-Z])|[x*]/g, '×')
    .replace(/[\s~]|\\,|\\ /g, '');
  if (t === '') return '';
  return t.split('×').map(factor).join('\\times');
}

// ---------------------------------------------------------------- units

const PREFIXES: Record<string, string> = {
  quecto: 'q', ronto: 'r', yocto: 'y', zepto: 'z', atto: 'a', femto: 'f', pico: 'p', nano: 'n',
  micro: '\\mu ', milli: 'm', centi: 'c', deci: 'd', deca: 'da', deka: 'da', hecto: 'h', kilo: 'k',
  mega: 'M', giga: 'G', tera: 'T', peta: 'P', exa: 'E', zetta: 'Z', yotta: 'Y', ronna: 'R', quetta: 'Q',
  kibi: 'Ki', mebi: 'Mi', gibi: 'Gi', tebi: 'Ti', pebi: 'Pi', exbi: 'Ei', zebi: 'Zi', yobi: 'Yi',
};

const UNITS: Record<string, string> = {
  metre: 'm', meter: 'm', gram: 'g', second: 's', ampere: 'A', kelvin: 'K', mole: 'mol', candela: 'cd',
  kilogram: 'kg',
  hertz: 'Hz', newton: 'N', pascal: 'Pa', joule: 'J', watt: 'W', coulomb: 'C', volt: 'V', farad: 'F',
  ohm: '\\Omega', siemens: 'S', weber: 'Wb', tesla: 'T', henry: 'H', degreeCelsius: '{}^{\\circ}C',
  celsius: '{}^{\\circ}C', lumen: 'lm', lux: 'lx', becquerel: 'Bq', gray: 'Gy', sievert: 'Sv', katal: 'kat',
  litre: 'L', liter: 'L', minute: 'min', hour: 'h', day: 'd', electronvolt: 'eV', dalton: 'Da',
  atomicmassunit: 'u', angstrom: '\\text{Å}', bar: 'bar', atmosphere: 'atm', atm: 'atm', torr: 'Torr',
  mmHg: 'mmHg', molar: 'M', Molar: 'M', percent: '\\%', degree: '{}^{\\circ}', arcminute: "{}'",
  arcsecond: "{}''", bit: 'bit', byte: 'B', decibel: 'dB', bel: 'B', neper: 'Np',
  astronomicalunit: 'au', parsec: 'pc', hectare: 'ha', tonne: 't', calorie: 'cal', barn: 'b',
  knot: 'kn', nauticalmile: 'M', clight: 'c', electronmass: 'm_e', planckbar: '\\hbar', elementarycharge: 'e',
  bohr: 'a_0', hartree: 'E_h', gauss: 'G', erg: 'erg', dyne: 'dyn', poise: 'P', stokes: 'St',
};

interface UItem { slash?: true; raw?: string; sym?: string; prefix?: string; pow?: string; per?: boolean; qual?: string }

function readArg(s: string, i: number): [string, number] {
  while (s[i] === ' ') i++;
  if (s[i] === '{') {
    let depth = 0;
    for (let k = i; k < s.length; k++) {
      if (s[k] === '{') depth++;
      else if (s[k] === '}' && --depth === 0) return [s.slice(i + 1, k), k + 1];
    }
    return [s.slice(i + 1), s.length];
  }
  if (s[i] === '\\') { const m = /^\\(?:[a-zA-Z]+|.)/.exec(s.slice(i))!; return [m[0], i + m[0].length]; }
  return [s[i] ?? '', i + 1];
}

function renderPow(u: UItem): string {
  let p = u.pow;
  if (u.per) p = p === undefined ? '-1' : p.startsWith('-') ? p.slice(1) : `-${p}`;
  return p === undefined || p === '1' ? '' : `^{${p}}`;
}

/** \si{…} / \unit{…} → TeX maths. */
export function siUnit(s: string): string {
  const items: UItem[] = [];
  let prefix = '';
  let per = false;
  let nextPow: string | undefined;
  const lastUnit = (): UItem | undefined => {
    const u = items[items.length - 1];
    return u && !u.slash ? u : undefined;
  };
  const push = (u: UItem) => {
    items.push({ ...u, prefix: prefix + (u.prefix ?? ''), pow: nextPow ?? u.pow, per });
    prefix = ''; per = false; nextPow = undefined;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c) || c === '.' || c === '~') { i++; continue; }
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i))!;
      const name = m[1];
      i += m[0].length;
      if (name === ',' || name === ' ' || name === ';' || name === ':') continue;
      if (name === 'per') { per = true; continue; }
      if (name === 'square') { nextPow = '2'; continue; }
      if (name === 'cubic') { nextPow = '3'; continue; }
      if (name === 'raiseto') { const [a, j] = readArg(s, i); i = j; nextPow = a; continue; }
      if (name === 'squared' || name === 'cubed' || name === 'tothe') {
        let p = name === 'squared' ? '2' : '3';
        if (name === 'tothe') { const [a, j] = readArg(s, i); i = j; p = a; }
        const u = lastUnit();
        if (u) u.pow = p;
        continue;
      }
      if (name === 'of') { const [a, j] = readArg(s, i); i = j; const u = lastUnit(); if (u) u.qual = a; continue; }
      if (name === 'cancel' || name === 'highlight') { if (name === 'highlight') i = readArg(s, i)[1]; continue; }
      if (name in PREFIXES) { prefix += PREFIXES[name]; continue; }
      if (name in UNITS) { push({ sym: UNITS[name] }); continue; }
      push({ raw: m[0] }); // unknown macro: leave for MathJax
      continue;
    }
    if (c === '/') { items.push({ slash: true }); i++; continue; }
    if (c === '^') {
      const [a, j] = readArg(s, i + 1);
      i = j;
      const u = lastUnit();
      if (u) u.pow = a; else push({ raw: `{}^{${a}}` });
      continue;
    }
    if (c === '_') { const [a, j] = readArg(s, i + 1); i = j; const u = lastUnit(); if (u) u.qual = a; continue; }
    if (c === '{') { const [a, j] = readArg(s, i); i = j; push({ sym: a }); continue; }
    const m = /^(?:\p{L}+|\d+|[^\\/^_{}\s.~])/u.exec(s.slice(i))!;
    i += m[0].length;
    push({ sym: m[0] === '%' ? '\\%' : m[0] });
  }
  let out = '';
  let prevUnit = false;
  for (const u of items) {
    if (u.slash) { out += '/'; prevUnit = false; continue; }
    if (prevUnit) out += '\\,';
    const body = u.raw ?? `\\mathrm{${(u.prefix ?? '') + (u.sym ?? '')}}`;
    out += body + (u.qual ? `_{\\mathrm{${u.qual}}}` : '') + renderPow(u);
    prevUnit = true;
  }
  return out;
}

// ---------------------------------------------------------------- quantities

const NO_SPACE = /^\s*\\(?:degree|arcminute|arcsecond)\s*$/;

function qtyNum(n: string): string {
  const t = siNum(n);
  return /\\pm/.test(t) && !/^\(/.test(t) ? `(${t})` : t;
}

/** \SI{n}{u} / \qty{n}{u}: number, thin space, unit. */
export function siQty(n: string, u: string): string {
  return `${qtyNum(n)}${NO_SPACE.test(u) ? '' : '\\,'}${siUnit(u)}`;
}

/** \SIrange / \qtyrange / \numrange: `1\text{–}5\,\mathrm{m}`. */
export function siRange(a: string, b: string, u?: string): string {
  const unit = u ? (NO_SPACE.test(u) ? '' : '\\,') + siUnit(u) : '';
  return `${qtyNum(a)}\\text{–}${qtyNum(b)}${unit}`;
}

/** \ang{30} → 30^{\circ}; \ang{1;2;3} → 1^{\circ}2'3''. */
export function siAngle(s: string): string {
  const [d = '', m = '', sec = ''] = s.split(';').map((x) => x.trim());
  let out = '';
  if (d) out += `${siNum(d)}^{\\circ}`;
  if (m) out += `${siNum(m)}'`;
  if (sec) out += `${siNum(sec)}''`;
  return out;
}

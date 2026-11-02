// Low-level, brace-aware cursor over TeX source.

export function stripComments(src: string): string {
  // Drop `%` to end of line (unless escaped), plus the newline and leading
  // whitespace of the next line, matching TeX's behaviour for `foo%\n  bar`.
  return src.replace(/(^|[^\\])%[^\n]*\n?[ \t]*/g, '$1');
}

export class Reader {
  pos = 0;
  src: string;
  constructor(src: string) { this.src = src; }

  get done() { return this.pos >= this.src.length; }
  peek(n = 0) { return this.src[this.pos + n]; }
  startsWith(s: string) { return this.src.startsWith(s, this.pos); }

  skipSpace(newlines = true) {
    const re = newlines ? /\s/ : /[ \t]/;
    while (!this.done && re.test(this.src[this.pos])) this.pos++;
  }

  /** Reads `\name` (or `\<symbol>`) at the cursor; returns name without backslash. */
  readCommandName(): string {
    if (this.peek() !== '\\') throw new Error('expected command');
    this.pos++;
    const m = /^[A-Za-z@]+/.exec(this.src.slice(this.pos));
    if (m) { this.pos += m[0].length; return m[0]; }
    return this.src[this.pos++] ?? '';
  }

  readStar(): boolean {
    if (this.peek() === '*') { this.pos++; return true; }
    return false;
  }

  /** Content between balanced delimiters starting at the cursor. */
  readBalanced(open: string, close: string): string {
    if (this.peek() !== open) throw new Error(`expected ${open} at ${this.where()}`);
    let depth = 0;
    const start = this.pos + 1;
    for (; this.pos < this.src.length; this.pos++) {
      const c = this.src[this.pos];
      if (c === '\\') { this.pos++; continue; }
      if (c === open) depth++;
      else if (c === close && --depth === 0) {
        this.pos++;
        return this.src.slice(start, this.pos - 1);
      }
    }
    throw new Error(`unbalanced ${open}${close} starting at ${this.where(start)}`);
  }

  /** Mandatory `{arg}`; a bare token is accepted as TeX does (`\frac12`). */
  readGroup(): string {
    this.skipSpace();
    if (this.peek() === '{') return this.readBalanced('{', '}');
    if (this.peek() === '\\') { const s = this.pos; this.readCommandName(); return this.src.slice(s, this.pos); }
    return this.src[this.pos++] ?? '';
  }

  /** Optional `[arg]`, brace-aware so `[x={0,1}]` works. */
  readOptional(): string | null {
    const save = this.pos;
    this.skipSpace();
    if (this.peek() !== '[') { this.pos = save; return null; }
    let depth = 0;
    const start = this.pos + 1;
    for (; this.pos < this.src.length; this.pos++) {
      const c = this.src[this.pos];
      if (c === '\\') { this.pos++; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === ']' && depth === 0) {
        this.pos++;
        return this.src.slice(start, this.pos - 1);
      }
    }
    this.pos = save;
    return null;
  }

  /** Optional beamer overlay spec `<...>`. */
  readOverlay(): string | null {
    const save = this.pos;
    this.skipSpace(false);
    if (this.peek() === '<') {
      const end = this.src.indexOf('>', this.pos);
      if (end > 0) {
        const spec = this.src.slice(this.pos + 1, end);
        if (/^[\d+.\-, |a-z:@()]*$/.test(spec)) { this.pos = end + 1; return spec; }
      }
    }
    this.pos = save;
    return null;
  }

  /** Reads up to the matching `\end{name}`, honouring nesting. */
  readEnvBody(name: string): string {
    const begin = `\\begin{${name}}`, end = `\\end{${name}}`;
    let depth = 1;
    const start = this.pos;
    while (this.pos < this.src.length) {
      if (this.startsWith(begin)) { depth++; this.pos += begin.length; continue; }
      if (this.startsWith(end) && --depth === 0) {
        const body = this.src.slice(start, this.pos);
        this.pos += end.length;
        return body;
      }
      if (this.peek() === '\\') this.pos++;
      this.pos++;
    }
    throw new Error(`missing \\end{${name}} for environment at ${this.where(start)}`);
  }

  where(at = this.pos) {
    const before = this.src.slice(0, at);
    const line = before.split('\n').length;
    return `line ${line}`;
  }
}

/** Split on top-level commas (ignoring commas inside {} or ()). */
export function splitTop(s: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '{' || c === '(') depth++;
    else if (c === '}' || c === ')') depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '' || out.length) out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x !== '');
}

/** `a=1, b={2,3}, flag` → {a:'1', b:'2,3', flag:true} */
export function parseKeyVals(s: string | null): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  if (!s) return out;
  for (const part of splitTop(s)) {
    const eq = part.indexOf('=');
    if (eq < 0) { out[part.trim()] = true; continue; }
    let v = part.slice(eq + 1).trim();
    if (v.startsWith('{') && v.endsWith('}')) v = v.slice(1, -1);
    out[part.slice(0, eq).trim()] = v;
  }
  return out;
}

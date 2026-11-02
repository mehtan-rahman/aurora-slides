// Build-time syntax highlighting for code listings (lstlisting, minted, \lstinline, \mintinline).
// Table-driven tokenizer; TeX, HTML/XML and diff get small dedicated scanners.
// Output invariants: every character of the input appears once, in order (only escaped);
// no <span> crosses a '\n', so callers may split the HTML into lines.

type Tok = [cls: string, text: string];
type RuleDef = [RegExp, string, (1 | 2)?]; // regex, class, bol: 1 = column 0, 2 = after indentation only

interface Def {
  kw?: string; ty?: string;   // space-separated word lists
  line?: string;              // line-comment markers
  block?: string;             // block-comment pairs: "open close open close"
  str?: string;               // string delimiters
  raw?: string;               // delimiters whose strings have no backslash escapes
  ml?: boolean;               // single-char-quoted strings may span lines (triple/backtick always may)
  ci?: boolean;               // case-insensitive keywords
  idx?: string;               // extra identifier characters
  prefix?: RegExp;            // identifier that prefixes a string (r"", b'', f"")
  tr?: boolean;               // ' after a value is the transpose operator, not a string
  rules?: RuleDef[];          // tried first, in order
}

interface Spec {
  kw: Set<string>; ty: Set<string>; line: string[]; block: [string, string][]; str: string[];
  raw: string[]; ml: boolean; ci: boolean; id: RegExp; prefix?: RegExp; tr: boolean;
  rules: { re: RegExp; c: string; bol?: 1 | 2 }[];
}

const words = (s = '') => s.split(/\s+/).filter(Boolean);

// ---- language tables ----------------------------------------------------------------------

const C_KW = 'auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while';
const C_TY = 'void char short int long float double signed unsigned bool _Bool size_t ssize_t ptrdiff_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t FILE NULL true false';
const CPP_KW = C_KW + ' alignas alignof asm catch class concept consteval constexpr constinit const_cast co_await co_return co_yield decltype delete dynamic_cast explicit export final friend mutable namespace new noexcept nullptr operator override private protected public reinterpret_cast requires static_assert static_cast template this throw try typeid typename using virtual';
const CPP_TY = C_TY + ' wchar_t char8_t char16_t char32_t std string vector array map set unordered_map unique_ptr shared_ptr cout cin cerr endl';
const PREPROC: RuleDef[] = [[/#\s*include\s*(?:<[^>\n]*>|"[^"\n]*")/, 'tk-meta', 2], [/#\s*[A-Za-z]+/, 'tk-meta', 2]];
const ANNOT: RuleDef[] = [[/@[A-Za-z_][\w.]*/, 'tk-meta']];
const CHAR: RuleDef = [/'(?:\\.[^'\n]*|[^\\'\n])'/, 'tk-str']; // char literal where ' is otherwise a lifetime / type var
const UPPER_VAR: RuleDef = [/[A-Z_]\w*/, 'tk-ty'];
const C_LIKE = { line: '//', block: '/* */', str: '" \'' };
const JS_KW = 'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await get set null undefined true false';
const JS_TY = 'Array Object String Number Boolean Map Set WeakMap Promise Math JSON console window document Error RegExp Date Symbol BigInt NaN Infinity';
const JS: Def = { kw: JS_KW, ty: JS_TY, ...C_LIKE, str: '` " \'', idx: '$', rules: ANNOT };
const GLSL_TY = 'float double int uint bool void vec2 vec3 vec4 dvec2 dvec3 dvec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 bvec2 bvec3 bvec4 mat2 mat3 mat4 sampler2D sampler3D samplerCube gl_Position gl_FragCoord gl_FragColor gl_FragDepth texture mix clamp dot cross normalize length smoothstep step fract floor ceil';

const DEFS: Record<string, Def> = {
  python: {
    kw: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case',
    ty: 'int float complex str bool list dict set frozenset tuple bytes bytearray object type len range print enumerate zip map filter sorted reversed sum min max abs round open isinstance issubclass super self cls Exception ValueError TypeError KeyError IndexError RuntimeError',
    line: '#', str: '""" \'\'\' " \'', prefix: /^(?:[rRbBuUfF]|[rR][bBfF]|[bBfF][rR])$/, rules: ANNOT,
  },
  c: { kw: C_KW, ty: C_TY, ...C_LIKE, rules: PREPROC },
  cpp: { kw: CPP_KW, ty: CPP_TY, ...C_LIKE, prefix: /^(?:u8|[uUL])$/, rules: PREPROC },
  cuda: {
    kw: CPP_KW + ' __global__ __device__ __host__ __shared__ __constant__ __restrict__ __managed__',
    ty: CPP_TY + ' threadIdx blockIdx blockDim gridDim warpSize dim3 float2 float3 float4 int2 int3 int4 cudaError_t',
    ...C_LIKE, rules: [[/<<<|>>>/, 'tk-meta'], ...PREPROC],
  },
  glsl: { kw: C_KW + ' in out inout uniform varying attribute layout precision highp mediump lowp discard flat smooth centroid buffer shared', ty: GLSL_TY, ...C_LIKE, rules: PREPROC },
  java: {
    kw: 'abstract assert break case catch class continue default do else enum extends final finally for if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized this throw throws transient try volatile while var record sealed permits yield null true false',
    ty: 'boolean byte char double float int long short void String Object Integer Long Double Boolean List ArrayList Map HashMap Set System Math',
    ...C_LIKE, str: '""" " \'', rules: ANNOT,
  },
  javascript: JS,
  typescript: {
    ...JS, kw: JS_KW + ' interface type enum namespace module declare abstract implements private protected public readonly keyof infer as is satisfies',
    ty: JS_TY + ' string number boolean any unknown never object bigint symbol Record Partial Readonly Pick Omit',
  },
  rust: {
    kw: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
    ty: 'i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box Rc Arc HashMap Some None Ok Err',
    line: '//', block: '/* */', str: '"', prefix: /^(?:b|r|br)$/,
    rules: [CHAR, [/#!?\[[^\]\n]*\]/, 'tk-meta'], [/[A-Za-z_]\w*!(?=[(\[{])/, 'tk-meta']],
  },
  go: {
    kw: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota',
    ty: 'bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any append cap close copy delete len make new panic print println recover',
    ...C_LIKE, str: '` " \'', raw: '`',
  },
  kotlin: {
    kw: 'as break by catch class companion constructor continue data do else false for fun get if import in init interface internal is lateinit null object open override package private protected public return sealed set super suspend this throw true try typealias val var when while',
    ty: 'Int Long Short Byte Double Float Boolean Char String Unit Any Nothing List MutableList Map Array println listOf mapOf setOf',
    ...C_LIKE, str: '""" " \'', rules: ANNOT,
  },
  swift: {
    kw: 'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch false is nil self Self super throw throws true try async await some any',
    ty: 'Int Double Float String Bool Character Array Dictionary Set Optional Void print',
    ...C_LIKE, str: '""" "', rules: ANNOT,
  },
  scala: {
    kw: 'abstract case catch class def do else enum export extends false final finally for forSome given if implicit import lazy match new null object override package private protected return sealed super then this throw trait true try type using val var while with yield',
    ty: 'Int Long Double Float Boolean Char String Unit Any AnyRef Nothing List Seq Map Option Some None Array println',
    ...C_LIKE, str: '""" " \'', rules: ANNOT,
  },
  csharp: {
    kw: 'abstract as async await base break case catch checked class const continue default delegate do else enum event explicit extern false finally fixed for foreach get goto if implicit in interface internal is lock namespace new null operator out override params private protected public readonly record ref return sealed set sizeof stackalloc static struct switch this throw true try typeof unchecked unsafe using var virtual volatile while yield',
    ty: 'bool byte char decimal double float int long object sbyte short string uint ulong ushort void List Dictionary Console Task Math',
    ...C_LIKE, rules: [[/@"(?:[^"]|"")*"/, 'tk-str'], [/#\s*[A-Za-z]+/, 'tk-meta', 2]],
  },
  php: {
    kw: 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null',
    ty: 'int float string bool array object mixed void iterable strlen count implode explode',
    line: '// #', block: '/* */', str: '" \'', ci: true,
    rules: [[/<\?(?:php)?|\?>/, 'tk-meta'], [/\$[A-Za-z_]\w*/, 'tk-ty']],
  },
  ruby: {
    kw: 'BEGIN END alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require require_relative attr_accessor attr_reader include extend',
    ty: 'Array Hash String Integer Float Symbol puts print p lambda proc raise',
    line: '#', block: '=begin =end', str: '" \' `', idx: '?!',
    rules: [[/@@?[A-Za-z_]\w*|\$\w+/, 'tk-ty'], [/:[A-Za-z_]\w*[?!]?/, 'tk-ty']],
  },
  lua: {
    kw: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while',
    ty: 'print pairs ipairs type tostring tonumber require select error assert pcall table string math io os setmetatable getmetatable',
    line: '--', block: '--[[ ]]', str: '" \'', rules: [[/\[(=*)\[[\s\S]*?\]\1\]/, 'tk-str']],
  },
  perl: {
    kw: 'my our local sub if elsif else unless while until for foreach last next redo return use no package require do eval and or not eq ne lt gt le ge cmp',
    ty: 'print printf say push pop shift unshift split join keys values each defined scalar die warn open close chomp',
    line: '#', str: '" \' `', raw: "'", rules: [[/[$@%][A-Za-z_]\w*/, 'tk-ty']],
  },
  bash: {
    kw: 'if then else elif fi case esac for while until do done in function select time return exit break continue local export readonly declare unset shift source alias',
    ty: 'echo printf cd ls cat grep sed awk read test set eval exec trap mkdir rm cp mv sudo pwd touch chmod find xargs',
    line: '#', str: '" \' `', raw: "'", ml: true,
    rules: [[/\$\{[^}\n]*\}|\$\(\(?|\$[\w@#?$!*-]/, 'tk-ty'], [/[$%] (?=\S)/, 'tk-meta', 1]],
  },
  make: {
    kw: 'ifeq ifneq ifdef ifndef else endif include define endef export override vpath', line: '#',
    rules: [[/\$[({][^)}\n]*[)}]|\$./, 'tk-ty'], [/[\w.%\/\- ]+(?=::?(?!=))/, 'tk-fn', 1], [/\.[A-Z]+(?=:)/, 'tk-meta', 1]],
  },
  dockerfile: {
    kw: 'from run cmd label maintainer expose env add copy entrypoint volume user workdir arg onbuild stopsignal healthcheck shell as',
    ci: true, line: '#', str: '" \'', rules: [[/\$\{[^}\n]*\}|\$\w+/, 'tk-ty']],
  },
  matlab: {
    kw: 'break case catch classdef continue else elseif end for function global if otherwise parfor persistent return spmd switch try while',
    ty: 'disp plot zeros ones eye rand randn size length numel sum prod max min abs sqrt exp log sin cos tan pi inf Inf nan NaN true false fprintf sprintf linspace figure hold xlabel ylabel title legend',
    block: '%{ %}', line: '%', str: '" \'', tr: true,
  },
  r: {
    kw: 'if else repeat while function for in next break TRUE FALSE NULL Inf NaN NA return library require',
    ty: 'c list data.frame vector matrix print cat paste paste0 length sum mean median sd seq rep apply sapply lapply',
    line: '#', str: '" \' `', idx: '.',
  },
  julia: {
    kw: 'abstract baremodule begin break catch const continue do else elseif end export finally for function global if import in isa let local macro module mutable primitive quote return struct try type using where while true false nothing',
    ty: 'Int Int32 Int64 UInt Float32 Float64 String Char Bool Vector Matrix Array Dict Any Nothing println print length push! zeros ones',
    line: '#', block: '#= =#', str: '""" "', tr: true, idx: '!', rules: [[/@[A-Za-z_]\w*/, 'tk-meta'], CHAR],
  },
  fortran: {
    kw: 'program end module use implicit none parameter dimension allocatable intent in out inout subroutine function call return if then else elseif endif do enddo while continue stop print write read select case contains interface pure elemental recursive result allocate deallocate only save',
    ty: 'integer real double precision complex logical character type', line: '!', str: '" \'', ci: true,
    rules: [[/\.(?:true|false|and|or|not|eqv|neqv|eq|ne|lt|le|gt|ge)\./i, 'tk-kw']],
  },
  sql: {
    kw: 'select from where and or not insert into values update set delete create table drop alter add index view as join inner left right outer full cross on group by order having limit offset union all distinct case when then else end is null like in between exists primary key foreign references default unique constraint begin commit rollback with returning asc desc',
    ty: 'int integer smallint bigint serial varchar char text date time timestamp boolean float real double numeric decimal count sum avg min max coalesce', ci: true,
    line: '--', block: '/* */', str: '\' "', raw: '\'',
  },
  haskell: {
    kw: 'case class data default deriving do else foreign if import in infix infixl infixr instance let module newtype of then type where qualified as hiding',
    ty: 'Int Integer Float Double Bool Char String Maybe Either IO Just Nothing Left Right True False map filter foldr foldl show print return putStrLn',
    line: '--', block: '{- -}', idx: "'", str: '"', rules: [CHAR],
  },
  ocaml: {
    kw: 'and as assert begin class constraint do done downto else end exception external false for fun function functor if in include inherit initializer lazy let match method module mutable new object of open or private rec sig struct then to true try type val virtual when while with',
    ty: 'int float string bool char unit list array option ref Some None print_string print_endline Printf List Array',
    block: '(* *)', idx: "'", str: '"', rules: [CHAR],
  },
  lisp: {
    kw: 'defun defvar defparameter defmacro defstruct defn def define define-syntax lambda fn let let* letrec if cond case when unless and or not progn begin setq setf set! loop do quote',
    ty: 'car cdr cons list null eq eql equal format print display map mapcar apply first rest nil t',
    line: ';', block: '#| |#', str: '"', idx: '-*!?<>=/+',
  },
  erlang: {
    kw: 'after and andalso band begin bnot bor bsl bsr bxor case catch cond div end fun if let not of or orelse receive rem try when xor',
    ty: 'io format spawn self send length hd tl element', line: '%', str: '" \'', rules: [UPPER_VAR, [/\$\\?./, 'tk-str']],
  },
  elixir: {
    kw: 'def defp defmodule defmacro defstruct defprotocol defimpl do end fn if else unless case cond when with for receive try catch rescue after import alias require use quote unquote true false nil and or not in',
    ty: 'IO Enum List Map String Kernel Agent GenServer', line: '#', str: '""" " \'', idx: '?!',
    rules: [[/@[a-z_]\w*/, 'tk-meta'], [/:[A-Za-z_]\w*[?!]?/, 'tk-ty']],
  },
  prolog: { kw: 'is mod rem not true fail', line: '%', block: '/* */', str: '" \'', rules: [UPPER_VAR] },
  verilog: {
    kw: 'always always_comb always_ff always_latch and assign automatic begin case casex casez default else end endcase endfunction endgenerate endmodule endtask for forever function generate genvar if initial inout input localparam module negedge or output parameter posedge repeat task while',
    ty: 'reg wire logic integer bit byte signed unsigned', ...C_LIKE, str: '"',
    rules: [[/\d*'[sS]?[bBoOdDhH][\da-fA-FxXzZ_?]+/, 'tk-num'], [/`\w+/, 'tk-meta'], [/\$\w+/, 'tk-ty']],
  },
  vhdl: {
    kw: 'abs access after alias all and architecture array assert attribute begin block body buffer bus case component configuration constant downto else elsif end entity exit file for function generate generic group guarded if impure in inertial inout is label library linkage literal loop map mod nand new next nor not null of on open or others out package port postponed procedure process pure range record register reject rem report return rol ror select severity signal shared sla sll sra srl subtype then to transport type until use variable wait when while with xnor xor',
    ty: 'std_logic std_logic_vector std_ulogic integer natural positive boolean bit bit_vector unsigned signed real time rising_edge falling_edge ieee',
    ci: true, line: '--', str: '" \'', raw: '" \'', tr: true,
  },
  asm: {
    kw: 'mov movzx movsx add sub mul imul div idiv inc dec and or xor not neg shl shr sal sar cmp test jmp je jne jz jnz jg jge jl jle ja jae jb jbe call ret push pop lea nop int syscall ldr str ldp stp b bl bx blr beq bne cbz cbnz adr',
    ty: 'eax ebx ecx edx esi edi esp ebp rax rbx rcx rdx rsi rdi rsp rbp rip r8 r9 r10 r11 r12 r13 r14 r15 al ah bl bh cl ch dl dh sp lr pc',
    ci: true, line: '; #', block: '/* */', str: '" \'',
    rules: [[/[A-Za-z_.$][\w.$]*:/, 'tk-fn', 2], [/\.[A-Za-z_]\w*/, 'tk-meta'], [/%[A-Za-z]\w*/, 'tk-ty']],
  },
  css: {
    kw: 'important inherit initial unset auto none', block: '/* */', str: '" \'', idx: '-',
    rules: [[/@[\w-]+/, 'tk-meta'], [/#[\da-fA-F]{3,8}\b/, 'tk-num'], [/-?[A-Za-z_][\w-]*(?=\s*:[^:])/, 'tk-ty']],
  },
  json: {
    kw: 'true false null', line: '//', block: '/* */', str: '"',
    rules: [[/"(?:\\.|[^"\\\n])*"(?=\s*:)/, 'tk-ty']],
  },
  yaml: {
    kw: 'true false null yes no on off', ci: true, line: '#', str: '" \'', raw: "'", idx: '-',
    rules: [[/(?:---|\.\.\.)(?=\s|$)/, 'tk-meta', 1], [/(?:"[^"\n]*"|'[^'\n]*'|[A-Za-z_][\w.\- ]*?)(?=:(?:\s|$))/, 'tk-ty'],
      [/[&*][\w-]+|!!?[\w\/-]*/, 'tk-meta']],
  },
  toml: {
    kw: 'true false', line: '#', str: '""" \'\'\' " \'', raw: "''' '",
    rules: [[/\[\[?[^\]\n]*\]\]?/, 'tk-meta', 2], [/(?:[\w.\-]+|"[^"\n]*")(?=[ \t]*=)/, 'tk-ty', 2]],
  },
  ini: {
    line: '; #', str: '"',
    rules: [[/\[[^\]\n]*\]/, 'tk-meta', 2], [/[^\s=;#\[][^=\n]*?(?=[ \t]*[=:])/, 'tk-ty', 2]],
  },
};
const SPECIAL = new Set(['tex', 'html', 'xml', 'diff']);

const ALIAS: Record<string, string> = {
  py: 'python', python2: 'python', python3: 'python', py3: 'python', ipython: 'python', pycon: 'python', sage: 'python',
  'c++': 'cpp', cxx: 'cpp', cc: 'cpp', hpp: 'cpp', 'objective-c': 'c', objc: 'c', h: 'c', cu: 'cuda',
  latex: 'tex', context: 'tex', 'plain-tex': 'tex', bib: 'tex', bibtex: 'tex',
  js: 'javascript', jsx: 'javascript', node: 'javascript', ecmascript: 'javascript', mjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', rs: 'rust', golang: 'go', kt: 'kotlin', 'c#': 'csharp', cs: 'csharp',
  sh: 'bash', shell: 'bash', zsh: 'bash', ksh: 'bash', console: 'bash', shellsession: 'bash', terminal: 'bash',
  octave: 'matlab', m: 'matlab', s: 'r', splus: 'r', rscript: 'r', jl: 'julia',
  mysql: 'sql', postgresql: 'sql', postgres: 'sql', psql: 'sql', sqlite: 'sql', plsql: 'sql', tsql: 'sql',
  hs: 'haskell', htm: 'html', xhtml: 'html', html5: 'html', svg: 'xml', xslt: 'xml', yml: 'yaml', rb: 'ruby',
  f90: 'fortran', f95: 'fortran', f77: 'fortran', fortran90: 'fortran',
  scheme: 'lisp', clojure: 'lisp', racket: 'lisp', elisp: 'lisp', 'emacs-lisp': 'lisp', 'common-lisp': 'lisp', cl: 'lisp', clj: 'lisp',
  pl: 'perl', makefile: 'make', gnumake: 'make', mk: 'make', docker: 'dockerfile', cfg: 'ini', conf: 'ini', properties: 'ini',
  patch: 'diff', udiff: 'diff', ml: 'ocaml', caml: 'ocaml', erl: 'erlang', ex: 'elixir', exs: 'elixir',
  systemverilog: 'verilog', sv: 'verilog', assembler: 'asm', assembly: 'asm', nasm: 'asm', gas: 'asm', masm: 'asm', x86asm: 'asm',
  hlsl: 'glsl', scss: 'css', less: 'css', jsonc: 'json', json5: 'json', php5: 'php', lisp: 'lisp',
};

/** Canonical language id for a listings/minted language name, or null if unknown. */
export function normalizeLang(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const k = name.trim().replace(/^\{\s*|\s*\}$/g, '').replace(/^\[[^\]]*\]\s*/, '').trim().toLowerCase().replace(/\s+/g, '');
  if (!k) return null;
  if (Object.hasOwn(ALIAS, k)) return ALIAS[k];
  return Object.hasOwn(DEFS, k) || SPECIAL.has(k) ? k : null;
}

// ---- generic tokenizer --------------------------------------------------------------------

const sticky = (re: RegExp) => new RegExp(re.source, re.flags.replace(/[gy]/g, '') + 'y');
const cache = new Map<string, Spec>();

function spec(id: string): Spec {
  let s = cache.get(id);
  if (s) return s;
  const d = DEFS[id], ci = !!d.ci;
  const set = (w?: string) => new Set(words(w).map(x => (ci ? x.toLowerCase() : x)));
  const b = words(d.block), block: [string, string][] = [];
  for (let i = 0; i + 1 < b.length; i += 2) block.push([b[i], b[i + 1]]);
  const extra = (d.idx ?? '').replace(/[\\\]\-^]/g, '\\$&');
  const start = extra.includes('$') ? 'A-Za-z_$' : 'A-Za-z_';
  s = {
    kw: set(d.kw), ty: set(d.ty), line: words(d.line), block, ml: !!d.ml, ci, prefix: d.prefix, tr: !!d.tr,
    str: words(d.str).sort((x, y) => y.length - x.length), raw: words(d.raw),
    id: new RegExp(`[${start}\\u00C0-\\uFFFF][\\w${extra}\\u00C0-\\uFFFF]*`, 'y'),
    rules: (d.rules ?? []).map(([re, c, bol]) => ({ re: sticky(re), c, bol })),
  };
  cache.set(id, s);
  return s;
}

const NUM = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.(?!\.)[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?)[A-Za-z]*/y;
const OP = /[+\-*/%=<>!&|^~?:]+/y;
const WS = /[ \t\r\n]+/y;

const eol = (code: string, i: number) => { const k = code.indexOf('\n', i); return k < 0 ? code.length : k; };

function atBol(code: string, i: number, mode: 1 | 2): boolean {
  let j = i - 1;
  if (mode === 2) while (j >= 0 && (code[j] === ' ' || code[j] === '\t')) j--;
  return j < 0 || code[j] === '\n';
}

/** End index of a string whose body starts at j and closes with `d`. */
function scanStr(code: string, j: number, d: string, esc: boolean, ml: boolean): number {
  const n = code.length;
  while (j < n) {
    const c = code[j];
    if (esc && c === '\\') { j += 2; continue; }
    if (code.startsWith(d, j)) return j + d.length;
    if (c === '\n' && !ml) return j;
    j++;
  }
  return n;
}

function match(re: RegExp, code: string, i: number): string | null {
  re.lastIndex = i;
  const m = re.exec(code);
  return m && m[0] ? m[0] : null;
}

function generic(code: string, s: Spec): Tok[] {
  const t: Tok[] = [], n = code.length;
  let i = 0;
  const put = (c: string, e: number) => { t.push([c, code.slice(i, e)]); i = e; };
  const str = (d: string, from: number) => put('tk-str', scanStr(code, from + d.length, d, !s.raw.includes(d), s.ml || d.length > 1 || d === '`'));
  if (code.startsWith('#!')) put('tk-meta', eol(code, 0));
  outer: while (i < n) {
    let m = match(WS, code, i);
    if (m) { put('', i + m.length); continue; }
    for (const r of s.rules) {
      if (r.bol && !atBol(code, i, r.bol)) continue;
      if ((m = match(r.re, code, i))) { put(r.c, i + m.length); continue outer; }
    }
    for (const [o, c] of s.block) if (code.startsWith(o, i)) {
      const k = code.indexOf(c, i + o.length);
      put('tk-com', k < 0 ? n : k + c.length);
      continue outer;
    }
    for (const l of s.line) if (code.startsWith(l, i)) { put('tk-com', eol(code, i)); continue outer; }
    for (const d of s.str) if (code.startsWith(d, i)) {
      if (s.tr && d === "'" && i > 0 && /[\w)\]}.']/.test(code[i - 1])) break;
      str(d, i);
      continue outer;
    }
    const ch = code[i];
    if ((ch >= '0' && ch <= '9') || (ch === '.' && /\d/.test(code[i + 1] ?? ''))) { put('tk-num', i + match(NUM, code, i)!.length); continue; }
    if ((m = match(s.id, code, i))) {
      const e = i + m.length;
      if (s.prefix?.test(m)) { const d = s.str.find(q => code.startsWith(q, e)); if (d) { str(d, e); continue; } }
      const k = s.ci ? m.toLowerCase() : m;
      put(s.kw.has(k) ? 'tk-kw' : s.ty.has(k) ? 'tk-ty' : code[e] === '(' ? 'tk-fn' : '', e);
      continue;
    }
    if ((m = match(OP, code, i))) { put('tk-op', i + m.length); continue; }
    put('', i + 1);
  }
  return t;
}

// ---- special-purpose scanners -------------------------------------------------------------

const TEX_CMD = /\\(?:[A-Za-z@]+\*?|[^\n])/y;
const TEX_ENV = /\{[^{}\n]*\}/y;
const TEX_MATH = /\$\$(?:\\[\s\S]|[^$\\])*?\$\$|\$(?:\\[\s\S]|[^$\\])+?\$/y;
const TEX_TEXT = /[^\\%$\d{}[\]&#^_~\n]+/y;

function tex(code: string): Tok[] {
  const t: Tok[] = [], n = code.length;
  let i = 0, m: string | null;
  const put = (c: string, e: number) => { t.push([c, code.slice(i, e)]); i = e; };
  while (i < n) {
    const ch = code[i];
    if (ch === '\\' && (m = match(TEX_CMD, code, i))) {
      put('tk-meta', i + m.length);
      if ((m === '\\begin' || m === '\\end') && (m = match(TEX_ENV, code, i))) {
        const e = i + m.length;
        put('', i + 1); put('tk-ty', e - 1); put('', e);
      }
    } else if (ch === '%') put('tk-com', eol(code, i));
    else if (ch === '$' && (m = match(TEX_MATH, code, i))) put('tk-str', i + m.length);
    else if (ch >= '0' && ch <= '9') put('tk-num', i + match(/\d+(?:\.\d+)?/y, code, i)!.length);
    else if ('{}[]&#^_~'.includes(ch)) put('tk-op', i + 1);
    else if ((m = match(TEX_TEXT, code, i))) put('', i + m.length);
    else put('', i + 1);
  }
  return t;
}

const ML_TAG = /<\/?[A-Za-z_][\w:.\-]*/y;
const ML_ATTR = /[^\s=>\/"']+/y;
const ML_ENT = /&(?:#\w+|[A-Za-z]\w*);/y;
const ML_TEXT = /[^<&]+/y;

function markup(code: string): Tok[] {
  const t: Tok[] = [], n = code.length;
  let i = 0, m: string | null;
  const put = (c: string, e: number) => { t.push([c, code.slice(i, e)]); i = e; };
  const until = (c: string, end: string) => { const k = code.indexOf(end, i + 1); put(c, k < 0 ? n : k + end.length); };
  while (i < n) {
    if (code.startsWith('<!--', i)) until('tk-com', '-->');
    else if (code.startsWith('<![CDATA[', i)) until('tk-str', ']]>');
    else if (code.startsWith('<!', i) || code.startsWith('<?', i)) until('tk-meta', '>');
    else if ((m = match(ML_TAG, code, i))) {
      put('tk-meta', i + m.length);
      while (i < n) {
        const ch = code[i];
        if (ch === '>') { put('tk-meta', i + 1); break; }
        if (ch === '/' && code[i + 1] === '>') { put('tk-meta', i + 2); break; }
        if (ch === '"' || ch === "'") { const k = code.indexOf(ch, i + 1); put('tk-str', k < 0 ? n : k + 1); }
        else if ((m = match(WS, code, i))) put('', i + m.length);
        else if (ch === '=') {
          put('', i + 1);
          if ((m = match(/[^\s>"']+/y, code, i))) put('tk-str', i + m.length);
        } else if ((m = match(ML_ATTR, code, i))) put('tk-ty', i + m.length);
        else put('', i + 1);
      }
    } else if ((m = match(ML_ENT, code, i))) put('tk-num', i + m.length);
    else if ((m = match(ML_TEXT, code, i))) put('', i + m.length);
    else put('', i + 1);
  }
  return t;
}

function diff(code: string): Tok[] {
  const t: Tok[] = [];
  for (const line of code.split(/(?<=\n)/)) {
    const body = line.endsWith('\n') ? line.slice(0, -1) : line;
    const c = /^(?:diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(body) ? 'tk-meta'
      : body.startsWith('@@') ? 'tk-fn' : body.startsWith('+') ? 'tk-add' : body.startsWith('-') ? 'tk-del'
      : body.startsWith('\\') ? 'tk-com' : '';
    t.push([c, line]);
  }
  return t;
}

// ---- output -------------------------------------------------------------------------------

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escape = (s: string) => s.replace(/[&<>"]/g, c => ESC[c]);

function render(toks: Tok[]): string {
  let h = '';
  for (const [c, text] of toks) {
    if (!c) { h += escape(text); continue; }
    h += text.split('\n').map(p => (p ? `<span class="${c}">${escape(p)}</span>` : '')).join('\n');
  }
  return h;
}

/** HTML for `code` (raw text). Escapes & < > " and wraps tokens in `tk-*` spans; no span crosses a newline. */
export function highlight(code: string, lang: string | null): string {
  const src = typeof code === 'string' ? code : String(code ?? '');
  try {
    const id = normalizeLang(lang);
    if (!id || !src) return escape(src);
    const toks = id === 'tex' ? tex(src) : id === 'html' || id === 'xml' ? markup(src) : id === 'diff' ? diff(src) : generic(src, spec(id));
    if (toks.map(x => x[1]).join('') !== src) return escape(src); // belt and braces: never lose text
    return render(toks);
  } catch {
    return escape(src);
  }
}

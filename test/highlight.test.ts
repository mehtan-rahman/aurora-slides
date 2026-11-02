import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlight, normalizeLang } from '../src/highlight.ts';

const unhtml = (h: string) =>
  h.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const has = (h: string, cls: string, text: string) =>
  assert.ok(h.includes(`<span class="${cls}">${text}</span>`), `expected ${cls} "${text}" in:\n${h}`);
/** Every output line must have balanced spans (none open across '\n'). */
const balanced = (h: string) => {
  for (const line of h.split('\n')) {
    const open = (line.match(/<span /g) ?? []).length, close = (line.match(/<\/span>/g) ?? []).length;
    assert.equal(open, close, `unbalanced line: ${line}`);
  }
};

test('normalizeLang aliases and dialects', () => {
  const cases: [string, string][] = [
    ['Python', 'python'], ['python3', 'python'], ['C', 'c'], ['C++', 'cpp'], ['[ISO]C++', 'cpp'],
    ['[LaTeX]TeX', 'tex'], ['TeX', 'tex'], ['latex', 'tex'], ['Java', 'java'], ['JavaScript', 'javascript'],
    ['js', 'javascript'], ['TypeScript', 'typescript'], ['ts', 'typescript'], ['Rust', 'rust'], ['Go', 'go'],
    ['bash', 'bash'], ['sh', 'bash'], ['shell', 'bash'], ['zsh', 'bash'], ['console', 'bash'],
    ['Matlab', 'matlab'], ['Octave', 'matlab'], ['R', 'r'], ['Julia', 'julia'], ['SQL', 'sql'],
    ['Haskell', 'haskell'], ['HTML', 'html'], ['XML', 'xml'], ['JSON', 'json'], ['YAML', 'yaml'],
    ['Ruby', 'ruby'], ['Fortran', 'fortran'], ['[95]Fortran', 'fortran'], ['Lisp', 'lisp'], ['scheme', 'lisp'],
    ['Kotlin', 'kotlin'], ['Swift', 'swift'], ['C#', 'csharp'], ['csharp', 'csharp'], ['php', 'php'],
    ['lua', 'lua'], ['perl', 'perl'], ['make', 'make'], ['Makefile', 'make'], ['dockerfile', 'dockerfile'],
    ['toml', 'toml'], ['ini', 'ini'], ['diff', 'diff'], ['css', 'css'], ['scala', 'scala'], ['ocaml', 'ocaml'],
    ['erlang', 'erlang'], ['elixir', 'elixir'], ['prolog', 'prolog'], ['Verilog', 'verilog'], ['VHDL', 'vhdl'],
    ['[x86masm]Assembler', 'asm'], ['asm', 'asm'], ['cuda', 'cuda'], ['glsl', 'glsl'], [' {Python} ', 'python'],
  ];
  for (const [name, id] of cases) assert.equal(normalizeLang(name), id, name);
  for (const bad of ['', 'Klingon', '[x]', null, undefined]) assert.equal(normalizeLang(bad), null);
});

test('python keywords, builtins, strings, comments, functions', () => {
  const h = highlight('def f(x):\n    return len(x) + 1  # done\ns = r"a\\b" if True else \'q\'\n@cache\n', 'python');
  has(h, 'tk-kw', 'def'); has(h, 'tk-fn', 'f'); has(h, 'tk-kw', 'return'); has(h, 'tk-ty', 'len');
  has(h, 'tk-num', '1'); has(h, 'tk-com', '# done'); has(h, 'tk-str', 'r&quot;a\\b&quot;');
  has(h, 'tk-kw', 'True'); has(h, 'tk-str', "'q'"); has(h, 'tk-meta', '@cache');
});

test('python triple-quoted string spans lines but spans do not', () => {
  const h = highlight('x = """one\ntwo # not a comment\nthree"""\ny = 2', 'python');
  balanced(h);
  const lines = h.split('\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[1], '<span class="tk-str">two # not a comment</span>');
  assert.ok(lines[2].startsWith('<span class="tk-str">three&quot;&quot;&quot;</span>'));
  assert.ok(!h.includes('tk-com'));
});

test('C block comment across lines, preprocessor', () => {
  const h = highlight('#include <stdio.h>\n/* a\n\n b */ int main(void) { return 0; }', 'C');
  balanced(h);
  const lines = h.split('\n');
  has(lines[0], 'tk-meta', '#include &lt;stdio.h&gt;');
  assert.equal(lines[1], '<span class="tk-com">/* a</span>');
  assert.equal(lines[2], '');
  has(lines[3], 'tk-com', ' b */'); has(lines[3], 'tk-ty', 'int'); has(lines[3], 'tk-fn', 'main');
});

test('escaping and unknown-language passthrough', () => {
  assert.equal(highlight('a < b && c > "d"', null), 'a &lt; b &amp;&amp; c &gt; &quot;d&quot;');
  assert.equal(highlight('if <x>', 'klingon'), 'if &lt;x&gt;');
  assert.equal(highlight('', 'python'), '');
  const h = highlight('if (a < b && c > d) x = "<&>";', 'c');
  assert.ok(!/<(?!\/?span)/.test(h), h);
  has(h, 'tk-str', '&quot;&lt;&amp;&gt;&quot;');
});

test('special languages: tex, html, json, yaml, diff, sql case-insensitive', () => {
  const t = highlight('\\begin{itemize} % note\n  \\item $x^2$ 50\\%\n\\end{itemize}', 'TeX');
  has(t, 'tk-meta', '\\begin'); has(t, 'tk-ty', 'itemize'); has(t, 'tk-com', '% note');
  has(t, 'tk-str', '$x^2$'); has(t, 'tk-meta', '\\%');
  const x = highlight('<!-- c -->\n<a href="u" disabled>T &amp; U</a>', 'html');
  has(x, 'tk-com', '&lt;!-- c --&gt;'); has(x, 'tk-meta', '&lt;a'); has(x, 'tk-ty', 'href'); has(x, 'tk-str', '&quot;u&quot;');
  has(x, 'tk-num', '&amp;amp;'); has(x, 'tk-meta', '&lt;/a');
  const j = highlight('{"k": "v", "n": -1.5e3, "b": true}', 'json');
  has(j, 'tk-ty', '&quot;k&quot;'); has(j, 'tk-str', '&quot;v&quot;'); has(j, 'tk-num', '1.5e3'); has(j, 'tk-kw', 'true');
  const y = highlight('---\nname: demo # c\nlist:\n  - yes\n', 'yaml');
  has(y, 'tk-meta', '---'); has(y, 'tk-ty', 'name'); has(y, 'tk-com', '# c'); has(y, 'tk-kw', 'yes');
  const d = highlight('--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n same', 'diff');
  has(d, 'tk-meta', '--- a'); has(d, 'tk-fn', '@@ -1 +1 @@'); has(d, 'tk-del', '-old'); has(d, 'tk-add', '+new');
  const q = highlight("SELECT name FROM t WHERE x = 'it''s' -- c", 'sql');
  has(q, 'tk-kw', 'SELECT'); has(q, 'tk-kw', 'FROM'); has(q, 'tk-com', '-- c');
  const m = highlight("y = x' + a';\ndisp('hi')", 'matlab');
  has(m, 'tk-str', "'hi'"); assert.ok(!m.includes("tk-str\">' + a'"));
});

const SNIPPETS: Record<string, string> = {
  python: '#!/usr/bin/env python3\n@dataclass\nclass P:\n    """Doc\n    string"""\n    def f(self, x: int = 0x1F) -> str:\n        return f"{x!r}" + b\'\\x00\'.decode()  # c\n',
  c: '#include "a.h"\n#define N 10\nint main(int argc, char **argv) {\n  /* multi\n     line */ printf("%d\\n", argc > N ? 1.5e-3 : \'c\');\n}\n',
  cpp: 'template <typename T>\nstd::vector<T> v{1, 2}; // c\nauto s = u8"x"; R"(raw)";\n',
  cuda: '__global__ void k(float *a) { int i = blockIdx.x * blockDim.x + threadIdx.x; a[i] = 0.f; }\nk<<<1, 256>>>(a);\n',
  glsl: '#version 330\nuniform vec3 c;\nvoid main() { gl_FragColor = vec4(mix(c, vec3(1.0), 0.5), 1.0); }\n',
  java: '@Override\npublic static void main(String[] args) { System.out.println("hi" + \'c\'); } // x\n',
  javascript: 'const f = async (x) => `t ${x}\nline`;\n// c\n/* b */ let $a = 0b101 && x <= 3;\n',
  typescript: 'interface A { x: number }\nexport function g<T>(a: T): Readonly<T> { return a as T; }\n',
  rust: '#[derive(Debug)]\nfn f<\'a>(s: &\'a str) -> Option<u8> { println!("{}", r"raw"); let c = \'x\'; None }\n',
  go: 'package main\nimport "fmt"\nfunc main() { s := `raw\nstring`; fmt.Println(s, \'r\', 1e9) }\n',
  kotlin: 'fun main() { val s = """a\nb"""; println("$s") }\n',
  swift: 'import Foundation\nfunc f(_ x: Int) -> String { return "\\(x)" }\n',
  scala: 'object M { def f(x: Int): Int = x * 2 } // c\n',
  csharp: '#region R\nusing System;\nvar s = @"C:\\path ""q""";\nConsole.WriteLine(s);\n',
  php: '<?php\n$x = 1; # c\necho "v $x"; // d\n?>\n',
  ruby: '=begin\nblock\n=end\ndef ok?(x) = x.nil? ? :none : @y # c\nputs "#{x}"\n',
  lua: '--[[ long\ncomment ]]\nlocal t = [[long\nstring]] -- c\nprint(#t)\n',
  perl: 'my @a = (1, 2); my %h; print "$a[0]\\n" if defined $h{x}; # c\n',
  bash: '#!/bin/bash\n$ echo "$HOME ${PATH}" \'raw $x\' # c\nfor f in *.txt; do cat "$f"; done\n',
  make: 'CC := gcc\nall: main.o\n\t$(CC) -o $@ $^ # c\n.PHONY: all\n',
  dockerfile: 'FROM node:22 AS build\nRUN npm ci && echo "${X}" # c\n',
  matlab: '%{\nblock\n%}\nA = [1 2; 3 4]\';\nfprintf(\'%d\\n\', A(1)); % c\n',
  r: 'f <- function(x) { data.frame(a = c(1, 2)) } # c\nprint(`odd name`)\n',
  julia: '#= block\n=# function f!(x::Vector{Float64}) @show x\'; "s"; \'c\' end\n',
  fortran: 'program p\n  implicit none\n  real :: x = 1.0d0 ! c\n  if (x > 0 .and. .true.) print *, \'hi\'\nend program\n',
  sql: 'SELECT a, COUNT(*) FROM t /* c */ WHERE b = \'x\'\'y\' GROUP BY a; -- d\n',
  haskell: 'module M where\n{- block\n-} f :: Int -> Int\nf x\' = x\' + 1 -- c\nmain = putStrLn "hi" >> print \'c\'\n',
  ocaml: '(* c\n *) let rec f (x : \'a list) = match x with [] -> 0 | _ :: t -> 1 + f t\n',
  lisp: '; c\n(defun fact (n) (if (<= n 1) 1 (* n (fact (- n 1))))) #| b |# "s"\n',
  erlang: '-module(m).\nf(X) -> io:format("~p~n", [X]), $a. % c\n',
  elixir: 'defmodule M do\n  @doc """\n  Doc\n  """\n  def ok?(x), do: :ok # c\nend\n',
  prolog: 'parent(tom, Bob) :- male(Bob), X is 1 + 2. % c\n/* b */\n',
  verilog: '`timescale 1ns/1ps\nmodule m(input wire clk, output reg [3:0] q);\nalways @(posedge clk) q <= 4\'b1010; // c\nendmodule\n',
  vhdl: 'library ieee;\nentity E is port (clk : in std_logic); end E; -- c\nif clk\'event and clk = \'1\' then\n',
  asm: '_start:\n  mov rax, 60 ; c\n  .globl main\n  movl %eax, %ebx # d\n',
  css: '@media (max-width: 600px) { .a:hover { color: #fff; margin: 1.5em -2px !important; } } /* c */\n',
  json: '{\n  "a": [1, -2.5e3, true, null],\n  "b": "s\\"q"\n}\n',
  yaml: '---\nkey: value # c\nlist:\n  - &a "q"\n  - *a\n  - \'s\'\n',
  toml: '[server]\nhost = "x" # c\n[[arr]]\nraw = \'C:\\p\'\nml = """a\nb"""\n',
  ini: '; c\n[section]\nkey = value\n# d\n',
  diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-old <a>\n+new & "b"\n ctx\n\\ No newline at end of file',
  tex: '\\documentclass{article}\n% comment\n\\begin{equation*}\n  E = mc^2 \\quad $x$ and $$\ny$$ 3.14 & \\\\\n\\end{equation*}\n',
  html: '<!DOCTYPE html>\n<p class="a\nb" data-x=1>Hi &amp; <b>bye</b><br/></p>\n<!-- multi\nline -->\n',
  xml: '<?xml version="1.0"?>\n<root a=\'1\'><![CDATA[<raw>\n]]></root>\n',
};

test('round-trip and line balance for every supported language', () => {
  for (const [lang, src] of Object.entries(SNIPPETS)) {
    assert.equal(normalizeLang(lang), lang, `${lang} is a canonical id`);
    const h = highlight(src, lang);
    assert.equal(unhtml(h), src, `round-trip ${lang}`);
    assert.ok(h.includes('<span'), `${lang} produced some highlighting`);
    balanced(h);
  }
});

test('robust on hostile input', () => {
  const nasty = ['"unterminated', '/* open', "'", '\\', '$', '<', '<a b="', '"""', '0x', '.5.', '\u{1F600}x', '\r\n\t', '`', '%{'];
  for (const lang of Object.keys(SNIPPETS)) for (const s of nasty) {
    const h = highlight(s, lang);
    assert.equal(unhtml(h), s, `${lang} ${JSON.stringify(s)}`);
    balanced(h);
  }
});

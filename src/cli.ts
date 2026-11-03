#!/usr/bin/env node
// Aurora CLI. Run `aurora help` for usage.
import { readFileSync, writeFileSync, watch, existsSync, mkdirSync, copyFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve, basename, join, relative, extname } from 'node:path';
import { tmpdir, networkInterfaces, homedir, platform } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { qrSvg, qrTerminal } from './qr.ts';
import { parseDeck, formatDiagnostic, type Deck } from './deck.ts';
import { emitHtml } from './emit.ts';
import { initChem } from './chem.ts';
import { renderReference } from './reference.ts';
import { loadSource } from './preprocess.ts';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const VERSION = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).version as string;

const HELP = `aurora ${VERSION}: Beamer .tex → manim-style animated HTML slides

usage:
  aurora build <deck.tex> [-o out.html] [--handout] [--json]
                                                   compile to one self-contained HTML file
  aurora serve <deck.tex> [--port 3000] [--remote]  live-reloading preview server; --remote opens
                                                   it to your network and prints a QR code so a
                                                   phone can drive the talk (notes, timer, next/back)
  aurora check <deck.tex> [--json] [--strict]      parse and report problems without writing
  aurora pdf <deck.tex> [-o out.pdf] [--all-steps] [--handout] [--notes]
                                                   print to PDF, one page per frame (needs playwright)
  aurora snapshot <deck.tex> [--out dir] [--slides 1,3-5] [--all-steps] [--json]
                                                   render PNGs of slides (needs playwright)
  aurora video <deck.tex> [-o out.webm|out.mp4] [--slides 1,3-5] [--fps 30] [--hold 2] [--scale 1]
                                                   render the animated deck to a video (needs playwright; ffmpeg)
  aurora init [dir] [--template basic|talk|chemistry]   start a new deck (+ aurora.sty, AGENTS.md)
  aurora reference [--json | --md]                 every scene command and its keys
  aurora help | --version

in the browser: → / space / click next · ← back · o overview · s speaker view · f fullscreen
                b black screen · l laser pointer · d draw · c clear drawing · a autoplay
                12⏎ go to slide 12 · ? help
docs: README.md, docs/REFERENCE.md, AGENTS.md (for AI agents)`;

const C = process.stdout.isTTY ? { y: '\x1b[33m', r: '\x1b[31m', g: '\x1b[32m', d: '\x1b[2m', x: '\x1b[0m' } : { y: '', r: '', g: '', d: '', x: '' };

const args = process.argv.slice(2);
const cmd = args[0];
const VALUE_FLAGS = /^(-o|--out|--port|--host|--template|--slides|--scale|--fps|--hold)$/;
const positional = args.slice(1).filter((a, i, arr) => !a.startsWith('-') && !(i > 0 && VALUE_FLAGS.test(arr[i - 1])));
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name: string) => args.includes(name);
const json = has('--json');

async function load(texPath: string): Promise<Deck> {
  if (!existsSync(texPath)) fail(`no such file: ${texPath}`);
  const inputWarnings: string[] = [];
  const source = loadSource(texPath, (m) => inputWarnings.push(m));
  if (/\\(Molecule|Transform)\b/.test(source.text)) await initChem();
  const deck = parseDeck(source, dirname(texPath), { handout: has('--handout') ? true : undefined, mainFile: basename(texPath) });
  deck.warnings.unshift(...inputWarnings.map((message) => ({ message })));
  return deck;
}

const strip = (h?: string) => (h ? h.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim() : undefined);

function summary(deck: Deck) {
  return deck.slides.map((s, i) => ({
    slide: i + 1,
    kind: s.kind,
    section: strip(s.section),
    title: strip(s.kind === 'title' ? deck.meta.title : s.title),
    steps: s.steps,
    notes: s.notes.length > 0,
  }));
}

function printWarnings(deck: Deck, file: string) {
  for (const w of deck.warnings) console.error(`${C.y}warning${C.x} ${relative(process.cwd(), file)}:${formatDiagnostic(w)}`);
}

function fail(msg: string): never {
  if (json) console.log(JSON.stringify({ ok: false, error: msg }));
  else console.error(`${C.r}error${C.x} ${msg}`);
  process.exit(1);
}

function parseSlides(spec: string | undefined, n: number): number[] {
  if (!spec) return Array.from({ length: n }, (_, i) => i + 1);
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map((x) => parseInt(x, 10));
    for (let i = a; i <= (b || a); i++) if (i >= 1 && i <= n) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}

async function loadOrFail(texPath: string): Promise<Deck> {
  try { return await load(texPath); } catch (e) { fail((e as Error).message); }
}

/** ffmpeg on PATH, or the build Playwright downloads for its own recordings (VP9 only). */
function findFfmpeg(): string | null {
  const exe = platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  for (const dir of (process.env.PATH ?? '').split(platform() === 'win32' ? ';' : ':')) if (dir && existsSync(join(dir, exe))) return join(dir, exe);
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH
    || (platform() === 'darwin' ? join(homedir(), 'Library/Caches/ms-playwright') : platform() === 'win32' ? join(process.env.LOCALAPPDATA ?? '', 'ms-playwright') : join(homedir(), '.cache/ms-playwright'));
  try {
    for (const d of readdirSync(cache).filter((n) => n.startsWith('ffmpeg-')).sort().reverse()) {
      for (const f of readdirSync(join(cache, d))) if (/^ffmpeg(-|\.|$)/.test(f)) return join(cache, d, f);
    }
  } catch { /* no cache */ }
  return null;
}

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); return; }
  if (cmd === '--version' || cmd === '-v' || cmd === 'version') { console.log(VERSION); return; }

  if (cmd === 'reference') {
    console.log(renderReference(json ? 'json' : has('--md') ? 'md' : 'text'));
    return;
  }

  if (cmd === 'init') {
    const dir = resolve(positional[0] ?? '.');
    const tpl = flag('--template') ?? 'basic';
    const src = join(pkgRoot, 'templates', `${tpl}.tex`);
    if (!existsSync(src)) fail(`unknown template "${tpl}" (available: basic, talk, chemistry)`);
    mkdirSync(dir, { recursive: true });
    const deck = join(dir, 'deck.tex');
    if (existsSync(deck)) fail(`${deck} already exists`);
    copyFileSync(src, deck);
    copyFileSync(join(pkgRoot, 'tex', 'aurora.sty'), join(dir, 'aurora.sty'));
    if (!existsSync(join(dir, 'AGENTS.md'))) copyFileSync(join(pkgRoot, 'templates', 'AGENTS.deck.md'), join(dir, 'AGENTS.md'));
    const rel = relative(process.cwd(), deck) || 'deck.tex';
    console.log(`created ${rel}, aurora.sty and AGENTS.md\nnext: aurora serve ${rel}`);
    return;
  }

  const file = positional[0];
  if (!file) { console.error(HELP); process.exit(2); }
  const texPath = resolve(file);

  if (cmd === 'check') {
    const deck = await loadOrFail(texPath);
    const ok = !(has('--strict') && deck.warnings.length);
    if (json) console.log(JSON.stringify({ ok, slides: summary(deck), warnings: deck.warnings }, null, 2));
    else {
      printWarnings(deck, texPath);
      const steps = deck.slides.reduce((s, x) => s + x.steps, 0);
      console.log(`${ok ? C.g + '✓' : C.r + '✗'}${C.x} ${deck.slides.length} slides, ${steps} steps, ${deck.scenes.length} scenes, ${deck.warnings.length} warning(s)`);
    }
    process.exit(ok ? 0 : 1);
  }

  if (cmd === 'build') {
    const t0 = performance.now();
    const deck = await loadOrFail(texPath);
    const out = resolve(flag('-o') ?? texPath.replace(/\.tex$/, '') + '.html');
    const html = emitHtml(deck);
    writeFileSync(out, html);
    const ms = Math.round(performance.now() - t0);
    if (json) console.log(JSON.stringify({ ok: true, output: out, bytes: html.length, ms, slides: summary(deck), warnings: deck.warnings }, null, 2));
    else {
      printWarnings(deck, texPath);
      console.log(`built ${relative(process.cwd(), out)} ${C.d}(${deck.slides.length} slides, ${(html.length / 1024).toFixed(0)} KB, ${ms} ms)${C.x}`);
    }
    return;
  }

  if (cmd === 'serve') {
    const port = Number(flag('--port') ?? 3000);
    // --remote: listen on every interface so a phone on the same network can open the
    // speaker view and drive the talk. The server relays navigation between all windows.
    const remote = has('--remote');
    const host = flag('--host') ?? (remote ? '0.0.0.0' : '127.0.0.1');
    const lanIp = () => {
      for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) return i.address;
      return null;
    };
    const remoteUrl = remote ? `http://${host === '0.0.0.0' ? lanIp() ?? '127.0.0.1' : host}:${port}/?presenter` : null;
    let html = '';
    const clients = new Set<ServerResponse>();
    // Last known position, sent to windows that join late (a phone opened mid-talk).
    let position: { s: number; k: number } | null = null;
    const readBody = (req: IncomingMessage) => new Promise<string>((ok) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => ok(b)); });
    const rebuild = async () => {
      try {
        const t0 = performance.now();
        const deck = await load(texPath);
        printWarnings(deck, texPath);
        html = emitHtml(deck, { live: true });
        console.log(`${C.d}rebuilt in ${Math.round(performance.now() - t0)} ms${C.x}`);
      } catch (e) {
        const msg = (e as Error).message;
        console.error(`${C.r}error${C.x} ${msg}`);
        html = `<body style="background:#16181c;color:#d9775a;font:20px monospace;padding:40px"><pre>${msg.replace(/</g, '&lt;')}</pre><script>new EventSource('/__aurora_events').onmessage=()=>location.reload()</script>`;
      }
      for (const c of clients) c.write('data: reload\n\n');
    };
    await rebuild();
    let timer: NodeJS.Timeout | undefined;
    watch(dirname(texPath), { recursive: true }, (_ev, name) => {
      if (!name || /\.(html|log|aux|nav|snm|toc|out|pdf|synctex(\.gz)?|fls|fdb_latexmk|vrb)$/.test(name) || /(^|\/)(snapshots|node_modules|\.git)\//.test(name)) return;
      clearTimeout(timer);
      timer = setTimeout(rebuild, 150);
    });
    createServer(async (req, res) => {
      const path = (req.url ?? '/').split('?')[0];
      if (path === '/__aurora_events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(': connected\n\n');
        if (position) res.write(`data: ${JSON.stringify({ type: 'jump', ...position })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (path === '/__aurora_sync' && req.method === 'POST') {
        // A window moved (or toggled the screen, or pointed the laser): tell the others.
        const body = await readBody(req);
        try {
          const msg = JSON.parse(body);
          if (typeof msg.s === 'number' && typeof msg.k === 'number' && (msg.type === 'next' || msg.type === 'jump')) position = { s: msg.s, k: msg.k };
          for (const c of clients) c.write(`data: ${body}\n\n`);
        } catch { /* ignore malformed */ }
        res.writeHead(204); res.end();
        return;
      }
      if (path === '/__aurora_remote') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ url: remoteUrl }));
        return;
      }
      if (path === '/__aurora_qr.svg' && remoteUrl) {
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
        res.end(qrSvg(remoteUrl, { fg: '#000', bg: '#fff' }));
        return;
      }
      if (path === '/remote') { res.writeHead(302, { location: '/?presenter' }); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
    }).listen(port, host, () => {
      console.log(`serving ${basename(texPath)} at ${C.g}http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/${C.x}  (reloads on save, ctrl-c to stop)`);
      if (remoteUrl) console.log(`phone remote: ${C.g}${remoteUrl}${C.x}  (scan with the phone's camera; also shown in the speaker view)\n\n${qrTerminal(remoteUrl)}\n`);
    });
    return;
  }

  if (cmd === 'video') {
    let pw: any;
    try { const mod = 'playwright'; pw = await import(mod); } catch {
      fail('video needs Playwright: npm i -D playwright && npx playwright install chromium');
    }
    const t0 = performance.now();
    const deck = await loadOrFail(texPath);
    const out = resolve(flag('-o') ?? texPath.replace(/\.tex$/, '') + '.webm');
    const fps = Number(flag('--fps') ?? 30), hold = Number(flag('--hold') ?? 2), scale = Number(flag('--scale') ?? 1);
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) fail('video needs ffmpeg: install it (brew install ffmpeg), or run `npx playwright install ffmpeg`');
    const encoders = (() => { try { return execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' }); } catch { return ''; } })();
    const mp4 = extname(out).toLowerCase() === '.mp4';
    if (mp4 && !/\blibx264\b/.test(encoders)) fail(`${ffmpeg} cannot encode H.264 (no libx264). Write a .webm instead, or install a full ffmpeg (brew install ffmpeg).`);
    if (!mp4 && !/\blibvpx-vp9\b/.test(encoders)) fail(`${ffmpeg} cannot encode VP9. Write an .mp4 instead, or install a full ffmpeg.`);
    const codec = mp4 ? ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart'] : ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-row-mt', '1'];
    // Lossless PNG frames when the ffmpeg can read them; Playwright's build only decodes JPEG.
    const decoders = (() => { try { return execFileSync(ffmpeg, ['-hide_banner', '-decoders'], { encoding: 'utf8' }); } catch { return ''; } })();
    const frameType: 'png' | 'jpeg' = /^\s*V[^\n]*\bpng\b/m.test(decoders) ? 'png' : 'jpeg';
    // `pipe:0`, not `-`: ffmpeg ≥ 6.1 maps `-` to the `fd:` protocol, which minimal builds (Playwright's) lack.
    const enc = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-vcodec', frameType === 'png' ? 'png' : 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0', ...codec, out], { stdio: ['pipe', 'inherit', 'inherit'] });
    enc.stdin.on('error', () => { /* reported through the exit code */ });
    const encDone = new Promise<number>((ok) => enc.on('close', (code) => ok(code ?? 1)));
    const tmp = join(mkdtempSync(join(tmpdir(), 'aurora-')), 'deck.html');
    writeFileSync(tmp, emitHtml(deck));
    const browser = await pw.chromium.launch();
    const page = await browser.newPage({ viewport: { width: deck.meta.width, height: 1080 }, deviceScaleFactor: scale });
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(String(e)));
    await page.goto(pathToFileURL(tmp).href + '?capture');
    await page.waitForFunction(() => (window as any).aurora);
    let frames = 0;
    const write = (buf: Buffer) => new Promise<void>((ok, bad) => {
      if (enc.exitCode !== null) { bad(new Error(`ffmpeg exited early with code ${enc.exitCode}`)); return; }
      if (enc.stdin.write(buf)) ok();
      else { const done = () => { enc.off('close', done); ok(); }; enc.stdin.once('drain', done); enc.once('close', done); }
    });
    // Every step is captured frame by frame with the engine's clock frozen, so the result
    // is deterministic whatever the machine's speed: animation first, then `hold` seconds still.
    // The move and the first seek happen in one evaluate, so no real frame slips in between.
    const captureStep = async (len: number) => {
      const n = Math.ceil((len + hold) * fps);
      if (process.env.AURORA_DEBUG) console.error(`step: ${len.toFixed(2)} s animation + ${hold} s hold = ${n} frames`);
      for (let f = 0; f < n; f++) {
        await page.evaluate((ms: number) => (window as any).aurora.seek(ms), (f / fps) * 1000);
        await write(await page.screenshot(frameType === 'png' ? { type: 'png' } : { type: 'jpeg', quality: 95 }));
        frames++;
      }
    };
    const chosen = parseSlides(flag('--slides'), deck.slides.length);
    try {
      for (const n of chosen) {
        if (!json) process.stderr.write(`${C.d}slide ${n}/${deck.slides.length}${C.x}\r`);
        // finish() first: a click during a running animation only completes it (as for a presenter).
        await captureStep(await page.evaluate((s: number) => { const a = (window as any).aurora; a.finish(); a.enter(s); a.seek(0); return a.stepLength(); }, n - 1));
        for (let k = 1; k < deck.slides[n - 1].steps; k++) {
          await captureStep(await page.evaluate(() => { const a = (window as any).aurora; a.finish(); a.next(); a.seek(0); return a.stepLength(); }));
        }
      }
    } catch (e) {
      await browser.close().catch(() => {});
      fail((e as Error).message);
    }
    await browser.close().catch(() => {});
    enc.stdin.end();
    const code = await encDone;
    if (code !== 0) fail(`ffmpeg exited with code ${code}`);
    const ms = Math.round(performance.now() - t0);
    if (json) console.log(JSON.stringify({ ok: errors.length === 0, output: out, frames, seconds: frames / fps, ms, runtimeErrors: errors, warnings: deck.warnings }, null, 2));
    else {
      printWarnings(deck, texPath);
      for (const e of errors) console.error(`${C.r}runtime error${C.x} ${e}`);
      console.log(`wrote ${relative(process.cwd(), out)} ${C.d}(${chosen.length} slides, ${(frames / fps).toFixed(1)} s at ${fps} fps, ${ms} ms)${C.x}`);
    }
    return;
  }

  if (cmd === 'pdf') {
    let pw: any;
    try { const mod = 'playwright'; pw = await import(mod); } catch {
      fail('pdf needs Playwright: npm i -D playwright && npx playwright install chromium');
    }
    const t0 = performance.now();
    const deck = await loadOrFail(texPath);
    const out = resolve(flag('-o') ?? texPath.replace(/\.tex$/, '') + '.pdf');
    const tmp = join(mkdtempSync(join(tmpdir(), 'aurora-')), 'deck.html');
    writeFileSync(tmp, emitHtml(deck));
    const w = deck.meta.width, h = 1080;
    const browser = await pw.chromium.launch();
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(String(e)));
    await page.goto(pathToFileURL(tmp).href);
    await page.waitForFunction(() => (window as any).aurora);
    const pages = await page.evaluate(([all, notes]: boolean[]) => (window as any).aurora.printLayout(all ? 'all' : 'last', { notes }), [has('--all-steps'), has('--notes')]);
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: out, width: `${w}px`, height: `${h}px`, printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    await browser.close();
    const ms = Math.round(performance.now() - t0);
    if (json) console.log(JSON.stringify({ ok: errors.length === 0, output: out, pages, ms, runtimeErrors: errors, warnings: deck.warnings }, null, 2));
    else {
      printWarnings(deck, texPath);
      for (const e of errors) console.error(`${C.r}runtime error${C.x} ${e}`);
      console.log(`wrote ${relative(process.cwd(), out)} ${C.d}(${pages} pages, ${ms} ms)${C.x}`);
    }
    return;
  }

  if (cmd === 'snapshot') {
    let pw: any;
    try { const mod = 'playwright'; pw = await import(mod); } catch {
      fail('snapshot needs Playwright: npm i -D playwright && npx playwright install chromium');
    }
    const deck = await loadOrFail(texPath);
    const outDir = resolve(flag('--out') ?? join(dirname(texPath), 'snapshots'));
    mkdirSync(outDir, { recursive: true });
    const tmp = join(mkdtempSync(join(tmpdir(), 'aurora-')), 'deck.html');
    writeFileSync(tmp, emitHtml(deck));
    const scale = Number(flag('--scale') ?? 0.5);
    const browser = await pw.chromium.launch();
    const page = await browser.newPage({ viewport: { width: deck.meta.width, height: 1080 }, deviceScaleFactor: scale });
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(String(e)));
    page.on('console', (m: any) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(pathToFileURL(tmp).href);
    await page.waitForFunction(() => (window as any).aurora);
    const shots: { slide: number; step: number; file: string; overflow: boolean; scale: number }[] = [];
    for (const n of parseSlides(flag('--slides'), deck.slides.length)) {
      const steps = deck.slides[n - 1].steps;
      const ks = has('--all-steps') ? Array.from({ length: steps }, (_, k) => k) : [steps - 1];
      for (const k of ks) {
        const { overflow, fit } = await page.evaluate(([s, kk]: number[]) => {
          (window as any).aurora.jump(s, kk);
          (window as any).aurora.finish();
          const body = document.querySelector('.slide.active .body') as HTMLElement | null;
          const fit = body ? parseFloat(body.style.zoom || '1') : 1;
          return { overflow: !!body && body.scrollHeight > body.clientHeight + 4, fit };
        }, [n - 1, k]);
        await page.waitForTimeout(60);
        const f = join(outDir, `slide-${String(n).padStart(2, '0')}${ks.length > 1 ? `-step${k + 1}` : ''}.png`);
        await page.screenshot({ path: f });
        shots.push({ slide: n, step: k + 1, file: f, overflow, scale: fit });
      }
    }
    await browser.close();
    const overflowing = [...new Set(shots.filter((s) => s.overflow).map((s) => s.slide))];
    // Slides the runtime had to shrink noticeably to fit: a hint to cut or split.
    const shrunk = [...new Map(shots.filter((s) => s.scale < 0.9).map((s) => [s.slide, { slide: s.slide, scale: s.scale }])).values()];
    if (json) console.log(JSON.stringify({ ok: errors.length === 0, shots, overflowing, shrunk, runtimeErrors: errors, warnings: deck.warnings }, null, 2));
    else {
      printWarnings(deck, texPath);
      for (const o of overflowing) console.error(`${C.y}warning${C.x} slide ${o}: content overflows the slide`);
      for (const o of shrunk) console.error(`${C.y}warning${C.x} slide ${o.slide}: content shrunk to ${Math.round(o.scale * 100)}% to fit`);
      for (const e of errors) console.error(`${C.r}runtime error${C.x} ${e}`);
      console.log(`wrote ${shots.length} PNG(s) to ${relative(process.cwd(), outDir) || '.'}`);
    }
    return;
  }

  console.error(HELP);
  process.exit(2);
}

await main();

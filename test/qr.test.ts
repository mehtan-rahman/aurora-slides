// QR encoder: structure checks. Decoding was verified end to end with jsQR for every
// error-correction level and versions 1–37 (see CHANGELOG 0.2.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr, qrSvg, qrTerminal } from '../src/qr.ts';

const finderAt = (m: boolean[][], x0: number, y0: number) => {
  for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
    const edge = dx === 0 || dx === 6 || dy === 0 || dy === 6;
    const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
    if (m[y0 + dy][x0 + dx] !== (edge || core)) return false;
  }
  return true;
};

test('smallest version that fits, and the expected sizes', () => {
  assert.equal(encodeQr('A').version, 1);
  assert.equal(encodeQr('A').size, 21);
  assert.equal(encodeQr('http://192.168.1.100:3000/?presenter').version, 3);
  assert.equal(encodeQr('x'.repeat(50), 'M').version, 4); // 3-M holds 44 bytes
  assert.equal(encodeQr('x'.repeat(50), 'L').version, 3); // 3-L holds 53
  assert.equal(encodeQr('y'.repeat(120)).version, 7); // carries version information
  assert.throws(() => encodeQr('z'.repeat(3000)), /too long/);
});

test('finder patterns, timing lines and the dark module are in place', () => {
  for (const text of ['A', 'hello world', 'q'.repeat(400)]) {
    const { size, modules } = encodeQr(text);
    assert.ok(finderAt(modules, 0, 0) && finderAt(modules, size - 7, 0) && finderAt(modules, 0, size - 7), `finders for ${text.length} chars`);
    for (let i = 8; i < size - 8; i++) {
      assert.equal(modules[6][i], i % 2 === 0, 'horizontal timing');
      assert.equal(modules[i][6], i % 2 === 0, 'vertical timing');
    }
    assert.equal(modules[size - 8][8], true, 'dark module');
  }
});

test('the two copies of the format information agree', () => {
  const { size, modules } = encodeQr('format check', 'Q');
  const a: boolean[] = [], b: boolean[] = [];
  for (let i = 0; i <= 5; i++) a.push(modules[i][8]);
  a.push(modules[7][8], modules[8][8], modules[8][7]);
  for (let i = 9; i < 15; i++) a.push(modules[8][14 - i]);
  for (let i = 0; i < 8; i++) b.push(modules[8][size - 1 - i]);
  for (let i = 8; i < 15; i++) b.push(modules[size - 15 + i][8]);
  assert.deepEqual(a, b);
  // Level Q is binary 11 in the top two format bits; XOR with the 0x5412 mask (top bits 10)
  // leaves 01 in the code.
  assert.deepEqual([a[14], a[13]], [false, true]);
});

test('UTF-8 is encoded in byte mode', () => {
  const ascii = encodeQr('u'.repeat(14)), utf = encodeQr('ü'.repeat(7)); // both 14 bytes
  assert.equal(ascii.version, utf.version);
});

test('SVG and terminal renderings', () => {
  const svg = qrSvg('aurora', { fg: '#111', bg: '#eee' });
  assert.match(svg, /^<svg [^>]*viewBox="0 0 29 29"/); // 21 + 2 × 4 quiet zone
  assert.match(svg, /fill="#111"/);
  const term = qrTerminal('aurora');
  const lines = term.split('\n');
  assert.equal(lines.length, Math.ceil((21 + 4) / 2));
  assert.ok(lines.every((l) => l.length === 25 && /^[ ▀▄█]+$/.test(l)));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siNum, siUnit, siQty, siRange, siAngle } from '../src/units.ts';

test('siNum: exponents, signs, uncertainty, products, decimal comma', () => {
  assert.equal(siNum('1.5e3'), '1.5\\times10^{3}');
  assert.equal(siNum('1.5E-3'), '1.5\\times10^{-3}');
  assert.equal(siNum('1.5d3'), '1.5\\times10^{3}');
  assert.equal(siNum('6.022e23'), '6.022\\times10^{23}');
  assert.equal(siNum('e5'), '10^{5}');
  assert.equal(siNum('-3'), '-3');
  assert.equal(siNum('1+-0.2'), '1\\pm0.2');
  assert.equal(siNum('1 \\pm 0.2'), '1\\pm0.2');
  assert.equal(siNum('1.23(4)'), '1.23(4)');
  assert.equal(siNum('2x3'), '2\\times3');
  assert.equal(siNum('2 \\times 3'), '2\\times3');
  assert.equal(siNum('1,5'), '1.5');
  assert.equal(siNum(' 1 . 5 '), '1.5');
});

test('siNum: digit grouping from 5 digits', () => {
  assert.equal(siNum('12345.678901'), '12\\,345.678\\,901');
  assert.equal(siNum('1234'), '1234');
  assert.equal(siNum('0.1234'), '0.1234');
  assert.equal(siNum('1234567'), '1\\,234\\,567');
});

test('siUnit: macros, prefixes, powers', () => {
  const v = siUnit('\\kilo\\meter\\per\\second');
  assert.match(v, /km/);
  assert.match(v, /s\}\^\{-1\}/);
  assert.equal(v, '\\mathrm{km}\\,\\mathrm{s}^{-1}');
  assert.equal(siUnit('\\meter\\per\\second\\squared'), '\\mathrm{m}\\,\\mathrm{s}^{-2}');
  assert.equal(siUnit('\\square\\centi\\meter'), '\\mathrm{cm}^{2}');
  assert.equal(siUnit('\\cubic\\deci\\metre'), '\\mathrm{dm}^{3}');
  assert.equal(siUnit('\\meter\\tothe{4}'), '\\mathrm{m}^{4}');
  assert.equal(siUnit('\\raiseto{5}\\second'), '\\mathrm{s}^{5}');
  assert.match(siUnit('\\micro\\meter'), /\\mu ?m/);
  assert.equal(siUnit('\\kilo\\ohm'), '\\mathrm{k\\Omega}');
  assert.match(siUnit('\\degreeCelsius'), /\\circ\}C/);
  assert.equal(siUnit('\\percent'), '\\mathrm{\\%}');
  assert.equal(siUnit('\\joule\\per\\mole\\per\\kelvin'), '\\mathrm{J}\\,\\mathrm{mol}^{-1}\\,\\mathrm{K}^{-1}');
  assert.equal(siUnit('\\giga\\electronvolt'), '\\mathrm{GeV}');
  assert.equal(siUnit('\\foo'), '\\foo');
});

test('siUnit: literal units', () => {
  assert.equal(siUnit('m/s'), '\\mathrm{m}/\\mathrm{s}');
  assert.equal(siUnit('kg.m^2.s^{-2}'), '\\mathrm{kg}\\,\\mathrm{m}^{2}\\,\\mathrm{s}^{-2}');
  assert.equal(siUnit('\\meter/\\second'), '\\mathrm{m}/\\mathrm{s}');
  assert.equal(siUnit('N~m'), '\\mathrm{N}\\,\\mathrm{m}');
});

test('siQty, siRange, siAngle', () => {
  assert.equal(siQty('9.81', '\\meter\\per\\second\\squared'), '9.81\\,\\mathrm{m}\\,\\mathrm{s}^{-2}');
  assert.equal(siQty('1.5 \\pm 0.1', '\\meter'), '(1.5\\pm0.1)\\,\\mathrm{m}');
  assert.equal(siQty('30', '\\degree'), '30\\mathrm{{}^{\\circ}}');
  assert.equal(siRange('1', '5', '\\meter'), '1\\text{–}5\\,\\mathrm{m}');
  assert.equal(siRange('1', '5'), '1\\text{–}5');
  assert.equal(siAngle('30'), '30^{\\circ}');
  assert.equal(siAngle('1;2;3'), "1^{\\circ}2'3''");
  assert.equal(siAngle(';;3'), "3''");
});

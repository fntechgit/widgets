import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireExports } from '../../src/shims/require-exports.js';

// Served modules as a require() caller sees them through the bridge.
const Company = () => null;
const findExistingCompany = () => null;

test('requireExports: an old-style CJS module is handed over as its own exports object', () => {
  const cjs = { __esModule: true, default: Company, findExistingCompany };
  const out = requireExports({ default: cjs, findExistingCompany });
  assert.equal(out, cjs);
  assert.equal(out.default, Company);
  assert.equal(out.findExistingCompany, findExistingCompany);
});

test('requireExports: a browser-ESM module with default + named merges into one CJS object', () => {
  const tooltipClasses = { root: 'x' };
  const out = requireExports({ default: Company, tooltipClasses });
  assert.equal(out.__esModule, true);
  assert.equal(out.default, Company);
  assert.equal(out.tooltipClasses, tooltipClasses);
});

test('requireExports: default only hands over the default; no default hands over the namespace', () => {
  const cjs = { __esModule: true, default: Company };
  assert.equal(requireExports({ default: cjs }), cjs);
  const ns = { alpha: 1 };
  assert.equal(requireExports(ns), ns);
});

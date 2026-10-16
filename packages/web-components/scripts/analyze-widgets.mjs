#!/usr/bin/env node
/**
 * READ-ONLY diagnostic + CI guard over the widget runtime signatures computed in
 * footprint.mjs (dependency footprint → RULES → requirements, plus the
 * uicore-path drift check against the served runtime surface).
 *
 *   node scripts/analyze-widgets.mjs (or the widgets-analyze bin)   # human report
 *   node scripts/analyze-widgets.mjs --check   # CI guard (exit 1 on drift; root pnpm analyze:check)
 *   widgets-analyze --update-baseline  # accept the current unknowns (workspace only)
 *
 * Step 3 of RUNTIME-REQUIREMENTS.md. No build side effects.
 *
 * --check fails when a uicore path is imported but outside the served runtime surface
 * (would resolve to {} in the shared build), or when a NEW unrecognized dep
 * appears that is neither covered by a RULES entry nor in the accepted baseline
 * (analyze-widgets.baseline.json). Growing the baseline is a conscious action:
 * either add a RULES entry (classify it) or run --update-baseline (accept it).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeFleet } from './footprint.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
// The discovery footprint must be identical on every machine: ambient
// NODE_ENV (set globally on CI hosts) must not reach the esbuild graph.
process.env.NODE_ENV = 'development';

const BASELINE_FILE = path.join(dir, 'analyze-widgets.baseline.json');
// --update-baseline writes next to this script — running the installed bin
// would write into a host's node_modules, silently lost on reinstall.
if (process.argv.includes('--update-baseline') && dir.includes(`${path.sep}node_modules${path.sep}`)) {
  console.error('--update-baseline must run from the widgets workspace, not an installed copy');
  process.exit(1);
}
const rel = (p) => path.relative(process.cwd(), p);
const self = rel(fileURLToPath(import.meta.url));

const {
  sigs, exposed, allUnknown, errored, declIssues,
  muiExposed, muiUnion, muiMissing, muiUnused, barrelImports,
} = await analyzeFleet();


// Flatten barrel findings to "widget:lib" so they can be baselined like unknowns.
const currentBarrels = barrelImports.flatMap((b) => b.barrels.map((l) => `${b.name}:${l}`)).sort();

const mode = process.argv.includes('--check')
  ? 'check'
  : process.argv.includes('--update-baseline')
    ? 'update'
    : 'report';

// ─── --update-baseline: accept the current unknowns ──────────────────────────
if (mode === 'update') {
  await fs.writeFile(
    BASELINE_FILE,
    JSON.stringify(
      { acceptedUnknown: allUnknown, acceptedBarrels: currentBarrels, acceptedMuiMissing: muiMissing },
      null,
      2,
    ) + '\n',
  );
  console.log(`Baseline written: ${rel(BASELINE_FILE)}`);
  console.log(`  acceptedUnknown (${allUnknown.length}): ${allUnknown.join(', ') || '(none)'}`);
  console.log(`  acceptedBarrels (${currentBarrels.length}): ${currentBarrels.join(', ') || '(none)'}`);
  console.log(`  acceptedMuiMissing (${muiMissing.length}): ${muiMissing.join(', ') || '(none)'}`);
  process.exit(0);
}

// ─── --check: CI guard (exit non-zero on drift) ──────────────────────────────
if (mode === 'check') {
  let baseline;
  try {
    baseline = JSON.parse(await fs.readFile(BASELINE_FILE, 'utf8'));
  } catch {
    console.error(`✗ no baseline — run:  node ${self} --update-baseline`);
    process.exit(2);
  }
  // Fail policy: things that BREAK at runtime hard-fail always (widgets not
  // analyzable, MISSING uicore/@mui paths → resolve to {}, declared≠derived
  // needs). Deferrable SMELLS are baselined and fail only when NEW: unrecognized
  // deps (acceptedUnknown), bare-barrel imports (acceptedBarrels), and @mui
  // specifiers the served MUI surface omits (acceptedMuiMissing: a widget that
  // imports an MUI barrel bundles its own MUI copy until its barrel-to-subpath
  // release lands; it works, it is just bigger).
  const accepted = new Set(baseline.acceptedUnknown || []);
  const newUnknown = allUnknown.filter((d) => !accepted.has(d));
  const staleAccepted = [...accepted].filter((d) => !allUnknown.includes(d));
  const acceptedBarrels = new Set(baseline.acceptedBarrels || []);
  const newBarrels = currentBarrels.filter((b) => !acceptedBarrels.has(b));
  const staleBarrels = [...acceptedBarrels].filter((b) => !currentBarrels.includes(b));
  const acceptedMui = new Set(baseline.acceptedMuiMissing || []);
  const newMuiMissing = muiMissing.filter((p) => !acceptedMui.has(p));
  const staleMuiMissing = [...acceptedMui].filter((p) => !muiMissing.includes(p));

  if (errored.length || newUnknown.length || declIssues.length || newMuiMissing.length || newBarrels.length) {
    console.error('✗ widget runtime-requirements check FAILED\n');
    if (errored.length) {
      console.error('WIDGETS NOT ANALYZABLE:');
      console.error(errored.map((s) => `  ✗ ${s.name}: ${s.error}`).join('\n') + '\n');
    }
    if (declIssues.length) {
      console.error('runtimeNeeds DECLARATION mismatch (manifest vs real footprint):');
      for (const d of declIssues) {
        if (d.undeclared.length) console.error(`  ✗ ${d.name}: needs but does not declare — ${d.undeclared.join(', ')}`);
        if (d.overdeclared.length) console.error(`  ✗ ${d.name}: declares but no longer needs — ${d.overdeclared.join(', ')}`);
        if (d.unknownNeed.length) console.error(`  ✗ ${d.name}: unknown runtimeNeeds token — ${d.unknownNeed.join(', ')}`);
      }
      console.error('');
    }
    if (newUnknown.length) {
      console.error('NEW unrecognized deps (add a RULES entry to classify, or --update-baseline to accept):');
      console.error(newUnknown.map((d) => '  ? ' + d).join('\n') + '\n');
    }
    if (newMuiMissing.length) {
      console.error('NEW @mui barrel roots (a whole-package import bundles its own MUI copy — import the subpath(s) upstream, or --update-baseline to accept):');
      console.error(newMuiMissing.map((p) => '  ✗ ' + p).join('\n') + '\n');
    }
    if (newBarrels.length) {
      console.error('NEW barrel imports of subpath-capable libs (import the subpath(s) used, or --update-baseline to accept):');
      console.error(newBarrels.map((b) => '  ✗ ' + b).join('\n') + '\n');
    }
    process.exit(1);
  }
  console.log('✓ widget runtime-requirements check passed');
  console.log(`  ${sigs.length} widgets · ${exposed.size} uicore paths served · runtimeNeeds match footprint · ${allUnknown.length} accepted-unknown deps`);
  console.log(`  MUI surface: ${muiExposed.size} exposed, ${muiUnion.length} imported, all resolved`);
  if (staleAccepted.length) {
    console.log(`  note: ${staleAccepted.length} baseline dep(s) no longer imported (prunable via --update-baseline): ${staleAccepted.join(', ')}`);
  }
  if (staleBarrels.length) {
    console.log(`  note: ${staleBarrels.length} baseline barrel(s) no longer imported (prunable via --update-baseline): ${staleBarrels.join(', ')}`);
  }
  if (staleMuiMissing.length) {
    console.log(`  note: ${staleMuiMissing.length} baseline MUI-missing entr(ies) now resolved (prunable via --update-baseline): ${staleMuiMissing.join(', ')}`);
  }
  process.exit(0);
}

// ─── report: human-readable (default) ────────────────────────────────────────
console.log('\n=== Per-widget runtime signatures (derived from dist + kit footprint + RULES) ===\n');
for (const s of sigs) {
  if (s.error) { console.log(`• ${s.name}: ERROR — ${s.error}`); continue; }
  console.log(`• ${s.name}  [${s.pkg}]   react=${s.reactVersion}  mui=${s.muiVersion ?? 'none'}`);
  console.log(`    requirements: ${s.requirements.length ? s.requirements.map((r) => r.id).join(', ') : '(none)'}`);
  for (const r of s.requirements) console.log(`        ${r.id}  ← ${r.by.join(', ')}  (${r.note})`);
  console.log(`    runtimeNeeds: declared [${s.declaredNeeds.join(', ') || '—'}]  derived [${s.derivedNeeds.join(', ') || '—'}]`);
  if (s.node.length) console.log(`    node builtins: ${s.node.join(', ')}`);
  console.log(`    dist deps (${s.dist.length}): ${s.dist.join(', ') || '(none)'}`);
  console.log(`    kit deps (${s.kit.length}): ${s.kit.join(', ') || '(none)'}`);
  console.log(`    UNKNOWN deps (no rule, not benign — review): ${s.unknown.length ? s.unknown.join(', ') : '(none)'}`);
  console.log(`    uicore paths: ${s.uicore.length}`);
}

const listOr = (items, mark) => (items.length ? items.map((p) => `  ${mark} ${p}`).join('\n') : '  (none)');

console.log('\n=== uicore surface served by the runtime ===\n');
console.log(`  ${exposed.size} paths: every uicore path a widget imports, plus UICORE_ALWAYS_SERVED`);

console.log('\n=== Drift: @mui/@emotion specifiers needed vs the served MUI surface ===\n');
console.log(`imported: ${muiUnion.length}   exposed: ${muiExposed.size}`);
console.log('\nMISSING (imported, not exposed → resolves to {} at runtime):');
console.log(listOr(muiMissing, '✗'));
console.log('\nUNUSED (exposed, no widget imports it → candidate to drop):');
console.log(listOr(muiUnused, '–'));

console.log('\n=== Barrel imports (subpath-capable libs imported whole — bundle-size smell) ===\n');
if (!barrelImports.length) {
  console.log('  (none — every subpath-capable lib is imported by subpath)');
} else {
  for (const b of barrelImports) console.log(`  ✗ ${b.name}: ${b.barrels.join(', ')}`);
}
console.log(`\nTip: 'node ${self} --check' enforces this in CI.\n`);

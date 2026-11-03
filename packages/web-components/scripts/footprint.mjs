/**
 * Everything DERIVED from the repo — each web-component widget's runtime
 * signature, computed from the bundler's own resolution graph (an esbuild
 * metafile pass over the same entry + plugins the real build uses), classified
 * to runtime requirements via the RULES table in policy.mjs, with unrecognized
 * deps surfaced. Ground truth by construction: the analyzer and the build
 * resolve the graph identically, so they cannot drift.
 *
 * Consumed by:
 *   - analyze-widgets.mjs  (the human report + CI guard)
 *   - build.mjs            (served-surface composition + per-widget plugin selection)
 *
 * No side effects on import.
 */
import esbuild from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  WIDGETS,
  UICORE_ALWAYS_SERVED,
  STUBBED_NODE_BUILTINS,
  POLYFILLED_NODE_BUILTINS,
  EMOTION_SERVED,
  FRAMEWORK_SERVED,
  SIDE_EFFECT_SERVED,
  RULES,
  BENIGN,
  BARREL_LIBS,
  BUILD_ACTIONABLE,
  DECLARED_ONLY,
} from './policy.mjs';
import { baseOptions, widgetEntry, bundleEverythingPlugins } from './plugins.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
// The widgets package's install location — resolved, not assumed as a
// sibling, so this works from the workspace AND from a host's store.
const WIDGETS_DIR = path.dirname(
  createRequire(import.meta.url).resolve('@openeventkit/widgets/package.json'),
);

const NODE_BUILTINS = new RegExp(
  `^(node:)?(${[...STUBBED_NODE_BUILTINS, ...POLYFILLED_NODE_BUILTINS].join('|')})$`,
);

const KNOWN_NEEDS = new Set([...BUILD_ACTIONABLE, ...DECLARED_ONLY]);

const VALID_PKG = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;
export const pkgNameOf = (spec) => {
  if (!spec || spec.startsWith('.')) return null; // empty or relative — internal
  const parts = spec.split('/');
  const pkg = spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
  return VALID_PKG.test(pkg) ? pkg : null;
};

// Parse a widget's manifest ONCE: its dist `load()` specifier + declared
// runtimeNeeds (a lightweight text parse). build.mjs and the analyzer share this
// reader so the "what" (declared) and the "how" (orchestrated) can't drift.
async function readManifest(name) {
  for (const ext of ['ts', 'tsx']) {
    const p = path.join(WIDGETS_DIR, `src/catalog/${name}/manifest.${ext}`);
    let src;
    try { src = await fs.readFile(p, 'utf8'); } catch { continue; }
    const load = src.match(/load:\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/);
    if (!load) continue;
    const needs = src.match(/runtimeNeeds:\s*\[([\s\S]*?)\]/);
    const declaredNeeds = needs
      ? [...needs[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] || x[2])
      : [];
    return { specifier: load[1], manifestPath: p, declaredNeeds };
  }
  return null;
}

// The runtimeNeeds tokens a manifest declares — build.mjs orchestrates from these.
export async function readDeclaredNeeds(name) {
  return (await readManifest(name))?.declaredNeeds ?? [];
}

// ─── graph discovery: the bundler's own resolution, not a scraper ─────────────
// One bundle-everything pass per widget (write: false), with the SAME entry and
// resolution plugins the real build uses — the metafile is the widget's true
// import graph, including what enters through the manifest wrapTree/kit and
// through locally-bundled uicore modules.
async function discoverGraph(name) {
  const result = await esbuild.build({
    ...baseOptions(),
    stdin: widgetEntry(name),
    write: false,
    metafile: true,
    minify: false,
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
    plugins: bundleEverythingPlugins(),
  });
  return result.metafile;
}

const MUI_SPEC = /^@(mui|emotion)\//;

/** Does a rule fire for this widget at all? (pkg or prefix in the footprint.) */
const ruleMatches = (r, footprint) =>
  (r.pkg && r.pkg.some((p) => footprint.has(p))) ||
  (r.prefix && [...footprint].some((d) => r.prefix.some((pre) => d.startsWith(pre))));

/** Does a rule ACCOUNT FOR this specific dep? */
const ruleCoversDep = (r, dep) =>
  (r.pkg && r.pkg.includes(dep)) ||
  (r.prefix && r.prefix.some((pre) => dep.startsWith(pre)));

async function signatureFor(name) {
  const load = await readManifest(name);
  if (!load) return { name, error: 'no load() specifier in manifest' };
  const ownPkg = pkgNameOf(load.specifier);

  let ownPkgRoot;
  try {
    ownPkgRoot = path.dirname(createRequire(load.manifestPath).resolve(`${ownPkg}/package.json`));
  } catch {
    return { name, pkg: ownPkg, error: 'package not resolvable' };
  }
  const pkgJson = JSON.parse(await fs.readFile(path.join(ownPkgRoot, 'package.json'), 'utf8'));
  const peers = { ...(pkgJson.dependencies || {}), ...(pkgJson.peerDependencies || {}) };

  let metafile;
  try {
    metafile = await discoverGraph(name);
  } catch (e) {
    const first = String(e?.message ?? e).split('\n')[0];
    return { name, pkg: ownPkg, error: `discovery build failed: ${first}` };
  }

  const uicore = new Set(); // full uicore lib paths actually imported
  const node = new Set(); // node builtins reached anywhere in the graph
  const dist = new Set(); // external deps imported by the widget's own package
  const kit = new Set(); // external deps imported by workspace lib/entry code
  const mui = new Set(); // @mui/* + @emotion/* specifiers from non-internal importers
  const barrels = new Set(); // bare-root imports of subpath-capable libs

  const nm = `${path.sep}node_modules${path.sep}`;
  for (const [file, data] of Object.entries(metafile.inputs)) {
    // Metafile keys are relative to the build's absWorkingDir (pkgRoot in
    // baseOptions); plugin virtual inputs carry a namespace.
    const abs = file.includes(':') ? file : path.resolve(path.resolve(dir, '..'), file);
    if (abs.includes(`${path.sep}src${path.sep}shims${path.sep}`)) continue; // build machinery
    // "Own package" means the widget's shipped files — not the nested
    // node_modules a link:-installed package carries.
    const inOwnTree = abs.startsWith(ownPkgRoot + path.sep);
    const fromOwnPkg = inOwnTree && !abs.slice(ownPkgRoot.length).includes(nm);
    const fromKit =
      file.endsWith('.wc.js') || // the stdin entry
      ((abs.startsWith(WIDGETS_DIR + path.sep) || abs.startsWith(path.resolve(dir, '..') + path.sep)) && !abs.includes(nm));
    // uicore files count for the MUI surface: uicore modules import MUI
    // themselves (company-input-v2's Autocomplete), and those imports must
    // resolve through the served surface.
    const fromUicore = abs.includes(`${path.sep}openstack-uicore-foundation${path.sep}`);
    for (const imp of data.imports || []) {
      const spec = imp.original;
      if (!spec || spec.startsWith('.') || spec.startsWith('/')) continue;
      if (spec.startsWith('@openeventkit/')) continue; // workspace-internal
      if (NODE_BUILTINS.test(spec)) {
        // Own-package imports only: dep internals do guarded builtin requires
        // (e.g. crypto-js probing node crypto) that never run in the browser.
        // The transitive real cases (@react-pdf pulling fs/zlib) are covered
        // by their RULES entry.
        if (fromOwnPkg) node.add(spec.replace('node:', ''));
        continue;
      }
      if (spec.startsWith('openstack-uicore-foundation/lib/')) {
        if (fromOwnPkg || fromKit) uicore.add(spec);
        continue;
      }
      if (MUI_SPEC.test(spec)) {
        // Widget surface only — MUI/emotion's own internals and other deps'
        // internals (e.g. react-select@2's create-emotion) don't count.
        if (fromOwnPkg || fromKit || fromUicore) mui.add(spec);
        continue;
      }
      if (!fromOwnPkg && !fromKit) continue; // other deps' internals — not the widget's surface
      if (BARREL_LIBS.has(spec)) barrels.add(spec);
      const pkg = pkgNameOf(spec);
      if (pkg && pkg !== 'openstack-uicore-foundation') {
        (fromOwnPkg ? dist : kit).add(pkg);
      }
    }
  }
  dist.delete(ownPkg);
  kit.delete(ownPkg);

  const footprint = new Set([...dist, ...kit]);
  // Rules match against the full surface including the MUI/emotion packages
  // (classified into their own bucket above) — the pin rule keys on them.
  const ruleFootprint = new Set([...footprint, ...[...mui].map(pkgNameOf)]);
  const matched = RULES.filter((r) => ruleMatches(r, ruleFootprint));
  const unknown = [...footprint].filter(
    (p) => !matched.some((r) => ruleCoversDep(r, p)) && !BENIGN.has(p),
  );

  // The build-actionable needs the footprint IMPLIES vs what the manifest DECLARES.
  const derivedNeeds = [...new Set([
    ...matched.map((r) => r.id).filter((id) => BUILD_ACTIONABLE.has(id)),
    ...(node.size > 0 ? ['stub:node'] : []),
  ])].sort();
  const declaredNeeds = load.declaredNeeds;

  return {
    name,
    pkg: ownPkg,
    reactVersion: peers.react || '(unset)',
    muiVersion: peers['@mui/material'] || null,
    requirements: matched.map((r) => ({ id: r.id, note: r.note, by: r.pkg || r.prefix })),
    derivedNeeds,
    declaredNeeds,
    dist: [...dist].sort(),
    kit: [...kit].sort(),
    muiSpecs: [...mui].sort(),
    barrels: [...barrels].sort(),
    unknown: unknown.sort(),
    node: [...node].sort(),
    uicore: [...uicore].sort(),
  };
}

// ─── whole-fleet analysis + drift ────────────────────────────────────────────
/**
 * The uicore surface the shared runtime serves, derived from the widget
 * signatures: every consumed non-CSS uicore path, plus the always-served
 * stateful modules.
 */
export function deriveUicoreSurface(sigs) {
  const consumed = new Set();
  for (const s of sigs) for (const p of s.uicore || []) if (!p.includes('/css/')) consumed.add(p);
  for (const p of UICORE_ALWAYS_SERVED) consumed.add(p);
  return [...consumed].sort();
}

/**
 * The MUI/emotion surface the shared runtime serves, derived from the graphs:
 * every @mui/* SUBPATH imported outside the MUI/emotion trees (bare roots are
 * barrels — they stay local and are reported as smells), plus the @emotion
 * packages policy declares shared for their state (EMOTION_SERVED).
 */
export function deriveMuiServed(sigs) {
  const specs = new Set();
  for (const s of sigs) {
    for (const m of s.muiSpecs || []) {
      if (m.startsWith('@emotion/')) {
        if (EMOTION_SERVED.includes(m)) specs.add(m);
        continue;
      }
      if (m.split('/').length >= 3) specs.add(m);
    }
  }
  return [...specs].sort();
}

/**
 * Every bare specifier the shared runtime serves ↔ what shared widget bundles
 * leave external. One composition, used for the runtime entries, the import
 * map, and the widget externals — they cannot drift. Order is the import-map
 * key order; keep it stable.
 */
export function sharedSpecifiers(sigs) {
  return [
    ...FRAMEWORK_SERVED,
    ...SIDE_EFFECT_SERVED,
    ...deriveUicoreSurface(sigs),
    ...deriveMuiServed(sigs),
  ];
}

export async function analyzeFleet() {
  const sigs = [];
  for (const w of WIDGETS) sigs.push(await signatureFor(w));
  // build.mjs generates the runtime chunks + import map from these same
  // derivations, so the served uicore surface cannot drift from what the
  // widgets import.
  const exposed = new Set(deriveUicoreSurface(sigs));
  const allUnknown = [...new Set(sigs.flatMap((s) => s.unknown || []))].sort();
  const errored = sigs.filter((s) => s.error);

  // MUI drift: the served surface is derived from the same graphs, so a
  // subpath can no longer go missing by construction. What remains reportable:
  // bare barrel roots (a widget importing a whole @mui package bundles its own
  // copy — accepted per baseline until its subpath release lands). Non-served
  // @emotion helpers bundle locally by policy and are not drift.
  const muiExposed = new Set(deriveMuiServed(sigs));
  const muiUnionSet = new Set(sigs.flatMap((s) => s.muiSpecs || []));
  const muiUnion = [...muiUnionSet].sort();
  const muiMissing = muiUnion.filter((p) => !muiExposed.has(p) && !p.startsWith('@emotion/'));
  const muiUnused = [...muiExposed].filter((p) => !muiUnionSet.has(p)).sort();

  // Generalized barrel guard: any bare-root import of a subpath-capable lib
  // (BARREL_LIBS — lodash, react-bootstrap, …) in a widget we bundle.
  const barrelImports = sigs
    .filter((s) => !s.error && (s.barrels || []).length)
    .map((s) => ({ name: s.name, barrels: s.barrels }));

  // Declared-vs-derived: does each manifest's runtimeNeeds match reality?
  const declIssues = [];
  for (const s of sigs) {
    if (s.error) continue;
    const declared = new Set(s.declaredNeeds);
    const derived = new Set(s.derivedNeeds);
    const undeclared = [...derived].filter((t) => !declared.has(t)); // needs it, didn't declare
    const overdeclared = [...declared].filter((t) => BUILD_ACTIONABLE.has(t) && !derived.has(t)); // declared, doesn't need
    const unknownNeed = [...declared].filter((t) => !KNOWN_NEEDS.has(t)); // typo / unhandled token
    if (undeclared.length || overdeclared.length || unknownNeed.length) {
      declIssues.push({ name: s.name, undeclared, overdeclared, unknownNeed });
    }
  }

  return {
    sigs, exposed, allUnknown, errored, declIssues,
    muiExposed, muiUnion, muiMissing, muiUnused, barrelImports,
  };
}

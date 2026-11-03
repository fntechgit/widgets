#!/usr/bin/env node
/**
 * Builds each widget web component with esbuild — into `--out <path>` (the
 * host passes where it serves bundles from) or this package's dist/ by
 * default. A SEPARATE build from any host compile — each bundle carries its
 * own React 18.
 *
 * Outputs (per the packaging design in ../ISOLATION-STRATEGY.md):
 *   - runtime/*.js + import-map.json   the shared runtime as native ES modules:
 *       one chunk per shared bare specifier (react, react-dom, jsx-runtime,
 *       the exposed uicore paths, the MUI surface, the i18n seed), with
 *       esbuild code-splitting guaranteeing ONE instance of every stateful
 *       internal. The import map tells the browser where each bare specifier
 *       lives; the HOST inlines it in its document (first in body) before any widget
 *       module loads.
 *   - <name>.shared.js    ESM; shared specifiers left as bare imports the
 *                         browser resolves through the import map.
 *   - <name>.standalone.js  IIFE with React 18 + everything bundled in.
 *                           Drop-in for a host that serves no runtime chunks.
 */
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { readDeclaredNeeds, analyzeFleet, sharedSpecifiers } from './footprint.mjs';
import { WIDGETS, UICORE_IMPORT_OVERRIDES } from './policy.mjs';
import { probeModules, entrySource, chunkName, importMapFor } from './runtime-entries.mjs';
import {
  sharedExternals,
  uicorePinPlugin,
  selectPlugins,
  baseOptions,
  bundleEverythingPlugins,
  widgetEntry,
  assertOneMuiBuild,
} from './plugins.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(dir, '..');
const outArg = process.argv.indexOf('--out');
const OUT =
  outArg !== -1 && process.argv[outArg + 1]
    ? path.resolve(process.argv[outArg + 1])
    : path.resolve(pkgRoot, 'dist');
const require = createRequire(import.meta.url);
const STANDALONE = process.argv.includes('--standalone');
// The public URL path the import map bakes into its chunk URLs — a host
// serving the build output from elsewhere passes its own (--out sets only the
// directory). Normalized to a trailing slash.
const publicArg = process.argv.indexOf('--public-path');
const PUBLIC_PATH = (
  publicArg !== -1 && process.argv[publicArg + 1]
    ? process.argv[publicArg + 1]
    : '/web-components/'
).replace(/\/?$/, '/');

// Every bare specifier the shared runtime serves ↔ what shared widget bundles
// leave external (framework + side-effect + derived uicore + MUI surfaces;
// see sharedSpecifiers in footprint.mjs). The standalone variant bundles
// everything and needs neither the fleet analysis nor the surfaces.
const sigs = STANDALONE ? null : (await analyzeFleet()).sigs;
const SHARED_SPECIFIERS = sigs ? sharedSpecifiers(sigs) : [];

// The shared build already parsed every manifest into the signatures; only the
// standalone build reads them directly.
const declaredNeedsOf = async (name) =>
  sigs ? (sigs.find((s) => s.name === name)?.declaredNeeds ?? []) : await readDeclaredNeeds(name);

console.log(`MUI pinned to @mui/material@${JSON.parse(await fs.readFile(require.resolve('@mui/material/package.json'), 'utf8')).version} (react@${JSON.parse(await fs.readFile(require.resolve('react/package.json'), 'utf8')).version})`);

// Shared variant: every runtime-served specifier stays a bare import the
// browser resolves through the host's import map (plugins.mjs).
const sharedExternalsPlugin = sharedExternals(SHARED_SPECIFIERS);

// Dev build (unminified + development React) when NODE_ENV=development;
// default is the minified production build. A host's dev wiring (e.g. a
// predev hook) sets development; production builds leave it unset.
const DEV = process.env.NODE_ENV === 'development';

const base = {
  ...baseOptions(),
  minify: !DEV,
  define: { 'process.env.NODE_ENV': DEV ? '"development"' : '"production"' },
};

async function report(outfile, label) {
  const { size } = await fs.stat(outfile);
  console.log(`${label.padEnd(50)} ${(size / 1024).toFixed(0)} KB`);
}

// ─── The shared runtime: one ESM chunk per served specifier ───────────────────
// Entry generation (export-shape probe, entry templates, chunk naming, the
// import map) lives in runtime-entries.mjs; this pass writes the generated
// entries to disk and bundles them.
const genDir = path.join(pkgRoot, '.gen-runtime-entries');

async function buildRuntime() {
  await fs.rm(genDir, { recursive: true, force: true });
  await fs.mkdir(genDir, { recursive: true });

  // Composed before the entries are written: importMapFor throws on a chunk-name
  // collision, and the entry loop below keys files by the same names.
  const importMap = importMapFor(SHARED_SPECIFIERS, `${PUBLIC_PATH}runtime/`);

  const shapes = probeModules(
    SHARED_SPECIFIERS.map((s) => UICORE_IMPORT_OVERRIDES[s] ?? s),
  );

  const entryPoints = [];
  for (const spec of SHARED_SPECIFIERS) {
    const importSpec = UICORE_IMPORT_OVERRIDES[spec] ?? spec;
    const file = path.join(genDir, `${chunkName(spec)}.entry.js`);
    await fs.writeFile(file, entrySource(spec, importSpec, shapes[importSpec]));
    entryPoints.push({ in: file, out: chunkName(spec) });
  }

  const { metafile } = await esbuild.build({
    ...base,
    entryPoints,
    format: 'esm',
    splitting: true, // ONE instance of every stateful internal, guaranteed
    outdir: path.join(OUT, 'runtime'),
    chunkNames: 'chunks/[name]-[hash]',
    // The entries' `__ns.default` runtime check is intentionally "statically
    // undefined" for pure-ESM modules — that's the branch the ternary handles.
    logOverride: { 'import-is-undefined': 'silent' },
    metafile: true,
    plugins: bundleEverythingPlugins(),
  });
  assertOneMuiBuild(metafile, 'runtime');

  // The import map — the host inlines this in its document (first in body)
  // before any widget module loads.
  await fs.writeFile(
    path.join(OUT, 'import-map.json'),
    JSON.stringify(importMap, null, 2) + '\n',
  );
  const files = await fs.readdir(path.join(OUT, 'runtime'));
  let total = 0;
  for (const f of files) {
    if (f.endsWith('.js')) total += (await fs.stat(path.join(OUT, 'runtime', f))).size;
  }
  const chunkFiles = await fs.readdir(path.join(OUT, 'runtime', 'chunks')).catch(() => []);
  for (const f of chunkFiles) total += (await fs.stat(path.join(OUT, 'runtime', 'chunks', f))).size;
  console.log(`runtime/ (${SHARED_SPECIFIERS.length} modules + ${chunkFiles.length} shared chunks)`.padEnd(50), `${(total / 1024).toFixed(0)} KB total`);
  await fs.rm(genDir, { recursive: true, force: true });
}

async function runBuild(label, opts) {
  const { metafile } = await esbuild.build({
    ...base,
    ...opts,
    metafile: true,
    plugins: [...(opts.plugins ?? []), uicorePinPlugin],
  });
  assertOneMuiBuild(metafile, label);
  await report(opts.outfile, label);
}

if (!STANDALONE) await buildRuntime();

for (const name of WIDGETS) {
  const needs = new Set(await declaredNeedsOf(name));
  if (STANDALONE) {
    await runBuild(`${name}.standalone.js`, {
      stdin: widgetEntry(name),
      format: 'iife',
      outfile: path.join(OUT, `${name}.standalone.js`),
      define: {
        ...base.define,
        // IIFE only: keep import.meta.url-reading deps (pdfkit) alive.
        'import.meta.url': '__import_meta_url__',
      },
      inject: [...base.inject, path.join(pkgRoot, 'src/shims/import-meta-url-shim.js')],
      plugins: selectPlugins(needs),
    });
    continue;
  }
  await runBuild(`${name}.shared.js (ESM, import-map externals)`, {
    stdin: widgetEntry(name),
    format: 'esm',
    outfile: path.join(OUT, `${name}.shared.js`),
    plugins: [sharedExternalsPlugin, ...selectPlugins(needs)],
  });
}

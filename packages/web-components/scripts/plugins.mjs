/**
 * The esbuild resolution policy for the web-component builds — every plugin and alias
 * table build.mjs wires into its passes. No side effects on import (the MUI
 * version log lives in build.mjs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';
import { STUBBED_NODE_BUILTINS, POLYFILLED_NODE_BUILTINS } from './policy.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(dir, '..');
const require = createRequire(import.meta.url);

// Node-built-in compat for the browser bundle, via esbuild-plugin-polyfill-node
// (@jspm/core implementations). Real polyfills for the built-ins whose exports
// code extends or calls at load (POLYFILLED_NODE_BUILTINS), empty modules for
// the rest (STUBBED_NODE_BUILTINS), whose code paths never run in the browser.
// The process global is injected for the env checks scattered through the
// legacy deps; no other globals — parity with what the bundles always had.
export const nodePolyfills = polyfillNode({
  globals: {
    process: true,
    global: false,
    __dirname: false,
    __filename: false,
    buffer: false,
    navigator: false,
  },
  polyfills: {
    ...Object.fromEntries(STUBBED_NODE_BUILTINS.map((m) => [m, 'empty'])),
    ...Object.fromEntries(POLYFILLED_NODE_BUILTINS.map((m) => [m, true])),
    process: true,
  },
});

// @openeventkit/widgets must be installed next to this package (its 0.1.0 is
// not on a registry — hosts override it to a git ref until it publishes).
export const resolveWidgetsCompat = (name) => {
  try {
    return require.resolve(`@openeventkit/widgets/compat/${name}`);
  } catch {
    throw new Error(
      `@openeventkit/web-components requires @openeventkit/widgets to be installed alongside it (resolving compat/${name} failed)`,
    );
  }
};

// uicore pulls moment-timezone, whose default build carries the full 1900-2100
// tz-transition dataset (~715 KB); redirect to the 10-year-range dataset.
// sweetalert2 (~78 KB) is aliased to the widget-notify shim so the real library
// never bundles. See lib/compat/uicore-swal.
const vendorAlias = {
  'moment-timezone': require.resolve('moment-timezone/builds/moment-timezone-with-data-10-year-range'),
  get sweetalert2() { return resolveWidgetsCompat('uicore-swal'); },
};

// ─── Pin every @mui/* + @emotion/* to this package's MUI 5 tree ───────────────
// uicore declares @mui/material as a peer (^5) but ships v5-era code. With no
// pin, esbuild resolves that peer to whatever MUI the surrounding installation
// holds. package.json declares EVERY top-level @mui/* the bundles import at v5
// alongside this package's react, so pnpm materializes the coherent v5 set in
// this package's own node_modules — the only place versions are declared and
// therefore deterministic. Imports from INSIDE the MUI/emotion trees resolve
// naturally (each package keeps its nested v5 copies; no cross-version mixing).
const isMuiInternal = (importer) => /[\\/]\.pnpm[\\/]@(mui|emotion)\+/.test(importer || '');

export const mui5PinPlugin = {
  name: 'mui5-pin',
  setup(build) {
    // react itself rides the same pin: source bundled from the widgets
    // package (the kit compat modules) would otherwise resolve react and
    // react/jsx-runtime through THAT package's peer — React 19 — putting a
    // second React in the runtime graph next to the one the entries serve
    // (null hooks dispatcher at render).
    build.onResolve({ filter: /^(react|react-dom|scheduler)(\/.*)?$/ }, async (args) => {
      if (args.pluginData?.mui5) return null;
      const r = await build.resolve(args.path, {
        kind: args.kind,
        resolveDir: pkgRoot,
        pluginData: { mui5: true },
      });
      if (r.errors.length) return null;
      return { path: r.path, external: r.external };
    });
    build.onResolve({ filter: /^@(mui|emotion)\// }, async (args) => {
      if (args.pluginData?.mui5) return null; // recursion guard for our re-resolve
      if (isMuiInternal(args.importer)) return null;
      const r = await build.resolve(args.path, {
        kind: args.kind,
        resolveDir: pkgRoot,
        pluginData: { mui5: true },
      });
      if (r.errors.length) return null; // unknown subpath → let esbuild fall back
      return { path: r.path, external: r.external };
    });
  },
};

// my-tickets ships its own MUI theme (CustomTheme) that sets no fontFamily, so
// its MUI text falls back to Roboto — and, being the inner ThemeProvider, it
// overrides the wrapTree WidgetThemeProvider. Patch its inlined createTheme at
// load. A dist where the marker no longer matches fails the build — a silent
// skip would ship the widget rendering Roboto.
export const myTicketsFontPlugin = {
  name: 'my-tickets-theme-font',
  setup(build) {
    build.onLoad({ filter: /my-orders-tickets-widget[\\/]dist[\\/]index\.js$/ }, async (args) => {
      const code = await fs.readFile(args.path, 'utf8');
      const patched = code.replace(
        /(createTheme\)\(\{[\s\S]*?typography:\s*\{)/,
        '$1 fontFamily: "var(--font_family)",',
      );
      if (patched === code) {
        throw new Error(
          'my-tickets: CustomTheme typography marker not found — the dist changed and the quirk:myTicketsFont patch no longer applies',
        );
      }
      return { contents: patched, loader: 'js' };
    });
  },
};

// Shared variant: leave every runtime-served specifier as a bare import the
// browser resolves through the host's import map. uicore css imports become
// empty modules (vendor CSS is adopted into the shadow separately);
// specifiers outside the served surface (bare @mui roots, unshared packages)
// fall through and bundle locally.
export const sharedExternals = (sharedSpecifiers) => ({
  name: 'shared-externals',
  setup(build) {
    const exact = new Set(sharedSpecifiers);
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('openstack-uicore-foundation/lib/') && args.path.includes('/css/')) {
        return { path: args.path, namespace: 'uicore-css-empty' };
      }
      if (!exact.has(args.path)) return null;
      // ESM import statements pass through as true externals — the browser
      // resolves them via the import map. CJS require() calls (the webpack-UMD
      // widget dists) cannot dynamically require an ESM external, so they go
      // through a tiny bridge module that imports the external and hands its
      // CJS shape (src/shims/require-exports.js) back as module.exports.
      if (args.kind === 'require-call') {
        return { path: args.path, namespace: 'ext-require-bridge' };
      }
      return { path: args.path, external: true };
    });
    build.onLoad({ filter: /.*/, namespace: 'ext-require-bridge' }, (args) => ({
      contents:
        `import * as __ns from ${JSON.stringify(args.path)};\n` +
        `import { requireExports } from ${JSON.stringify(path.join(pkgRoot, 'src/shims/require-exports.js'))};\n` +
        'module.exports = requireExports(__ns);\n',
      loader: 'js',
      resolveDir: pkgRoot,
    }));
    build.onLoad({ filter: /.*/, namespace: 'uicore-css-empty' }, () => ({
      contents: 'export {};',
      loader: 'js',
    }));
  },
});

// Every build: resolve uicore from THIS package's node_modules, whoever imports
// it, so a bundle can never hold two uicore instances. Registered last so the
// external/shared resolvers win first.
export const uicorePinPlugin = {
  name: 'uicore-pin',
  setup(build) {
    build.onResolve({ filter: /^openstack-uicore-foundation\// }, (args) => ({
      path: require.resolve(args.path),
    }));
  },
};

/**
 * The esbuild options every build pass shares (the per-pass bits — minify,
 * define, format, entry — stay with the caller). One definition so the real
 * builds and the analyzer's metafile discovery resolve the graph identically.
 */
export const baseOptions = () => ({
  bundle: true,
  platform: 'browser',
  absWorkingDir: pkgRoot,
  // Explicit: esbuild ignores tsconfig.json inside node_modules, so a host
  // running the bins would otherwise compile the widgets package's JSX with
  // the classic transform (React.createElement with no React in scope) while
  // the workspace compiles it with the automatic runtime.
  jsx: 'automatic',
  loader: {
    '.css': 'empty', '.scss': 'empty',
    '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl',
    '.gif': 'dataurl', '.svg': 'dataurl',
    '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.eot': 'dataurl',
  },
  alias: { ...vendorAlias },
  inject: [],
  logLevel: 'warning',
});

// The per-widget entry is pure boilerplate — inject React/createRoot and
// register the custom element from the widget's shared `manifest` export. The
// i18n seed import is external in the shared variant (runs once in the shared
// graph) and bundles in standalone.
export const widgetEntry = (name) => ({
  contents: `
import '@openeventkit/widgets/compat/uicore-i18n';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { manifest } from '@openeventkit/widgets/${name}/manifest';
import { defineWidgetWebComponent } from './src/element/defineWidgetWebComponent.js';
defineWidgetWebComponent({ React, createRoot, manifest });
`,
  resolveDir: pkgRoot,
  sourcefile: `${name}.wc.js`,
  loader: 'js',
});

// runtimeNeeds token → the plugin that acts on it, in registration order.
// Tokens are the manifest vocabulary (see the core manifest's RuntimeNeed type).
export const NEEDS_TO_PLUGINS = new Map([
  ['pin:mui5', mui5PinPlugin],
  ['quirk:myTicketsFont', myTicketsFontPlugin],
  ['stub:node', nodePolyfills],
]);
export const selectPlugins = (needs) =>
  [...NEEDS_TO_PLUGINS].filter(([token]) => needs.has(token)).map(([, plugin]) => plugin);

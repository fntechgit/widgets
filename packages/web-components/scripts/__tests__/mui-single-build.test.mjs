import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';
import { baseOptions, bundleEverythingPlugins, esmBuildFile, assertOneMuiBuild } from '../plugins.mjs';

const pkgRoot = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
const pkgDirOf = (name) => path.dirname(require.resolve(`${name}/package.json`));

// The runtime's shape in one module: served MUI parts imported as ES modules
// next to a require() of a MUI part, as uicore's company input require()s
// @mui/material/TextField. Built once, on first use.
let graph;
const runtimeLikeGraph = () =>
  (graph ??= esbuild
    .build({
      ...baseOptions(),
      stdin: {
        contents: [
          'export { default as FormControl } from "@mui/material/FormControl";',
          'export { default as InputLabel } from "@mui/material/InputLabel";',
          'export { default as Select } from "@mui/material/Select";',
          'export const companyInput = () => require("@mui/material/TextField");',
        ].join('\n'),
        resolveDir: pkgRoot,
      },
      format: 'esm',
      write: false,
      metafile: true,
      logLevel: 'silent',
      plugins: bundleEverythingPlugins(),
    })
    .then((result) => result.metafile));

test('served MUI parts and a require() caller share one FormControlContext', async () => {
  const contexts = Object.keys((await runtimeLikeGraph()).inputs).filter((p) =>
    /[\\/]FormControl[\\/]FormControlContext\.js$/.test(p),
  );
  assert.deepEqual(
    contexts.map((p) => p.replace(/.*node_modules[\\/]@mui[\\/]/, '@mui/')),
    ['@mui/material/FormControl/FormControlContext.js'],
  );
});

test('the runtime-like graph bundles every MUI package from one build', async () => {
  const metafile = await runtimeLikeGraph();
  assert.doesNotThrow(() => assertOneMuiBuild(metafile, 'runtime-like graph'));
});

test('esmBuildFile maps a CommonJS file to the same module in the ES-module build', () => {
  const material = pkgDirOf('@mui/material');
  const system = pkgDirOf('@mui/system');
  assert.equal(
    esmBuildFile(path.join(material, 'node/TextField/index.js')),
    path.join(material, 'TextField/index.js'),
  );
  assert.equal(
    esmBuildFile(path.join(system, 'colorManipulator.js')),
    path.join(system, 'esm/colorManipulator.js'),
  );
});

test('esmBuildFile keeps an ES-module file, and a CommonJS file with no twin', () => {
  const material = pkgDirOf('@mui/material');
  const system = pkgDirOf('@mui/system');
  assert.equal(esmBuildFile(path.join(material, 'Select/index.js')), path.join(material, 'Select/index.js'));
  assert.equal(esmBuildFile(path.join(system, 'esm/index.js')), path.join(system, 'esm/index.js'));
  assert.equal(esmBuildFile(path.join(system, 'package.json')), path.join(system, 'package.json'));
});

test('assertOneMuiBuild fails a bundle that holds MUI packages from both builds, naming each', () => {
  const material = 'node_modules/.pnpm/@mui+material@5.18.0_x/node_modules/@mui/material';
  const system = 'node_modules/.pnpm/@mui+system@5.18.0_x/node_modules/@mui/system';
  const metafile = {
    inputs: {
      [`${material}/FormControl/FormControlContext.js`]: { format: 'esm' },
      [`${material}/node/FormControl/FormControlContext.js`]: { format: 'cjs' },
      // system keeps its CommonJS build at the package root.
      [`${system}/esm/DefaultPropsProvider/DefaultPropsProvider.js`]: { format: 'esm' },
      [`${system}/DefaultPropsProvider/DefaultPropsProvider.js`]: { format: 'cjs' },
      'node_modules/.pnpm/@mui+utils@5.17.1_x/node_modules/@mui/utils/esm/index.js': { format: 'esm' },
    },
  };
  assert.throws(() => assertOneMuiBuild(metafile, 'runtime'), {
    message:
      'runtime: MUI packages bundled from both their ES-module and CommonJS builds: ' +
      `@mui/material (e.g. ${material}/node/FormControl/FormControlContext.js); ` +
      `@mui/system (e.g. ${system}/DefaultPropsProvider/DefaultPropsProvider.js)`,
  });
});

test('assertOneMuiBuild passes MUI packages bundled from one build each', () => {
  const metafile = {
    inputs: {
      'node_modules/@mui/styled-engine/node/index.js': { format: 'cjs' },
      'node_modules/@mui/utils/esm/index.js': { format: 'esm' },
      // Files with no import or export carry no format.
      'node_modules/@mui/utils/esm/blank.js': {},
    },
  };
  assert.doesNotThrow(() => assertOneMuiBuild(metafile, 'runtime'));
});

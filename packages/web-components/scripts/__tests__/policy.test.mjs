import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(dir, '../..');
const require = createRequire(import.meta.url);

// uicore peers this package deliberately does NOT declare, with the reason.
// Everything else must be declared here: in a host install there is no
// workspace root install to anchor pnpm's peer materialization, and an auto-installed
// peer can resolve to an incompatible copy.
const EXCLUDED = new Map([
  [
    'pdfmake',
    'optional peer; only lib/utils/pdf uses it. Declare it when a widget imports that module.',
  ],
]);

// Both uicore consumers must declare the full peer set: this package for the
// web-component bundles, the widgets package for the host's webpack graph.
for (const pkgDir of [pkgRoot, path.resolve(pkgRoot, '../widgets')]) {
  test(`every uicore peerDependency is declared by ${path.basename(pkgDir)} (or excluded with a reason)`, () => {
    const uicorePkg = require('openstack-uicore-foundation/package.json');
    const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    const declared = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    const missing = Object.keys(uicorePkg.peerDependencies ?? {}).filter(
      (name) => !declared[name] && !EXCLUDED.has(name),
    );
    assert.deepEqual(missing, [], `undeclared uicore peers: ${missing.join(', ')}`);
  });
}

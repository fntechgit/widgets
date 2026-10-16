import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pkgNameOf,
  deriveUicoreSurface,
  deriveMuiServed,
  sharedSpecifiers,
} from '../footprint.mjs';
import {
  UICORE_ALWAYS_SERVED,
  FRAMEWORK_SERVED,
  SIDE_EFFECT_SERVED,
  EMOTION_SERVED,
} from '../policy.mjs';

test('pkgNameOf extracts the package name from a specifier', () => {
  assert.equal(pkgNameOf('react'), 'react');
  assert.equal(pkgNameOf('react-dom/client'), 'react-dom');
  assert.equal(pkgNameOf('@mui/material/Box'), '@mui/material');
  assert.equal(pkgNameOf('./local'), null);
  assert.equal(pkgNameOf('../up'), null);
  assert.equal(pkgNameOf(''), null);
  assert.equal(pkgNameOf('data:text/javascript,x'), null);
});

const sig = (uicore, muiSpecs = []) => ({ uicore, muiSpecs });

test('deriveUicoreSurface: consumed non-CSS paths, plus always-served, sorted', () => {
  const sigs = [
    sig(['openstack-uicore-foundation/lib/components/clock']),
    sig(['openstack-uicore-foundation/lib/components/css/x.css']),
  ];
  const surface = deriveUicoreSurface(sigs);
  assert.ok(surface.includes('openstack-uicore-foundation/lib/components/clock'));
  assert.ok(!surface.some((p) => p.includes('/css/')), 'css paths must be excluded');
  for (const p of UICORE_ALWAYS_SERVED) assert.ok(surface.includes(p), `${p} must always be served`);
  assert.deepEqual(surface, [...surface].sort());
});

test('deriveMuiServed: subpaths served, roots and non-served emotion stay local', () => {
  const sigs = [sig([], [
    '@mui/material/Tooltip',
    '@mui/material',            // barrel root — stays local
    '@mui/icons-material/Close',
    '@emotion/react',           // on the EMOTION_SERVED allowlist
    '@emotion/hash',            // stateless helper — stays local
  ])];
  const served = deriveMuiServed(sigs);
  assert.deepEqual(served, [
    '@emotion/react',
    '@mui/icons-material/Close',
    '@mui/material/Tooltip',
  ]);
  for (const e of EMOTION_SERVED) {
    assert.ok(e.startsWith('@emotion/'), 'allowlist holds emotion packages only');
  }
});

test('sharedSpecifiers composes the surfaces in import-map key order', () => {
  const sigs = [sig(
    ['openstack-uicore-foundation/lib/components/clock'],
    ['@mui/material/Tooltip', '@emotion/react'],
  )];
  const specs = sharedSpecifiers(sigs);
  const expected = [
    ...FRAMEWORK_SERVED,
    ...SIDE_EFFECT_SERVED,
    ...deriveUicoreSurface(sigs),
    ...deriveMuiServed(sigs),
  ];
  assert.deepEqual(specs, expected);
  assert.equal(specs[0], 'react');
});

/**
 * Every hand-written DECISION behind the web-component builds and the analyzer —
 * the served surfaces, the derivation adjustments, and the dep-classification
 * judgment. Zero logic, zero imports; everything derivable from the widget
 * dists lives in footprint.mjs.
 */

/**
 * The widgets shipped as web components. Adding a name here is the only step —
 * the build generates each entry module from the widget's shared manifest.
 * (Not every widget qualifies: extra-questions is excluded, so this can't just
 * glob all manifests.)
 */
export const WIDGETS = [
  'speakers', 'live-event', 'schedule-lite', 'upcoming-events',
  'event-feedback', 'schedule-filters', 'schedule-full', 'my-tickets',
  'registration',
];

/**
 * uicore modules the shared runtime serves for their STATE, not because a widget
 * dist imports them at top level: a served uicore module that imports them must
 * reach the configured instance, not a fresh empty copy.
 */
export const UICORE_ALWAYS_SERVED = [
  'openstack-uicore-foundation/lib/utils/config',
  'openstack-uicore-foundation/lib/security/methods',
];

/**
 * Publish-under vs import-from: runtime slots filled by a compat module
 * instead of the real uicore path (the ajaxloader slot gets the host-styled
 * shim).
 */
export const UICORE_IMPORT_OVERRIDES = {
  'openstack-uicore-foundation/lib/components/ajaxloader':
    '@openeventkit/widgets/compat/uicore-ajaxloader',
};

/**
 * Node built-ins stubbed to empty modules in the web-component build — their code
 * paths (real file/PDF I/O) never run in the browser.
 */
export const STUBBED_NODE_BUILTINS = [
  'fs', 'url', 'zlib', 'path', 'crypto', 'http', 'https', 'http2', 'os',
  'assert', 'tty', 'net', 'tls', 'dns', 'dgram', 'child_process',
  'worker_threads', 'constants', 'querystring', 'string_decoder', 'vm',
];

/**
 * Node built-ins given REAL browser polyfills (nodePolyfills in plugins.mjs) — code
 * extends or calls their exports at load, so an empty stub would crash.
 */
export const POLYFILLED_NODE_BUILTINS = ['stream', 'events', 'buffer', 'util'];

/**
 * The @emotion packages the shared runtime serves for their STATE (one cache /
 * one theming context across every widget). The rest of the MUI/emotion
 * surface is derived: every @mui/* SUBPATH the widget graphs import is served
 * (deriveMuiServed in footprint.mjs); bare package roots are barrels and stay
 * local; other @emotion helpers are stateless and bundle locally.
 */
export const EMOTION_SERVED = ['@emotion/cache', '@emotion/react'];

/**
 * The framework specifiers every shared widget bundle leaves external — served
 * by the shared runtime alongside the uicore + MUI surfaces.
 */
export const FRAMEWORK_SERVED = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'];

/**
 * Shared side-effect modules: the i18n seed must run ONCE in the shared module
 * graph (uicore's texts seed the same i18n-react instance the uicore chunks
 * read), so widget entries import it as an external.
 */
export const SIDE_EFFECT_SERVED = ['@openeventkit/widgets/compat/uicore-i18n'];

// ─── Dep-classification judgment (consumed by footprint.mjs) ──────────

/**
 * The auditable dep → runtime-requirement mapping. A rule matches a widget if
 * any of its `pkg`s is in the footprint or any `prefix` is a prefix of a
 * footprint dep. Everything imported that no rule covers (and isn't benign) is
 * surfaced as "unknown".
 */
export const RULES = [
  { id: 'shim:findDOMNode',      pkg: ['react-select'],                              note: 'react-select@2 statically imports findDOMNode (dropped in React 19)' },
  { id: 'shim:elementSymbol',    pkg: ['pure-react-carousel'],                       note: 'bundled deepmerge checks the old react.element $$typeof → crash on mount' },
  { id: 'bridge:tooltip',        pkg: ['react-tooltip'],                             note: 'react-tooltip@3 scans document for [data-tip], shadow-blind' },
  { id: 'quirk:stripeSlot',      pkg: ['@stripe/react-stripe-js', '@stripe/stripe-js'], note: 'Stripe Elements cannot mount in a shadow root — light-DOM slot workaround' },
  { id: 'pin:mui5',              prefix: ['@mui/', '@emotion/'],                     note: 'v5-era MUI/emotion (dist or kit wrapTree) → pin bundle to the build package MUI 5 (mui5PinPlugin)' },
  { id: 'legacy:react-bootstrap', pkg: ['react-bootstrap'],                          note: 'legacy childContext (removed in React 19) + Bootstrap vendor CSS' },
  { id: 'stub:node',             pkg: ['@react-pdf/renderer'],                       note: 'pulls Node built-ins (fs/zlib/…) → needs the browser polyfills (nodePolyfills) in the wc build' },
  { id: 'quirk:swalDeadEnd',     pkg: ['sweetalert2'],                               note: 'sweetalert2 aliased to the widget-notify host shim (lib/compat/uicore-swal) — the ~78 KB lib is not bundled' },
];

// Deps that need no requirement — they just bundle. Kept small + explicit so a
// genuinely new blocker lib still shows up as "unknown".
export const BENIGN = new Set([
  'react', 'react-dom', 'react/jsx-runtime', 'prop-types', 'scheduler',
  'openstack-uicore-foundation', 'redux', 'react-redux', 'redux-thunk',
  'moment', 'moment-timezone', 'lodash', 'classnames', 'i18n-react', 'js-cookie',
]);

// Subpath-capable libraries whose ROOT (barrel) import pulls the whole library
// into a CJS/UMD dist that can't tree-shake. A bare `require("lib")` of one of
// these is a bundle-size smell — import the subpath(s) actually used instead
// (the fix applied to lodash, @mui/*, @mui/base across the widget/uicore PRs).
// @mui/* is intentionally NOT here — the MUI-surface drift check (muiSpecs /
// muiMissing) already owns @mui, and listing it here too would double-report.
// Monolithic single-purpose libs (moment, react-select, video.js…) are omitted —
// their root is the whole point, no subpath win.
export const BARREL_LIBS = new Set([
  'lodash', 'react-bootstrap', 'date-fns', 'ramda',
  '@material-ui/core', '@material-ui/icons',
]);

// The runtime-need vocabulary shared with the manifest's RuntimeNeed type and
// build.mjs's plugin map. BUILD_ACTIONABLE tokens are import-visible — the
// analyzer cross-checks each manifest's declaration against its real footprint.
// DECLARED_ONLY tokens are behavioral (not derivable), accepted as declared.
// Together they must partition the RuntimeNeed union in
// @openeventkit/widgets' src/core/manifest.ts — a token added to the type needs an
// entry here (and vice versa).
export const BUILD_ACTIONABLE = new Set(['pin:mui5', 'stub:node']);
export const DECLARED_ONLY = new Set(['quirk:myTicketsFont']);

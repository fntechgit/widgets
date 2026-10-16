/**
 * A served module as a require() caller expects it. The webpack-UMD widget
 * dists reach served modules through the require-to-import bridge
 * (sharedExternals in scripts/plugins.mjs), which imports this. Four shapes:
 * - an old-style CJS module: the entry's default IS its exports object
 *   (default, named and __esModule already on it), handed over as require()
 *   would return it.
 * - default + named (browser-ESM component modules): a merged
 *   { __esModule, default, ...named } object, so BOTH
 *   _interopRequireDefault(require(s)).default and require(s).namedThing work.
 * - default only: the default.
 * - no default: the namespace itself.
 */
export function requireExports(ns) {
  const def = ns.default;
  if (def != null && def.__esModule === true) return def;
  const keys = Object.keys(ns);
  if (def !== undefined && keys.length > 1) {
    const out = { __esModule: true, default: def };
    for (const k of keys) if (k !== 'default') out[k] = ns[k];
    return out;
  }
  return def !== undefined ? def : ns;
}

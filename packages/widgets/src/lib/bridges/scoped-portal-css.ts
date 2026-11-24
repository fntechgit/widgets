/**
 * Scoped stylesheet injection for widget UI that renders into a
 * light-DOM container outside the shadow root (e.g. full-schedule's
 * react-laag popovers, which the widget appends to `document.body` as
 * `#popovers-container`).
 *
 * `portalSheets` can't be used when a sheet contains generic selectors
 * (`.nav`, `.active`, `.dropdown`, …) — injected plainly in
 * `document.head` those would bleed site-wide. Instead this bridge
 * injects the sheet text wrapped in `@scope (<container>)`, so every
 * rule — generic or hashed — only matches inside the container subtree.
 * (@scope: Chrome 118+, Safari 17.4+, Firefox 128+.)
 *
 * `:root` and `html` rules never match inside a scope, so a sheet's own
 * color-token defaults (`:root { --color_primary: … }`) can't override the
 * host's tokens. MUI portals that append straight to `document.body` use
 * `body` as the container.
 *
 * `@font-face` registration is handled globally by createWidgetShadow's
 * font-face hoisting to document.head for the same sheets; only class rules (e.g.
 * `.fa { font-family: FontAwesome }`) need to resolve here.
 *
 * Deduplicated per (container, sheet ids) process-wide; the injected
 * style is left in place on unmount (portaled markup can outlive the
 * widget).
 */

import { resolveAssetUrls, type VendorSheet } from '../../core/vendor-sheet';

const ATTR = 'data-scoped-portal-css';

export function scopedPortalCssBridge(
  containerSelector: string,
  sheets: readonly VendorSheet[],
): (root: ShadowRoot) => void {
  return () => {
    const key = `${containerSelector}|${sheets.map((s) => s.id).join(',')}`;
    const existing = document.head.querySelectorAll<HTMLStyleElement>(`style[${ATTR}]`);
    for (const tag of existing) {
      if (tag.getAttribute(ATTR) === key) return;
    }
    const style = document.createElement('style');
    style.setAttribute(ATTR, key);
    style.textContent = `@scope (${containerSelector}) {\n${sheets
      .map((s) => resolveAssetUrls(s.css))
      .join('\n')}\n}`;
    document.head.appendChild(style);
  };
}

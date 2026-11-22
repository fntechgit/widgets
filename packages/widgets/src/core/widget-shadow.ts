import type { WidgetManifest } from './manifest';
import { resolveAssetUrls, type VendorSheet } from './vendor-sheet';

/** A shadow root prepared for a widget — styles adopted, fonts registered, bridges running. */
export interface WidgetShadow {
  /** The shadow root itself — for consumers that scope to it (e.g. an emotion cache). */
  readonly root: ShadowRoot;
  /** The <div> inside the shadow root to render the widget's tree into. */
  readonly container: HTMLElement;
  /** Run every bridge's cleanup. Call on unmount. */
  dispose(): void;
  /**
   * Restart the manifest's bridges after a dispose() — for a host element that
   * is re-connected (a custom element moved in the DOM fires
   * disconnect + connect). No-op while the bridges are already running.
   */
  connectBridges(): void;
}

/**
 * Constructable stylesheets: Chrome 73+, Safari 16.4+, Firefox 101+. jsdom and
 * older engines fall back to <style> elements appended in the same order, so
 * the cascade is identical.
 */
const supportsConstructable =
  typeof CSSStyleSheet !== 'undefined' &&
  typeof CSSStyleSheet.prototype.replaceSync === 'function';

/** Same CSS text → one parsed CSSStyleSheet, shared across every shadow that adopts it. */
const sheetCache = new Map<string, CSSStyleSheet>();

function cachedSheet(key: string, css: string): CSSStyleSheet {
  const hit = sheetCache.get(key);
  if (hit) return hit;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  sheetCache.set(key, sheet);
  return sheet;
}

/**
 * @font-face inside a shadow-scoped sheet does NOT register in document.fonts in
 * any current browser — the glyphs render as tofu. The generator splits each
 * sheet's font-faces out; inject them document-level once per sheet id (font
 * registration is document-global anyway).
 */
const injectedFontIds = new Set<string>();

/** Once per sheet id: a document-head <style> whose text went through resolveAssetUrls. */
function injectHeadStyleOnce(
  injected: Set<string>,
  attr: string,
  sheetId: string,
  cssText: string,
): void {
  if (injected.has(sheetId)) return;
  injected.add(sheetId);
  const style = document.createElement('style');
  style.setAttribute(attr, sheetId);
  style.textContent = resolveAssetUrls(cssText);
  document.head.appendChild(style);
}

function injectFontFaces(sheet: VendorSheet): void {
  if (!sheet.fontFaces) return;
  injectHeadStyleOnce(injectedFontIds, 'data-widget-fonts-from', sheet.id, sheet.fontFaces);
}

/** Portal-sheet ids already injected into document.head. */
const injectedPortalIds = new Set<string>();

function injectPortalSheet(sheet: VendorSheet): void {
  injectHeadStyleOnce(injectedPortalIds, 'data-widget-portal-css', sheet.id, sheet.css);
}

// Unregistered custom elements default to display:inline, which collapses
// widget layout — force block so callers don't have to style the host.
const CUSTOM_ELEMENT_HOST_CSS = ':host { display: block; }';

/**
 * Attaches an open shadow root to `host`, adopts the manifest's styles, extracts
 * font-faces to document.head, injects portal sheets, runs the manifest's
 * bridges, and returns a `container` <div> to render into.
 *
 * Cascade, lowest → highest precedence (later adopted sheets win ties):
 *   1. inlineStyles   2. vendorSheets
 * A widget's own CSS belongs last in `vendorSheets` so it beats vendor styles.
 *
 * The one shadow-DOM primitive both renderers share — the reactComponent
 * renderer portals the widget into `container` on the host's React; the
 * webComponent renderer renders a root into it on its own React.
 */
export function createWidgetShadow(
  host: HTMLElement,
  manifest: WidgetManifest,
): WidgetShadow {
  // One shadow per host — calling this twice on the same element throws
  // (attachShadow's NotSupportedError), by design: reuse has no sane
  // semantics here (bridges may be disposed, containers would accumulate).
  // Callers guard on host.shadowRoot / their own state.
  const root = host.attachShadow({ mode: 'open' });
  const isCustomElement = host.localName.includes('-');

  const cssLayers: Array<{ key: string; css: string }> = [];
  if (manifest.inlineStyles) {
    for (const css of manifest.inlineStyles) cssLayers.push({ key: css, css });
  }
  if (isCustomElement) {
    cssLayers.push({ key: 'ce:display-block', css: CUSTOM_ELEMENT_HOST_CSS });
  }
  if (manifest.vendorSheets) {
    for (const sheet of manifest.vendorSheets) {
      cssLayers.push({ key: `vendor:${sheet.id}`, css: resolveAssetUrls(sheet.css) });
      injectFontFaces(sheet);
    }
  }

  if (supportsConstructable) {
    root.adoptedStyleSheets = cssLayers.map(({ key, css }) => cachedSheet(key, css));
  } else {
    for (const { css } of cssLayers) {
      const style = document.createElement('style');
      style.textContent = css;
      root.appendChild(style);
    }
  }

  if (manifest.portalSheets) {
    for (const sheet of manifest.portalSheets) injectPortalSheet(sheet);
  }

  const container = document.createElement('div');
  root.appendChild(container);

  // Bridges may return no cleanup, so "running" is tracked explicitly rather
  // than inferred from the cleanup list.
  const cleanups: Array<() => void> = [];
  let bridgesRunning = false;
  function startBridges(): void {
    if (bridgesRunning) return;
    bridgesRunning = true;
    if (manifest.bridges) {
      for (const bridge of manifest.bridges) {
        const cleanup = bridge(root);
        if (typeof cleanup === 'function') cleanups.push(cleanup);
      }
    }
  }
  startBridges();

  return {
    root,
    container,
    dispose() {
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
      bridgesRunning = false;
    },
    connectBridges: startBridges,
  };
}

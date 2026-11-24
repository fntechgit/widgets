/**
 * A `WidgetManifest` is the static, renderer-independent declaration of one
 * legacy widget: what it is, what styles it needs, how it behaves inside a
 * shadow root. Both renderers read the same manifest — the host's React 19
 * (`reactComponent`) and the widget's own React 18 web component
 * (`webComponent`).
 *
 * React is referenced by TYPE only, so this module pulls in no React runtime —
 * the esbuild web-component build can import a manifest without dragging React
 * 19 into its React-18 bundle.
 */
import type { ComponentType, ReactElement, ReactNode } from 'react';
import type { VendorSheet } from './vendor-sheet';

/** The widget dist's default export — a legacy React component with loose props. */
export type WidgetComponent = ComponentType<Record<string, unknown>>;

/**
 * A host-agnostic DOM fix-up, run once against a prepared shadow root and
 * returning an optional cleanup. Used for libraries that assume document scope
 * (react-select's emotion styles, react-tooltip's scanner, document-level
 * click-outside handlers). Framework-free — the same bridge runs under either
 * renderer's React.
 */
export type WidgetBridge = (root: ShadowRoot) => void | (() => void);

/**
 * A build-actionable runtime requirement of the widget's web-component bundle.
 * The manifest DECLARES what the bundle needs; the esbuild build orchestrates
 * HOW to satisfy each token (which plugin / alias). Only needs the web-component
 * build acts on live here — React-19 renderer shims, shadow bridges, and vendor
 * CSS are declared elsewhere (`bridges`, `vendorSheets`, the renderer).
 *
 *  - 'pin:mui5'             bundle uses v5-era MUI/emotion → pin to the build package's MUI 5 tree
 *  - 'stub:node'            bundle pulls Node built-ins (fs/zlib/…) → browser stubs
 *  - 'quirk:myTicketsFont'  my-tickets' CustomTheme sets no fontFamily → build patches the site font in
 *
 * The first two are import-visible: analyze-widgets.mjs cross-checks each
 * declaration against the widget's real dependency footprint (declared must
 * match derived). 'quirk:myTicketsFont' is behavioral and declared-only.
 */
export type RuntimeNeed =
  | 'pin:mui5'
  | 'stub:node'
  | 'quirk:myTicketsFont';

/** Static, renderer-independent declaration of a widget's mounting needs. */
export interface WidgetManifest {
  // ── identity ────────────────────────────────────────────────
  /** Stable id — web-component tag base, Sentry title, cache-key namespace. */
  readonly name: string;

  // ── the widget ──────────────────────────────────────────────
  /** Loads the legacy widget's built component (its dist bundle). */
  readonly load: () => Promise<{ default: WidgetComponent }>;

  // ── styling (adopted into the WidgetShadow) ─────────────────
  /** Generated vendor stylesheet modules; adopted in array order (last wins cascade ties). */
  readonly vendorSheets?: readonly VendorSheet[];
  /** Hand-authored CSS strings, adopted alongside `vendorSheets`. Must not contain @font-face. */
  readonly inlineStyles?: readonly string[];
  /**
   * Vendor sheets ALSO injected into document.head as is — for UI portaled to <body>
   * (MUI poppers). Only for sheets whose every selector is the widget's own (hashed)
   * class: a `:root`, `html` or generic rule would apply to the whole page. Such a
   * sheet goes through `scopedPortalCssBridge` instead.
   */
  readonly portalSheets?: readonly VendorSheet[];

  // ── behavior ────────────────────────────────────────────────
  /** Host-agnostic shadow fix-ups, run by createWidgetShadow after the shadow is prepared. */
  readonly bridges?: readonly WidgetBridge[];
  /** Wrap the widget's React subtree (e.g. an emotion-11 CacheProvider); runs inside whichever React mounts it. */
  readonly wrapTree?: (children: ReactNode) => ReactElement;

  // ── web-component build ─────────────────────────────────────
  /** Build-actionable runtime requirements of the web-component bundle; the build maps each token to an esbuild plugin. See {@link RuntimeNeed}. */
  readonly runtimeNeeds?: readonly RuntimeNeed[];

  // ── the shadow-hosting element ──────────────────────────────
  /** Tag for the element the shadow attaches to (default 'div'); a semantic tag or custom-element name. */
  readonly elementTag?: string;
  /** Static attributes on that element (typically aria-label). */
  readonly elementAttrs?: Readonly<Record<string, string>>;
}

/**
 * Custom-element names must contain a hyphen. A widget name that already has
 * one is used as-is; a single-word name (e.g. `speakers`) gets a `-widget`
 * suffix so it forms a valid tag. Both the host-side web-component renderer and
 * the esbuild-bundled `defineWebComponent` derive the tag through this one
 * helper, so the tag one registers and the tag the other awaits can never
 * drift. Framework-free — safe for the web-component bundle to import.
 */
export function webComponentTag(name: string): string {
  return name.includes('-') ? name : `${name}-widget`;
}

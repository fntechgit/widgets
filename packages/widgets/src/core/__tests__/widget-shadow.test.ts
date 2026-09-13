// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createWidgetShadow, demoteRootSelectors } from '../widget-shadow';
import type { WidgetManifest } from '../manifest';
import type { VendorSheet } from '../vendor-sheet';
import { registerHostConfig } from '../host-config';

// Vendor sheets adopt via constructable stylesheets where supported and fall
// back to <style> elements otherwise — the first test accepts whichever branch
// the environment takes so it stays valid across jsdom versions.

const makeSheet = (id: string, extra?: Partial<VendorSheet>): VendorSheet => ({
  id,
  css: `.${id}-probe { color: red; }`,
  fontFaces: '',
  ...extra,
});

function mount(partial: Partial<WidgetManifest>): ShadowRoot {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const manifest: WidgetManifest = {
    name: 'test',
    load: async () => ({ default: () => null }),
    ...partial,
  };
  createWidgetShadow(host, manifest);
  return host.shadowRoot as ShadowRoot;
}

afterEach(() => {
  document.body.querySelectorAll('div').forEach((d) => d.remove());
  document.head
    .querySelectorAll('style[data-widget-portal-css], style[data-widget-fonts-from]')
    .forEach((s) => s.remove());
});

describe('createWidgetShadow vendor sheets', () => {
  it('applies sheet CSS inside the shadow root (adopted or fallback path)', () => {
    const root = mount({ vendorSheets: [makeSheet('alpha')] });
    const adoptedHit = [...root.adoptedStyleSheets].some((sheet) =>
      [...sheet.cssRules].some((r) => r.cssText.includes('alpha-probe')),
    );
    const fallbackHit = [...root.querySelectorAll('style')].some((s) =>
      s.textContent?.includes('.alpha-probe'),
    );
    expect(adoptedHit || fallbackHit).toBe(true);
  });

  it('injects fontFaces into document.head once per sheet id', () => {
    const sheet = makeSheet('fonty', {
      fontFaces: "@font-face{font-family:'Probe';src:url('/fonts/probe.woff')}",
    });
    mount({ vendorSheets: [sheet] });
    mount({ vendorSheets: [sheet] });
    const tags = document.head.querySelectorAll('style[data-widget-fonts-from="fonty"]');
    expect(tags).toHaveLength(1);
    expect(tags[0].textContent).toContain("font-family:'Probe'");
  });

  it('injects portal sheets into document.head, deduplicated per sheet id', () => {
    const sheet = makeSheet('portal');
    mount({ portalSheets: [sheet] });
    mount({ portalSheets: [sheet] });
    const tags = document.head.querySelectorAll('style[data-widget-portal-css="portal"]');
    expect(tags).toHaveLength(1);
    expect(tags[0].textContent).toContain('.portal-probe');
  });

  it("does not let a portal sheet's :root token defaults override the host's tokens", () => {
    // Host brand tokens, declared before the widget mounts (the normal SSR order).
    const hostTokens = document.createElement('style');
    hostTokens.textContent = ':root { --color_primary: #8dc63f; }';
    document.head.appendChild(hostTokens);

    mount({
      portalSheets: [
        makeSheet('tokens', { css: ':root {\n  --color_primary: #000000;\n}\n.tokens-probe { color: var(--color_primary); }' }),
      ],
    });

    expect(getComputedStyle(document.documentElement).getPropertyValue('--color_primary').trim()).toBe('#8dc63f');
    const injected = document.head.querySelector('style[data-widget-portal-css="tokens"]');
    expect(injected?.textContent).toContain(':where(:root)');
    hostTokens.remove();
  });
});

describe('demoteRootSelectors', () => {
  it('wraps :root selectors, including in selector lists and compounds', () => {
    expect(demoteRootSelectors(':root{--a:1}')).toBe(':where(:root){--a:1}');
    expect(demoteRootSelectors('html, :root .x{}')).toBe('html, :where(:root) .x{}');
    expect(demoteRootSelectors(':root[data-theme=DARK]{}')).toBe(':where(:root)[data-theme=DARK]{}');
  });

  it('is idempotent and leaves unrelated text alone', () => {
    expect(demoteRootSelectors(':where(:root){}')).toBe(':where(:root){}');
    expect(demoteRootSelectors('.rooted{} .x:root-ish{}')).toBe('.rooted{} .x:root-ish{}');
  });

  it('rewrites selectors inside at-rules and nested rules', () => {
    expect(demoteRootSelectors('@media (min-width: 1px) { :root { --a: 1; } }'))
      .toBe('@media (min-width: 1px) { :where(:root) { --a: 1; } }');
    expect(demoteRootSelectors('.x { color: red; :root & { color: blue; } }'))
      .toBe('.x { color: red; :where(:root) & { color: blue; } }');
  });

  it('never touches declaration values, strings, comments, url() or escaped selectors', () => {
    const untouched = [
      '.a::before { content: ":root"; }',
      ".a::before { content: ':root { }'; }",
      '.\\:root { color: red; }',
      '/* :root { --x: 1 } */ .a { color: red; }',
      '.a { background: url(/img/:root.png); }',
      '.a { --label: :root; }',
    ];
    for (const css of untouched) expect(demoteRootSelectors(css)).toBe(css);
  });

  it('keeps the rewrite alongside untouched neighbours in one sheet', () => {
    expect(demoteRootSelectors(':root { --a: 1; } .a::before { content: ":root {"; } .b { }'))
      .toBe(':where(:root) { --a: 1; } .a::before { content: ":root {"; } .b { }');
  });
});

describe('bridge lifecycle', () => {
  const bridgeManifest = (runs: number[], cleanups: number[]): WidgetManifest =>
    ({
      name: 'bridged',
      load: async () => ({ default: () => null }),
      bridges: [
        (root: ShadowRoot) => {
          runs.push(runs.length + 1);
          void root;
          return () => {
            cleanups.push(cleanups.length + 1);
          };
        },
      ],
    }) as never;

  it('runs bridges on create, cleans up on dispose, restarts on connectBridges', () => {
    const runs: number[] = [];
    const cleanups: number[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = createWidgetShadow(host, bridgeManifest(runs, cleanups));
    expect(runs).toHaveLength(1);

    shadow.connectBridges(); // no-op while running
    expect(runs).toHaveLength(1);

    shadow.dispose();
    expect(cleanups).toHaveLength(1);

    shadow.connectBridges(); // reconnect after dispose restarts the bridges
    expect(runs).toHaveLength(2);

    shadow.dispose();
    expect(cleanups).toHaveLength(2);
    host.remove();
  });
});

describe('one shadow per host', () => {
  it('throws when called twice on the same element (attachShadow contract)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = createWidgetShadow(host, { name: 'once', load: async () => ({ default: () => null }) } as never);
    expect(() =>
      createWidgetShadow(host, { name: 'once', load: async () => ({ default: () => null }) } as never),
    ).toThrow();
    shadow.dispose();
    host.remove();
  });
});

describe('asset URL substitution', () => {
  afterEach(() => registerHostConfig(null));

  const cfg = {
    apiBaseUrl: '/proxy',
    idpBaseUrl: 'https://idp.test',
    oauth2ClientId: 'cid',
    timeApiUrl: 'https://time.test',
  };

  it('replaces __WIDGET_ASSETS__ with an empty base by default (site-root paths)', () => {
    const root = mount({
      vendorSheets: [
        makeSheet('assets-default', { css: ".x{background:url('__WIDGET_ASSETS__/fonts/a.woff')}" }),
      ],
    });
    const css =
      root.adoptedStyleSheets?.map((sh) => [...sh.cssRules].map((r) => r.cssText).join('')).join('') ||
      [...root.querySelectorAll('style')].map((st) => st.textContent).join('');
    expect(css).toContain("url('/fonts/a.woff')".replace(/'/g, css.includes('"') ? '"' : "'"));
    expect(css).not.toContain('__WIDGET_ASSETS__');
  });

  it('prefixes HostConfig.assetBaseUrl (trailing slash trimmed) in css and fontFaces', () => {
    registerHostConfig({ ...cfg, assetBaseUrl: 'https://cdn.test/widgets/' });
    const root = mount({
      vendorSheets: [
        makeSheet('assets-based', {
          css: ".x{background:url('__WIDGET_ASSETS__/widget-css/a.gif')}",
          fontFaces: "@font-face{font-family:'P';src:url('__WIDGET_ASSETS__/fonts/p.woff')}",
        }),
      ],
    });
    const css =
      root.adoptedStyleSheets?.map((sh) => [...sh.cssRules].map((r) => r.cssText).join('')).join('') ||
      [...root.querySelectorAll('style')].map((st) => st.textContent).join('');
    expect(css).toContain('https://cdn.test/widgets/widget-css/a.gif');
    const fonts = document.head.querySelector('style[data-widget-fonts-from="assets-based"]');
    expect(fonts?.textContent).toContain('https://cdn.test/widgets/fonts/p.woff');
    expect(fonts?.textContent).not.toContain('__WIDGET_ASSETS__');
  });
});

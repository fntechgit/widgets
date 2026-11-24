// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { scopedPortalCssBridge } from '../scoped-portal-css';
import { createWidgetShadow } from '../../../core/widget-shadow';
import type { VendorSheet } from '../../../core/vendor-sheet';
import { myTicketsManifest } from '../../../catalog/my-tickets/manifest';

const ATTR = 'data-scoped-portal-css';

const sheet = (id: string, css: string): VendorSheet => ({ id, css, fontFaces: '' });

const makeRoot = (): ShadowRoot => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host.attachShadow({ mode: 'open' });
};

const pageColor = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

afterEach(() => {
  document.body.replaceChildren();
  document.head
    .querySelectorAll(`style[${ATTR}], style[data-widget-portal-css], style[data-widget-fonts-from], style[data-host-tokens]`)
    .forEach((s) => s.remove());
});

describe('scopedPortalCssBridge', () => {
  it('injects the sheets into document.head inside @scope (<container>)', () => {
    scopedPortalCssBridge('body', [sheet('a', '.a___x { color: red; }'), sheet('b', '.b___y { color: blue; }')])(makeRoot());

    const tags = document.head.querySelectorAll(`style[${ATTR}]`);
    expect(tags).toHaveLength(1);
    expect(tags[0].getAttribute(ATTR)).toBe('body|a,b');
    expect(tags[0].textContent).toMatch(/^@scope \(body\) \{/);
    expect(tags[0].textContent).toContain('.a___x');
    expect(tags[0].textContent).toContain('.b___y');
  });

  it('injects once per container and sheet set', () => {
    const bridge = scopedPortalCssBridge('body', [sheet('a', '.a___x { color: red; }')]);
    bridge(makeRoot());
    bridge(makeRoot());
    expect(document.head.querySelectorAll(`style[${ATTR}]`)).toHaveLength(1);
  });
});

describe('my-tickets portal CSS', () => {
  // The site's own token block, server-rendered before any widget mounts.
  const addHostTokens = () => {
    const style = document.createElement('style');
    style.setAttribute('data-host-tokens', '');
    style.textContent = ':root { --color_primary: #8dc63f; --color_secondary: #00539b; }';
    document.head.appendChild(style);
  };

  it("keeps the page's color tokens when the widget mounts", () => {
    addHostTokens();
    const host = document.createElement('section');
    document.body.appendChild(host);

    createWidgetShadow(host, myTicketsManifest);

    // The widget's sheet ships its own defaults on :root (#000000 / #00a2ff).
    expect(pageColor('--color_primary')).toBe('#8dc63f');
    expect(pageColor('--color_secondary')).toBe('#00539b');
  });

  it('sends its CSS to the head only inside @scope (body)', () => {
    const host = document.createElement('section');
    document.body.appendChild(host);

    createWidgetShadow(host, myTicketsManifest);

    expect(document.head.querySelector('style[data-widget-portal-css]')).toBeNull();
    const scoped = document.head.querySelector(`style[${ATTR}]`);
    expect(scoped?.textContent).toMatch(/^@scope \(body\) \{/);
    expect(scoped?.textContent).toContain(':root');
  });
});

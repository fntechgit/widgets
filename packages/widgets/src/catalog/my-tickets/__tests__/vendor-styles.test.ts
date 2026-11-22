import { describe, it, expect } from 'vitest';
import { sheet as generated } from '../../../lib/vendor-css/my-orders-tickets-widget';
import { myTicketsColorFallbacks, myTicketsSheets } from '../vendor-styles';

const fallbacks = Object.entries(myTicketsColorFallbacks);
const css = myTicketsSheets.map((s) => s.css).join('\n');

describe('my-tickets status-color fallbacks', () => {
  it.each(fallbacks)('every use of %s carries the fallback', (name, value) => {
    expect(css).not.toContain(`var(${name})`);
    expect(css).toContain(`var(${name}, ${value})`);
  });

  it.each(fallbacks)("%s falls back to the widget's own :root default", (name, value) => {
    const defaults = [...generated.css.matchAll(new RegExp(`${name}:\\s*([^;}]+)`, 'g'))].map((m) => m[1].trim());
    expect(defaults.length).toBeGreaterThan(0);
    expect(new Set(defaults)).toEqual(new Set([value]));
  });
});

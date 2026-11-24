import type { VendorSheet } from '../../core/vendor-sheet';
import { sheet as myTickets } from '../../lib/vendor-css/my-orders-tickets-widget';

/**
 * The widget's own defaults for its ticket-status colors. Sites don't set
 * these two tokens, and the widget sets them on `:root`, which matches
 * nothing inside the shadow or inside the drawers' `@scope (body)` copy.
 * So every use gets the default as a `var()` fallback; a site that sets the
 * token still wins. The real fix belongs upstream: see UPSTREAM.md entry 19.
 */
export const myTicketsColorFallbacks = {
  '--color_success': '#4caf50',
  '--color_warning': '#ff9800',
} as const;

const withColorFallbacks = (sheet: VendorSheet): VendorSheet => ({
  ...sheet,
  css: Object.entries(myTicketsColorFallbacks).reduce(
    (css, [name, value]) => css.replaceAll(`var(${name})`, `var(${name}, ${value})`),
    sheet.css,
  ),
});

/**
 * Style dependencies for the My Orders & Tickets widget.
 *
 * The widget is MUI-based: its runtime styles come from emotion (mirrored
 * into the shadow by the emotion bridge), and its static stylesheet
 * carries no bootstrap/font-awesome classes and no `url()` references —
 * so the sheet set is just its own CSS, with the status-color fallbacks.
 */

export const myTicketsSheets = [withColorFallbacks(myTickets)] as const;

/**
 * Hand-authored override adopted into the shadow root.
 *
 * The widget renders each filter section — and the "Filters" panel title —
 * as a MUI `<CardHeader>` whose title is Typography `variant="h5"`
 * (~1.6rem / 25.6px in MUI's default scale), which is oversized for a
 * filter label. Shrink it to the 16px baseline, scoped to the filter
 * dropdown so any `CardHeader` on the ticket cards keeps its own size.
 * The real fix belongs upstream — see UPSTREAM.md entry 9.
 */
export const myTicketsStyles = [
  `[class*="filterListContainer___"] .MuiCardHeader-title {
    font-size: 1rem;
    line-height: 1.4;
  }`,
] as const;

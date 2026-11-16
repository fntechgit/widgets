/**
 * The host renders its own schedule controls and the schedule shows no
 * heading, so the widget's header block is redundant: it holds the title,
 * the subtitle and the button-bar (timezone / 12-24h / Print / Share / view
 * toggle). Hide the block itself, not only what is in it, so its bottom
 * margin goes too and the host's spacing above the schedule holds.
 *
 * The block has no stable class, so target it hash-agnostically: it is the
 * only element with the widget's stable `widget-title` hook as a DIRECT
 * child (rather than a build-specific hashed class, which would break on
 * every widget rebuild).
 */
export const css: string = `
:has(> .widget-title) {
  display: none !important;
}
`;

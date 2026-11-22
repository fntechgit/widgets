/// <reference path="../../lib/widget-modules.d.ts" />
import type { WidgetManifest } from '../../core/manifest';
import { emotionMirrorBridge } from '../../lib/bridges/emotion-mirror';
import { clickOutsideRetargetBridge } from '../../lib/bridges/click-outside-retarget';
import { scopedPortalCssBridge } from '../../lib/bridges/scoped-portal-css';
import { myTicketsSheets, myTicketsStyles } from './vendor-styles';
// Side-effect: seed the widget's i18n dictionary before it mounts.
import 'my-orders-tickets-widget/dist/i18n';

export const myTicketsManifest: WidgetManifest = {
  name: 'my-tickets',
  load: () => import('my-orders-tickets-widget/dist/index'),
  vendorSheets: myTicketsSheets,
  inlineStyles: myTicketsStyles,
  // emotion-mirror: the widget's MUI runs on its own split emotion-11 instance
  // that injects into document.head; click-outside-retarget: its Filter/Sort
  // dropdowns read a retargeted event.target inside shadow; scoped-portal-css:
  // the ticket detail / assign / refund drawers, the confirm dialog and the
  // tooltips portal into document.body. Their CSS goes to the head inside
  // `@scope (body)`, so the sheet's color defaults on `:root` and
  // `html[data-theme="DARK"]` never match <html> and the page keeps the
  // host's colors.
  bridges: [
    emotionMirrorBridge,
    clickOutsideRetargetBridge,
    scopedPortalCssBridge('body', [...myTicketsSheets]),
  ],
  // v5-era MUI; dist pulls @react-pdf/renderer (Node built-ins); ships its own
  // MUI theme (CustomTheme) with no fontFamily.
  runtimeNeeds: ['pin:mui5', 'stub:node', 'quirk:myTicketsFont'],
  elementTag: 'section',
  elementAttrs: { 'aria-label': 'My orders and tickets' },
};

// Uniform alias so the web-component entry codegen can import `{ manifest }`
// (@openeventkit/web-components' scripts/build.mjs) regardless of widget.
export { myTicketsManifest as manifest };

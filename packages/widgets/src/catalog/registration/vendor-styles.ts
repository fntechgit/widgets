/**
 * Style dependencies for the Registration widget.
 *
 * `sheets` — generated vendor-css modules adopted into the shadow root.
 * Order matters: the widget's own CSS comes last so it wins cascade ties.
 *
 * `styles` — hand-authored CSS strings adopted into the shadow root.
 * Used for CSS that has no generated module:
 *   - `react-tooltip@3` inlines its CSS in its JS bundle
 *   - `widget-buttons` is our own supplemental `.button` baseline
 *   - an inline `:host` rule keeps the MUI Backdrop loader over the form
 *
 * Rationale for each sheet:
 *   Bootstrap 3 + Font Awesome 4 — documented as required externals in
 *     summit-registration-lite/README.md
 *   awesome-bootstrap-checkbox — styles the `.abc-radio` / `.abc-checkbox`
 *     structure the widget renders for the "Ticket is for" radios and the
 *     consent checkboxes (hides the native control, draws a custom one)
 *   react-tooltip — widget uses <ReactTooltip>; its runtime CSS injects
 *     into document.head, which shadow scope doesn't inherit
 *   widget-buttons — the plain `.button` class the widget renders (e.g.
 *     the cookie-consent Accept button) has no styling of its own
 *
 * Deliberately NOT included: Bulma. reg-lite's dist carries Bulma classes
 * (`modal is-active`, `modal-background`) but only in its
 * registration-modal entry — the popup-overlay flavor of the widget. We
 * mount `dist/components/registration-form` (the inline flavor), whose
 * bundle contains none of them, so the Bulma path is unreachable here.
 */

import { css as reactTooltipCss } from '../../lib/styles/react-tooltip';
import { css as widgetButtonsCss } from '../../lib/styles/widget-buttons';
import { css as skeletonCss } from '../../lib/styles/skeleton';
import { sheet as bootstrap } from '../../lib/vendor-css/bootstrap.min';
import { sheet as fontAwesome } from '../../lib/vendor-css/font-awesome.min';
import { sheet as abcCheckbox } from '../../lib/vendor-css/awesome-bootstrap-checkbox';
import { sheet as regLite } from '../../lib/vendor-css/summit-registration-lite';

export const registrationSheets = [bootstrap, fontAwesome, abcCheckbox, regLite] as const;

export const registrationStyles = [
  reactTooltipCss,
  widgetButtonsCss,
  skeletonCss,
  // reg-lite calls <AjaxLoader relative />, which the runtime serves as our
  // MUI Backdrop (lib/compat/uicore-ajaxloader). The backdrop is absolutely
  // positioned and reg-lite's root is not, so without this rule it covers the
  // whole page and its navbar. This keeps it over the form only.
  `:host { position: relative; isolation: isolate; }`,
] as const;

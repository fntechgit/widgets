# UPSTREAM — widget & uicore maintenance registry

Companion to [CONSTRAINTS.md](./CONSTRAINTS.md). That document maps the
constraints the legacy widget stack imposes and how they are contained —
in these packages and in the hosts that mount them; **this one is the
actionable backlog of changes in the widget and uicore repos themselves**
— fixes and refactors that resolve bugs without altering other consumers'
behavior, and in several cases let containment code here or in a host be
deleted or simplified. When a trade-off gets pushed to its edge, its
resolution lands here. Host file paths below are the reference host's.

The widget repos live in the `fntechgit` GitHub org and uicore in
`OpenStackweb` — the same orgs that publish the packages — so these are
ordinary upstream contributions, not fork maintenance.

Entry format: **what changes / where / what it resolves / why it's safe
for other consumers / what containment gets deleted once shipped / status**.

---

## Version strategy (the headline constraint)

- The widget lane is pinned to uicore's **v4.x line** (`v4.x` branch,
  currently `4.2.39`, React peer ^16.6). Every widget's declared uicore
  range is 4.x (my-orders `4.2.8`, reg-lite `4.2.34`, full-schedule
  `^4.0.6` in deps / `^4.1.23` peer, lite `^4.0.7` deps / `^4.0.12`
  peer, feedback `^4.0.7`). The host itself imports **zero** uicore —
  it stays inside `@openeventkit/widgets`.
- uicore **5.x** is `main` (npm `latest`, `5.0.47`, React peer ^17) and
  is where active development happens. Widget dists *externalize* uicore,
  so installing 5.x would feed restructured 5.x modules into bundles
  built against 4.x — the exact breakage class the containment prevents.
- Therefore: contribute fixes to **both lines** where the code exists in
  both — the org already runs a dual-line flow (`feature/x` on main plus
  `feature/x-v4` backports). 5.x adoption is a coordinated future wave
  (see the umbrella entry) taken when the widgets bump their own peers.
  **But 5.x does not itself remove the React-19 blockers** — verified,
  `5.0.47` still peers `react-select ^2.4.3`, `react-bootstrap ^0.31.5`,
  and React `^17`. The unlock is lib-level, not a version bump; see the
  Dependency-deprecation ledger below.

## Dependency-deprecation ledger (React-19 compat)

The entries below are per-repo fixes. This section is the cross-cutting
view: **which legacy lib forces which containment**, verified against the
**installed** trees (not peer ranges), so deprecations can be sequenced by
leverage rather than symptom.

**uicore 5.x does NOT unlock React 19 — verified.**
`openstack-uicore-foundation@5.0.47` (npm `latest`) still peers
`react-select ^2.4.3`, `react-bootstrap ^0.31.5`, and `react ^17.0.0` /
`react-dom ^17.0.0` — the same two blocker libs as `4.2.34`, and a React
peer two majors below 19. A 4→5 bump dissolves none of the React-19 shims
and doesn't reach React 19; it buys MUI 6 and React-17-era APIs, nothing
that removes a shim. The unlock is the specific lib replacements below,
independent of the major.

### Each shim traces to one forcing lib

| Containment code | Forced by (verified installed) | Widget entry point |
|---|---|---|
| `webpack-compat` findDOMNode rule + `compat/react-dom-with-find-dom-node.ts` | **react-select@2.4.4** (static `findDOMNode` import; the webpack rule is scoped to `react-select@2`) | uicore forms |
| `compat/react-element-symbol.ts` — guards a **stack overflow on mount**, not a warning | **pure-react-carousel** (its bundled deepmerge checks the old `react.element` `$$typeof`) | speakers-widget |
| `schedule-lite/transition-group.ts` neutralization CSS | **react-transition-group** 1.x (bundled in lite-schedule) + 2.9.0 (via react-select) | lite-schedule + react-select |
| `compat/find-dom-node.ts` runtime patch | react-select@2 **plus any other `ReactDOM.findDOMNode` caller** — broader; audit callers before deleting | multiple |

### Installed blocker libs → console line

| Lib | Installed | Console | Pulled by | Owner |
|---|---|---|---|---|
| react-select | `2.4.4` | #6 `componentWillReceiveProps Select` | uicore peer (4.x + 5.x both `^2.4.3`) → reg-lite, my-orders, feedback, extra-q | uicore |
| react-bootstrap | `0.33.1` | #1, #2 (removed legacy context) | lite-schedule (local); uicore peers `^0.31.5` | lite-schedule (Entry 2) |
| react-transition-group | `1.x` bundled + `2.9.0` | #5 `componentWillMount` | lite-schedule + react-select | falls out of the two above |
| pure-react-carousel | bundled | none (crash, shimmed) | speakers-widget | speakers-widget |
| full-schedule own code | `3.1.3` | #4 `componentWillMount Schedule`, #7 JSX transform | — | full-schedule dist rebuild |
| react-scroll | `1.9.3` | #8 `target Element not found` — **benign** | full-schedule | leave |
| use-fit-text | `2.4.0` | #9 `minFontSize` INFO — **benign** | uicore | leave |
| react-stars `2.2.5` + react-star-ratings `2.3.0` | both | none | feedback / uicore | **duplicate** — consolidate opportunistically |

### Leverage order (deprecate → what it deletes)

| Rank | Move | Clears | Deletes containment | Widgets helped | Effort / risk |
|---|---|---|---|---|---|
| 1 | **uicore: react-select 2 → 5** | #6 | findDOMNode **webpack rule** + `react-dom-with-find-dom-node.ts`; drops react-transition-group@2.9.0 | **all uicore-form widgets** | M — real v2→v5 API migration, both lines; runtime findDOMNode patch stays until all callers gone |
| 2 | **lite-schedule: drop react-bootstrap 0.33** (Entry 2) | **#1, #2**, #5 | `schedule-lite/transition-group.ts`; *maybe* bootstrap vendor CSS (only if lite-schedule is its sole consumer — verify) | lite-schedule | M — Node-16 rebuild; loses list fade |
| 3 | **speakers: replace pure-react-carousel** | none | **`compat/react-element-symbol.ts`** + removes a stack-overflow crash class | speakers | S–M |
| 4 | **full-schedule: dist rebuild, modern imports** | #4, #7 (+#8 if react-scroll swapped) | contributes to the RC-B/E/S vendor-CSS teardown | full-schedule | L |

Ranks 1 + 2 are independent and together retire every non-benign React-19
console line (#1, #2, #5, #6) plus the findDOMNode and transition-group
containment — and both are lib-level code changes, not version bumps.

**Verify before trusting a "deletes" claim**: (a) whether bootstrap vendor
CSS (`bootstrap.min.ts`, `awesome-bootstrap-checkbox.ts`) has consumers
beyond lite-schedule; (b) whether the `find-dom-node.ts` runtime patch has
callers beyond react-select. Both decide whether the deletion is clean.

**Benign, no action** (no shim, cosmetic only): #8 `react-scroll` internal
scroll-target miss; #9 `use-fit-text` info log. Recorded so they stop
resurfacing as "unexplained."

## Entries

### 1. full-schedule: null/optional-safe `loggedUser` derivation — PR #58 (open)
- **Repo**: `fntechgit/full-schedule-widget`, `src/reducer.js:244`.
  Introduced upstream in `d8c1636` (RSVP feature, PR #52).
- **Resolves**: crash on logout (`null` profile dereferenced) and
  silently-stuck-anonymous after in-place login (`schedule_summit_events`
  is optional in consumer profiles; `.map` on `undefined` kills the
  dispatch, store keeps `loggedUser: null`). Host task #179.
- **Change**: `userProfile ? { ...userProfile, schedule_summit_events:
  (userProfile.schedule_summit_events || []).map((ev) => ev.id) } : null`.
  The widget's only null-guarded user derivation is `LOAD_INITIAL_VARS`
  (`reducer.js:122`) — but its own `.map` at line 126 is equally
  unguarded against the optional field (same crash, at mount, for a
  logged-in user whose profile omits it): guard it in the same change.
- **Same-class siblings** (latent today — UI-guarded via `needsLogin` /
  RSVP gating — but worth hardening while in the file):
  `RSVP_CONFIRMED` spreads `state.loggedUser.rsvp` and
  `RSVP_CANCELLED_OPTIMISTIC` filters it, both unguarded against a null
  user or absent `rsvp` (contrast `decorateEvents`, which guards with
  `user?.rsvp || []`); `ADDED_TO_SCHEDULE` / `REMOVED_FROM_SCHEDULE`
  spread a possibly-null user.
- **Safe because**: strictly widens accepted input; identical output for
  the shapes that worked before.
- **We delete**: nothing (the discarded remount workaround stays out);
  restores the live login/logout reactivity as designed.
- **Status**: **[PR #58](https://github.com/fntechgit/full-schedule-widget/pull/58)
  open** — guards both `UPDATE_LOGGED_USER` and `LOAD_INITIAL_VARS` and
  adds a 6-test `src/__test__/reducer.test.js` regression file. Supersedes
  the earlier parked `fix/update-logged-user-null-safe` branch (which
  covered only `UPDATE_LOGGED_USER`). Awaiting merge → publish → pin 3.1.4.

- **Host shim removal condition (spans entries 1–3)**: the reference
  host's `src/widgets/shared/useWidgetSafeProfile.ts` defaults
  `schedule_summit_events` / `rsvp` to `[]` before the profile crosses into
  full / lite / upcoming — the same `missing field → []` guard these three
  PRs add in the reducer. Its **array-defaulting is removable only once all
  three reducer guards ship and are pinned** — [#58](https://github.com/fntechgit/full-schedule-widget/pull/58)
  (full), [upcoming #23](https://github.com/fntechgit/upcoming-events-widget/pull/23),
  [lite #12](https://github.com/fntechgit/lite-schedule-widget/pull/12) —
  since it guards whichever widget's fix hasn't landed yet. Its
  optimistic-schedule merge role (`useWidgetSafeProfile`) is separate and
  stays.

### 2. lite-schedule: React-19 compat + `needsLogin` prop
- **Repo**: `fntechgit/lite-schedule-widget`. The parked compat work
  (its branch is no longer on the remote; `feature/bootstrap-update` is
  the closest surviving line) replaces
  react-bootstrap 0.33 `<Navbar>` (legacy `childContextTypes` — removed
  in React 19, not shimmable) with plain Bootstrap-3 markup; drops
  `react-transition-group`. Add: optional `needsLogin(pendingAction)`
  prop replacing the SweetAlert anonymous dead-end (`event.js:50`;
  mirrors full-schedule's contract — note that contract is loose:
  full-schedule calls it with 0, 1, or 2 args
  (`needsLogin(pendingAction, message?)`)).
- **Consumer-visible caveat**: dropping `CSSTransitionGroup` removes the
  event-list enter-fade for *all* consumers, including React-16 hosts
  where it still worked, and consumers with CSS or tests keyed to
  react-bootstrap's generated DOM could observe differences. Cosmetic,
  but not literally "no observable change".
- **Same-class reducer guards**: the `LOAD_INITIAL_VARS` (`reducer.js:97`)
  unguarded `schedule_summit_events.map` from entry 1's bug class is now
  shipped separately as
  [**PR #12**](https://github.com/fntechgit/lite-schedule-widget/pull/12)
  (`fix: null-safe schedule_summit_events`, reducer-only), ahead of this
  entry's broader react-bootstrap / `needsLogin` work — merging it lets the
  host shim (entry 1's removal-condition note) drop lite's share. Still to
  fold into the React-19 release: `ADDED_TO_SCHEDULE` /
  `REMOVED_FROM_SCHEDULE` (181–191) spread a possibly-null user.
- **We delete**: `schedule-lite/transition-group.ts` neutralization
  CSS; closes host tasks #168/#170 residue; last React-19 incompatibility
  in the fleet.
- **Status**: branch parked at user direction; builds under Node 16
  (node-sass).

### 3. upcoming-events: optional `needsLogin` prop
- Same SweetAlert dead-end as lite-schedule (`event.js:42`, no
  callback); anonymous adds currently terminate in a Swal alert. An
  optional prop defaulting to the Swal path is genuinely non-breaking.
  Low priority — the reference host doesn't mount the widget on any
  production page (its dev-only gallery composes it); matters for
  base-theme consumers.
- **Same-class reducer guards**: the `LOAD_INITIAL_VARS` (`reducer.js:96`)
  unguarded `schedule_summit_events.map` is now shipped separately as
  [**PR #23**](https://github.com/fntechgit/upcoming-events-widget/pull/23)
  (`fix: null-safe schedule_summit_events`, reducer-only). Still to fold in
  when the `needsLogin` work is touched: `ADDED_TO_SCHEDULE` (123–124)
  null-user spread.
- **Host workaround today**: that unguarded read crashes the widget on a
  `null → profile` transition (a user logging in while it's already
  mounted). The reference host's `src/widgets/catalog/upcoming-events/Client.tsx`
  passes a `getKey` to
  `createWidgetClient` deriving `userProfile.id ?? 'anon'`, so that
  transition becomes a clean remount instead of an in-place compare. The
  `getKey` comes out once **PR #23** ships and is pinned.

### 4. my-orders-tickets: `getAccessToken` callback prop
- **Repo**: `fntechgit/my-orders-tickets-widget`. Replace the three
  direct `openstack-uicore-foundation/lib/security/methods` imports
  (`getAccessToken`, `initLogOut`, `getIdToken`) with a callback prop
  wired from settings — the pattern every other widget uses. The
  `getIdToken` company-enrichment branch becomes a prop or is dropped
  (it already no-ops in cookie-authority hosts).
- **Semver reality**: a prop-only token read is **breaking** for
  existing hosts that rely on uicore's localStorage lifecycle. Either
  default the prop to uicore's own function (keeps the import in the
  module graph, weakening our deletion payoff) or make it required and
  cut a major. Prefer the major, batched with entry 6's my-orders half
  into one release. (reg-lite has taken `getAccessToken` via props from
  the start — the pattern is right, but here it's a retrofit.)
- **Not fixed by this entry**: my-orders' 403 path (`errorHandlerNotify`,
  `actions.js:201–208`) invokes the `callback` uicore's `authErrorHandler`
  passes it, which is uicore's `initLogOut`. In this host that call lands on
  `HostAuth.logout`, because uicore's `initLogOut` delegates to the handler
  set through `setAuthHandlers` (see the uicore seam below). Adopt the
  notify-handler design from entry 5 in the same major anyway, so the widget
  does not depend on a host-level handler.
- **We delete**: nothing on our side. The token resolver serves uicore's
  internal callers (`query-actions`, the request helpers in `utils/actions`)
  for every widget dist, so `src/lib/uicore-host.ts`, the `src/core/`
  `HostAuth` port and the host's `configureWidgetHost` wiring stay as long as
  any dist externalizes uicore (CONSTRAINTS RC-X). This entry removes my-orders' direct
  `security/methods` imports from its footprint and makes its token source
  explicit, like every other widget.
- **uicore seam (what the host relies on)**: uicore ships opt-in setters:
  `setConfig` in `lib/utils/config`, and `setAccessTokenResolver` +
  `setAuthHandlers({ initLogOut, authErrorHandler })` in
  `lib/security/methods`. `getAccessToken` returns the resolver's answer for
  every caller (`query-actions` included) before touching localStorage;
  `initLogOut` and the 401/403 branch of `utils/actions` `authErrorHandler`
  call the injected handlers when set. `configureUicore()` (this package's
  `src/lib/uicore-host.ts`) calls all three, reading the `HostConfig` and
  `HostAuth` ports, in the host graph and in the web-component shared
  runtime. The setters are on npm from uicore 4.2.39 (the token resolver
  from 4.2.36), the version this package pins. The reference host's
  `src/__tests__/config/uicore-install.test.ts`
  fails on an installed uicore without them. Direct `getIdToken` / `storeAuthInfo`
  imports are not covered by the setters; they are uicore's own localStorage
  functions and read nothing a cookie-authority host writes.

### 5. reg-lite: injectable auth error handling (403 path)
- **Repo**: `fntechgit/summit-registration-lite`. Its dist externalizes
  uicore (`nodeExternals`) and `require`s
  `openstack-uicore-foundation/lib/utils/actions` at runtime; that
  module imports `doLogin, initLogOut` from
  `../components/security/methods` **relatively**, so the host's
  bare-specifier alias never intercepts it. A 403 can trigger an IDP
  end-session redirect built from empty localStorage state, bypassing
  the host's logout.
- **No uicore contribution needed**: the injection point already ships.
  `feature/enhance-auth-error-handler` is a stale pre-merge branch —
  its content merged as PR #130 (`58d3303`, right after v4.1.55), so
  `authErrorHandler(err, res, notifyErrorHandler = showMessage)` is in
  every 4.2.x (including reg-lite's 4.2.34 and my-orders' 4.2.8) and in
  5.x. my-orders already passes a handler (`actions.js:207`).
- **Change (reg-lite only)**: thread a host-injectable notify handler
  through its ~5 `authErrorHandler(err, res)` call sites (one passes
  positionally, ~line 373) and the `customErrorHandler` fallback paths.
  Design rule: on 403 the injected handler receives uicore's real
  `initLogOut` as `callback` and must **not** invoke it; on the 401
  custom-handler branch the callback is uicore's `initLogin`/`doLogin`
  — also localStorage/redirect-based, same rule. Optional prop
  defaulting to current behavior → non-breaking.
- **Containment (implemented)**: `configureUicore()`
  (this package's `src/lib/uicore-host.ts`) registers an `authErrorHandler`
  through uicore's `setAuthHandlers` (see entry 4). uicore's
  `utils/actions` calls it for 401/403 instead of its own `doLogin` /
  `initLogOut` flows; the handler raises the host's widget-auth-error event
  and `<WidgetAuthErrorDialog>` owns the treatment (message first; login modal
  or host logout only on explicit user action); other statuses keep uicore's
  default path. uicore's `initLogOut` delegates to `HostAuth.logout` through
  the same setter, so a widget that invokes the callback it is handed still
  lands on the host logout. Covers every widget dist (all nine require the
  module). See CONSTRAINTS RC-X.
- **Status**: defect contained through the uicore setters; the reg-lite
  change remains the per-widget resolution, so the widget does not depend on
  a host-level handler. The notify-handler contract designed here is reused
  by entry 4's my-orders release.

### 6. uicore: converge on `extra-questions-mui`
- **Repo**: `OpenStackweb/openstack-uicore-foundation`.
  `feature/extra-questions-mui` merged long ago (`21d6aec`, PR #177) —
  the component ships identically on **both** v4.x and main. It is
  structurally my-orders' local `ExtraQuestionsFields` family
  (`TextQuestionField`, `DropdownQuestionField`, `utils.js`,
  `constants.js` are byte-identical), but **no widget consumes it**.
- **The drift to sync from my-orders** (the maintained copy):
  - the dispatcher adds an `originalAnswers` prop and computes field
    `disabled` from `originalAnswers[slug]` instead of
    `formik.values[slug]` (real fix — otherwise answering once
    mid-session locks the field);
  - three field components (Checkbox, CheckboxList, RadioList) wrap
    question labels in `RawHTML`.
- **Blast radius**: summit-admin (uicore 5.0.32) consumes
  `ExtraQuestionsMUI` in two components with `allowEdit`. The synced
  dispatcher must default `originalAnswers` (or fall back to formik
  initialValues) or summit-admin throws on its next uicore bump — the
  non-breaking claim depends on this.
- **Change**: sync the drift to v4.x + main, then have my-orders
  consume it and delete its local copy — one canonical MUI
  question-form for the lane. (The classless-submit-button paper cut
  belongs to uicore's *bootstrap* `ExtraQuestionsForm` only — the MUI
  variant renders no submit button; the host owns it.) The uicore
  release must precede the my-orders consumption change; batch the
  my-orders half with entry 4's major release.
- **We gain**: this package's `extra-questions` subpath can offer
  consumers the MUI variant instead of the bootstrap-era form. The
  reference host's own light-DOM port (`src/components/extra-questions/`)
  stays — it exists for theme/no-formik/boundary reasons the widget lane
  can't meet.

### 7. uicore: `buildAPIBaseUrl` SSR bug + stale docs
- Host task #176. Verified in both `v4.x` and `main`
  (`src/utils/methods.js:126`): the no-`window` branch follows
  `return null` with a template literal — a tagged-template *invocation
  of null* — so any SSR call throws a TypeError instead of returning
  null. Fix to a plain `return null;` — strictly widens (throw → null).
  No dependencies; contribute to both lines.

### 8. Umbrella: React-19 modernization wave (not a version bump)
> **Alternative strategy:** isolating each widget as a web component
> deletes the same shims *without* modernizing — evaluated with a
> working POC in [ISOLATION-STRATEGY.md](../web-components/ISOLATION-STRATEGY.md). Web components and modernization are not
> exclusive; this entry is the long-term debt-paydown path.
- The coordinated future move: each widget rebuilds its dist on modern
  React + modern deps, **replacing the blocker libs per the
  Dependency-deprecation ledger above** — react-select 2→5 in uicore,
  react-bootstrap 0.33 out of lite-schedule, pure-react-carousel out of
  speakers. That — not a uicore version bump — is what dissolves the
  React-19 shims (`findDOMNode`, element-symbol), shrinks the vendor-CSS
  surface, and retires this document's per-widget stopgaps.
- **Adopting uicore 5.x is orthogonal to the React-19 unlock**:
  `5.0.47` still peers `react-select
  ^2.4.3`, `react-bootstrap ^0.31.5`, and React `^17` — same blockers as
  4.2.34, and short of React 19. It buys MUI 6 and React-17-era APIs,
  removes no shim. The react-select swap (ledger rank 1) must happen
  regardless of the major.
- Blocked on entries 1–6 landing first; sequence per CONSTRAINTS "Meta
  observations" (dist rebuild with modern imports > react-select
  replacement > narrow typed props > shadow-DOM awareness).

### 9. my-orders-tickets: oversized filter section titles (h5 CardHeader)
- **Repo**: `fntechgit/my-orders-tickets-widget`. The Filter dropdown
  renders the "Filters" panel title and every filter section header
  (Assigned, Status, Ticket Type, Promo Code, Free / Paid) as a MUI
  `<CardHeader>` whose `title` is Typography `variant="h5"` — ~1.6rem /
  25.6px in MUI's default scale. That is heading-sized, not label-sized,
  so the dropdown reads oversized. Not a shadow-DOM artifact: the sizes
  are the same in a plain page (measured in the host: 25.6px vs the widget's
  own 16px `titleWrapper`).
- **Change**: use a smaller variant (e.g. `subtitle1` / `h6`) or a fixed
  ~1rem size for the filter `CardHeader` titles. Cosmetic, non-breaking —
  no props or auth involved. Lowest priority in this list.
- **Contained**: shadow-adopted override in `my-tickets/vendor-styles.ts`
  (`myTicketsStyles`) scoping `.MuiCardHeader-title` inside
  `.filterListContainer___*` to 1rem. Delete once the upstream release
  ships.

### 10. reg-lite + uicore: MUI v5 components run under the host's MUI 9
- **Repos**: `fntechgit/summit-registration-lite` and
  `openstack-uicore-foundation` (`CompanyInputV2`). Both peer
  `@mui/material ^5.15` and ship v5-era code, but resolved against the host's
  **MUI 9** (React-18+), where `TextField`/`Autocomplete` moved
  `InputLabelProps` / `ListboxProps` into `slotProps` — the old props spread
  onto DOM nodes (`React does not recognize the InputLabelProps prop…`), and a
  v9-on-the-bundled-runtime mismatch lurks beyond the warnings.
- **Contained (implemented)**: the web-component build pins MUI to the
  installed **MUI 5 tree** — `mui5PinPlugin` in
  `@openeventkit/web-components`' `scripts/build.mjs` redirects every top-level
  `@mui/*` / `@emotion/*` import to that tree via esbuild's ESM-aware
  `build.resolve`. MUI 5
  lives in **shared import-map MUI chunks**, fetched only by the widgets
  whose module graphs import them; each MUI widget's
  `.shared.js` externalizes `@mui/*`/`@emotion/*` to it rather than bundling its
  own. So uicore + all MUI widgets share one coherent MUI 5, the host's
  MUI 9 never enters, and the prop warnings are gone. (Same pin is the vehicle for
  widget font via `--font_family` — see CONSTRAINTS RC-H.2. Full design in
  [SHARED-MUI-RUNTIME.md](../web-components/SHARED-MUI-RUNTIME.md).)
- **Change (retires the pin)**: uicore `company-input-v2.js:250`
  `InputLabelProps` → `slotProps.inputLabel`; reg-lite
  `personal-information/index.js:269` `ListboxProps` → `slotProps.listbox` (or
  both align their MUI major with the host). Non-breaking on 5.x (slotProps
  since 5.15).
- **We delete**: `mui5PinPlugin` (the MUI-5 pin) once uicore/widgets
  align MUI majors — an instance of the per-widget-runtime-requirements
  direction (a pin belongs to the widgets that need MUI 5, not the build
  globally).
- **Status**: contained by the pin; the prop/major migration remains
  the resolution.

### 11. reg-lite: Stripe Payment Element must escape the shadow (slot)
- **Repo**: `fntechgit/summit-registration-lite`, `src/components/stripe-form/index.js`.
- **Resolves**: Stripe Elements cannot mount inside a shadow root — Stripe reaches
  its iframes via `window.frames`, which can't see shadow trees (stripe/stripe-js#143).
  Under web-component isolation the payment step renders but cannot tokenize
  without the slot.
- **Change (the Stripe-recommended workaround)**: when the form detects it is in a
  shadow (`getRootNode() instanceof ShadowRoot`, via a callback ref), render
  `<PaymentElement>` into a light-DOM node projected back in-flow via a named
  `<slot>` + `createPortal` to the shadow host; render inline otherwise. Verified:
  a light-DOM-slotted element tokenizes; in-shadow does not.
- **Safe because**: no-shadow consumers keep the inline path unchanged.
- **We delete**: nothing on our side (the slot lives in the widget). Registration
  is in the web-component `WIDGETS` list on the strength of it.
- **Status**: [PR #159](https://github.com/fntechgit/summit-registration-lite/pull/159)
  (open, changes requested). The deploy overlay builds registration from the
  fork branch that carries it (`gcutrini/summit-registration-lite#deploy/wc-registration`)
  until it is released.

### 12. reg-lite: import RadioList/Dropdown by subpath, not the uicore barrel
- **Repo**: `fntechgit/summit-registration-lite`, `personal-information/index.js`
  + `lawpay-form/index.js`.
- **Resolves**: each imports one component from the whole
  `openstack-uicore-foundation/lib/components` barrel. In the web-component build
  that forces the ENTIRE uicore component library into the shared runtime
  (**~11 MB**: 1465 KB → ~12.4 MB).
- **Change**: `import { RadioList } from '.../lib/components'` →
  `import RadioList from '.../lib/components/inputs/radio-list'`; same for
  `Dropdown` → `.../inputs/dropdown`. Both underlying modules are `export default`
  and the barrel just re-exports them — an exact equivalent.
- **We delete**: the `lib/components` barrel from the served runtime surface (add
  `inputs/radio-list`; `inputs/dropdown` already exposed) — a large drop off the
  once-loaded shared runtime.
- **Status**: [PR #156](https://github.com/fntechgit/summit-registration-lite/pull/156)
  merged; awaiting a widget release + version pin here. The served runtime
  surface already carries the `inputs/dropdown` and `inputs/radio-list`
  subpaths and no `lib/components` barrel.

### 13. my-orders-tickets: CustomTheme sets no fontFamily
- **Repo**: `fntechgit/my-orders-tickets-widget`, `src/components/CustomTheme.js`.
- **Resolves**: its own MUI `ThemeProvider` sets palette/sizes but no
  `typography.fontFamily`, so MUI text falls back to Roboto — and, being the inner
  provider, it overrides the `WidgetThemeProvider` wrap. Under isolation the widget's
  MUI text doesn't match the event font.
- **Change**: add `typography: { fontFamily: 'var(--font_family)' }` to the
  createTheme (it already reads `--color_background_dark`, so a CSS var fits).
- **Contained (implemented)**: `myTicketsFontPlugin` (web-components
  `scripts/plugins.mjs`, selected via the `quirk:myTicketsFont` token) patches
  the dist's inlined createTheme at load to inject that fontFamily. Delete the patch
  once upstream ships. Sibling of entry 9 (both cosmetic my-orders theme fixes).
- **Status**: contained in the web-component build; the upstream one-liner is the resolution.

### 14. Barrel → subpath imports (MUI + lodash) — 3 PRs
The barrel anti-pattern (importing a library's root pulls the whole library into
a CJS/UMD dist that can't tree-shake) — the same class as entry 12 — traced
across the widgets we bundle and fixed at the source. These shrink the shared
served MUI surface (see [SHARED-MUI-RUNTIME.md](../web-components/SHARED-MUI-RUNTIME.md)) and
the shared runtime:
- **full-schedule** `@mui/base` → `@mui/base/Modal` —
  [PR #59](https://github.com/fntechgit/full-schedule-widget/pull/59) (merged;
  awaiting release + pin).
- **my-orders-tickets** `@mui/material` barrel → per-component subpaths across 52
  files — [PR #110](https://github.com/fntechgit/my-orders-tickets-widget/pull/110)
  (released in 1.0.18, pinned).
- **uicore** (v4.x) `company-input-v2` `@mui/material` subpaths **+**
  `query-actions` whole-`lodash` → `lodash/debounce` —
  [PR #323](https://github.com/OpenStackweb/openstack-uicore-foundation/pull/323)
  (merged). The lodash half alone removes ~30 KB gzip from the shared runtime (whole
  lodash was bundled for a single `debounce`).
- **Until #59 is released**: full-schedule imports the `@mui/base` barrel and
  bundles its own copy of it. The `acceptedMuiMissing` list in
  `analyze-widgets.baseline.json` (`@mui/base`) accepts that barrel so
  `analyze-widgets.mjs --check` passes; drop the entry when the released dist
  lands.
- **Guard**: `analyze-widgets.mjs --check` now flags any bare-root import of a
  subpath-capable lib; the pre-existing ones it surfaced (`react-bootstrap` in
  speakers/live-event/schedule-lite/schedule-full, `lodash` in schedule-filters)
  are baselined in `analyze-widgets.baseline.json` — next barrel-fix candidates,
  and a regression on any *new* barrel fails the check.
- **Contained today**: the `.pnpm` copies / `link:` overlays carry the fixed dists
  until the PRs publish; the widgets consume the published versions after.

### 15. reg-lite (and any widget): host-styled AjaxLoader via the runtime
- **Resolves**: uicore's `AjaxLoader` renders a plain overlay spinner that clashes
  with the host's loaders.
- **Change (contained in the shared runtime, implemented)**: the shared runtime serves
  `src/lib/compat/uicore-ajaxloader` under the
  `openstack-uicore-foundation/lib/components/ajaxloader` specifier, so every widget
  that imports `AjaxLoader` gets it. It renders the host's sign-out overlay markup
  (MUI `Backdrop` + `CircularProgress color="inherit"`), reading both from the
  served MUI chunks so no MUI is duplicated into the uicore chunks.
- **Future**: the spinner is fixed (MUI `CircularProgress`). If a widget ever needs
  a different loader, the shim could take the loader component as a prop/port
  rather than hardcoding it.
- **Status**: contained in the shared runtime; no upstream change needed — this is deliberate
  host styling of a uicore component, not a uicore bug.

### 16. upcoming-events: propTypes disagree with the widget's own store
- **Repo**: `fntechgit/upcoming-events-widget`, `src/reducer.js`,
  `src/components/event-list.js`.
- **Resolves**: two development-only prop-types warnings on every mount.
  `EventList` is connected with `mapStateToProps = (state) => ({ ...state })` and
  declares `summit: PropTypes.object.isRequired`, but the store starts with
  `summit: null` and only fills it in `loadSession` from `componentDidMount`, so
  the first render always fails the check (the component itself guards with
  `summit && firstLoad`). `widgetLoading` is a counter in the reducer
  (`START_WIDGET_LOADING` adds 1, `STOP` subtracts) yet starts as `false` and is
  declared `PropTypes.bool`, so every render after the first load fails too.
- **Change**: `DEFAULT_STATE.widgetLoading = 0`; propTypes `widgetLoading:
  PropTypes.number` and `summit: PropTypes.object` (not required; the store owns
  when it is present). Optionally seed the store from `summitData` in the
  `UpcomingEvents` constructor so `summit` is never null at first render.
- **Safe because**: no behavior change; `AjaxLoader show={widgetLoading}` and the
  `summit &&` guard already treat both values correctly. Warnings are stripped in
  production builds.
- **We delete**: nothing; host is unaffected. Removes the two "Failed prop type"
  entries from the dev console on `/widget-test` and any page with the widget.
- **Status**: not started; needs a widget PR + release.

### 17. react-star-ratings: react declared as a dependency, not a peer
- **Repo**: `ekeric13/react-star-ratings` (third-party; consumed by uicore's
  peer list and bundled into event-feedback).
- **Resolves**: `react-star-ratings@2.3.0` declares `react: 16.14.0` as a
  regular dependency, so a second React lands in any install and node-resolving
  bundler (the web-component `--standalone` variant would inline React 16 next
  to its React 18 — dual React, broken hooks).
- **Change**: upstream, `react` moves to `peerDependencies`. Until then the
  workspace carries a pnpm override forcing `react-star-ratings>react` to the
  web components' React 18 (`pnpm-workspace.yaml` overrides).
- **Safe because**: the library's components run on whatever React renders
  them; it never relied on its own copy.
- **We delete**: the `react-star-ratings>react` override once an upstream
  release lands (or the dep is replaced).
- **Status**: contained by the override; upstream is a third-party repo, so a
  fix there is best-effort (fork/replace if it ever matters beyond standalone).

### 18. reg-lite: react-content-loader v7 requires React 18 (useId) — RESOLVED by the React-18 runtime
- **Repo**: `fntechgit/summit-registration-lite` (dependency choice).
- **Resolves**: a production crash on `/register` right after payment: the
  post-payment skeleton renders, react-content-loader v7 calls
  `React.useId()` (a React 18 API, unguarded since v7 dropped its own uid
  counter), and a React-17 runtime has no `useId` —
  `TypeError: st.useId is not a function`, boundary fallback swallows the
  widget. The order itself is created fine; only the UI dies.
- **Change**: none needed upstream — the web-component runtime runs React
  18.3.1, whose native `useId` satisfies the dep. The runtime's former
  `useId`/`useSyncExternalStore` back-fills are deleted.
- **Status**: resolved by the runtime's React 18.

## Suggested implementation order

Ranked by readiness, blast radius, and the release-batching noted above:

1. **Entry 1** (S) — [PR #58](https://github.com/fntechgit/full-schedule-widget/pull/58)
   open (both cases + regression tests); review/merge → publish 3.1.4 →
   pin. The reducer-only sibling guards are open too —
   [upcoming #23](https://github.com/fntechgit/upcoming-events-widget/pull/23),
   [lite #12](https://github.com/fntechgit/lite-schedule-widget/pull/12) —
   and merging all three clears `widget-safe-profile`'s array-default and
   upcoming's `getKey` (entry 1's shim-removal note).
2. **Entry 7** (S) — two-line contribution to both lines; independent.
3. **Entry 5** (S–M) — reg-lite-only; fixes the confirmed 403 defect;
   the notify-handler contract designed here is reused in step 5.
4. **Entry 6, uicore half** (M) — sync the dispatcher + `RawHTML`-label
   drift to v4.x + main with `originalAnswers` defaulted (summit-admin).
5. **Entries 4 + 6, my-orders half** (M) — one my-orders major release:
   prop-driven tokens, `getIdToken` dropped/prop'd, consume uicore's
   MUI form, adopt the step-3 notify handler; my-orders' direct
   `security/methods` imports leave its footprint.
6. **Entry 2** (M) — `needsLogin` atop the parked branch; Node 16 dist
   rebuild; delete the transition-group neutralization CSS.
7. **Entry 3** (S) — mirror the `needsLogin` pattern; low priority.
8. **Entry 9** (S) — cosmetic CardHeader-title size; independent, contained.
9. **Entry 10** (S) — cosmetic MUI slot-props warnings; independent.
10. **Entry 8** (L) — umbrella, after 1–6.
11. **Entry 14** (S) — the barrel→subpath PRs
    ([#59](https://github.com/fntechgit/full-schedule-widget/pull/59) and
    [#110](https://github.com/fntechgit/my-orders-tickets-widget/pull/110),
    #59 merged awaiting release + pin, #110 released in 1.0.18 and pinned;
    [#323](https://github.com/OpenStackweb/openstack-uicore-foundation/pull/323)
    merged); high value/low risk — merge → publish → pin → drop
    `acceptedMuiMissing`.
12. **Entry 12** (S) — reg-lite RadioList/Dropdown barrel→subpath
    ([#156](https://github.com/fntechgit/summit-registration-lite/pull/156),
    merged, awaiting release + pin); the served-surface barrel drop already landed.
13. **Entry 11** (S–M) — reg-lite Stripe slot (PR #159, changes requested); keeps
    registration as a web component; needs a PR.
14. **Entry 13** (S) — my-orders `CustomTheme` font; retires `quirk:myTicketsFont`
    + `myTicketsFontPlugin`; cosmetic, contained. Batch with #110's my-orders release.
15. **Entry 16** (S) — upcoming-events propTypes vs store (`widgetLoading` counter,
    `summit` nullable at first render); dev-only warnings; needs a widget PR.

## Process per entry

Branch in the upstream repo (target `v4.x`; port to `main` when the code
exists there) → build the dist under that repo's Node version → verify
against a host via `link:` → publish → pin here → delete the
containment code the entry unlocks → update CONSTRAINTS.md + this file.

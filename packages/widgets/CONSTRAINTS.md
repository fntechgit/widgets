# Widget integration — constraints and side effects

> **What this is.** A durable inventory of the choices we made in this codebase because the openstack widget stack forced them. Nothing here is a bug in our code. Every item is a real cost we pay to host these widgets. If you're reading this because you're touching one of these areas and something looks odd, it's likely load-bearing — check here first.
>
> **What this is not.** A refactor plan for our own decisions. Those live in the task list. If a workaround here looks fixable, it isn't — check the "why the widgets force it" column and the "what upstream fix would remove it" column.
>
> **One hosting model, two renderers.** Every widget mounts into a shadow root through its runtime entry — see `RC-U`. The import path picks the renderer: `@openeventkit/widgets/<widget>/react` (the host's React 19, into a `createWidgetShadow`) or `@openeventkit/widgets/<widget>/web-component` (the widget's own React 18 as a self-contained custom element). Both are shadow-DOM, so the trade-offs below apply to both.
>
> **Host paths.** Constraints marked HOST are configuration the host owns, not this repo. Bare `src/…` paths in host-side items (`src/widgets/catalog/<w>/`, `src/widgets/host/…`, `src/lib/…`) are the reference host's, not this repo's.

## Contents

- [Scope](#scope)
- [The widgets in play](#the-widgets-in-play)
- [Root causes and their downstream trade-offs](#root-causes-and-their-downstream-trade-offs)
  - [RC-A — Widgets built for the React 16 / Redux 4 era](#rc-a--widgets-built-for-the-react-16--redux-4-era)
  - [RC-B — Widgets ship pre-webpack-bundled CJS dist files](#rc-b--widgets-ship-pre-webpack-bundled-cjs-dist-files)
  - [RC-C — Widgets ship no TypeScript](#rc-c--widgets-ship-no-typescript)
  - [RC-D — Prop model is Gatsby + Redux-shaped](#rc-d--prop-model-is-gatsby--redux-shaped)
  - [RC-E — Side-effect CSS chain in widget dists](#rc-e--side-effect-css-chain-in-widget-dists)
  - [RC-F — Ambient globals contract](#rc-f--ambient-globals-contract)
  - [RC-G — Legacy dep tree isolation via this package](#rc-g--legacy-dep-tree-isolation-via-this-package)
  - [RC-H — Visual identity mismatch](#rc-h--visual-identity-mismatch)
  - [RC-I — Real-time model mismatch](#rc-i--real-time-model-mismatch)
  - [RC-J — PDF pipeline coupling](#rc-j--pdf-pipeline-coupling)
  - [RC-K — Action dispatch → callback wire per page](#rc-k--action-dispatch--callback-wire-per-page)
  - [RC-L — Marketing key registry shaped by widget consumption](#rc-l--marketing-key-registry-shaped-by-widget-consumption)
  - [RC-M — Hydration flicker on auth-dependent widgets](#rc-m--hydration-flicker-on-auth-dependent-widgets)
  - [RC-N — URL-hash bridging for widget-specific state](#rc-n--url-hash-bridging-for-widget-specific-state)
  - [RC-O — Widget-owned third-party integrations](#rc-o--widget-owned-third-party-integrations)
  - [RC-P — Zero widget-runtime test coverage](#rc-p--zero-widget-runtime-test-coverage)
  - [RC-Q — Widgets bypass our proxies for some data](#rc-q--widgets-bypass-our-proxies-for-some-data)
  - [RC-R — Per-widget helper module](#rc-r--per-widget-helper-module)
  - [RC-S — Ambient module declarations for untyped dists](#rc-s--ambient-module-declarations-for-untyped-dists)
  - [RC-T — Composer defaults masking widget defaults](#rc-t--composer-defaults-masking-widget-defaults)
  - [RC-U — Shadow-DOM widget hosting](#rc-u--shadow-dom-widget-hosting)
  - [RC-V — Legacy widgets run on Next's vendored React 19](#rc-v--legacy-widgets-run-on-nexts-vendored-react-19)
  - [RC-W — Legacy widgets mutate the props we hand them](#rc-w--legacy-widgets-mutate-the-props-we-hand-them)
  - [RC-X — my-orders-tickets-widget owns its token reads through uicore](#rc-x--my-orders-tickets-widget-owns-its-token-reads-through-uicore)
  - [RC-Y — web component hosting bundles its own React (≥17)](#rc-y--web-component-hosting-bundles-its-own-react-17)
- [Meta observations](#meta-observations)
- [Fixes that do not work](#fixes-that-do-not-work)
- [Upstream fixes ordered by blast radius](#upstream-fixes-ordered-by-blast-radius)

---

## Scope

The widgets covered by this document:

| Package | Version | What it does |
|---|---|---|
| `full-schedule-widget` | 3.1.3 | Full agenda view with filters |
| `lite-schedule-widget` | 3.0.3 | Compact schedule (with `yourSchedule=true` for personal) |
| `schedule-filter-widget` | 3.0.8 | Filter panel |
| `upcoming-events-widget` | 3.0.7 | Next-N events preview |
| `live-event-widget` | 4.0.4 | Currently-live event hero |
| `speakers-widget` | 4.0.2 | Speaker grid |
| `event-feedback-widget` | 2.0.1 | Post-session feedback form |
| `my-orders-tickets-widget` | 1.0.18 | Order + ticket management, receipt PDF |
| `summit-registration-lite` | 7.0.10 | Ticket-purchase flow with Stripe |
| `openstack-uicore-foundation` | 4.2.34 | Shared inputs (dropdown, checkbox, text, etc.), Clock context, IDP helpers |

Most are legacy React 16 / Redux 4.x class-heavy code, pre-bundled by webpack years ago, distributed as pre-built `dist` bundles with no TypeScript declarations. Their `dist` peer ranges confirm it: the seven schedule/speaker/feedback widgets and `summit-registration-lite` all peer `react@^16`. The exception is `my-orders-tickets-widget`, built for **React 18** (`react@^18.2`, MUI-based) though still Redux-backed — so "React 16" is the dominant lineage, not a uniform one.

## The widgets in play

Every widget spans two places: its uicore-bound `manifest` + `vendor-styles`
live here at `src/catalog/<name>/`, and its integration glue lives in
the host at `src/widgets/catalog/<name>/` — `index.tsx` (Server Component) fetches data,
`Client.tsx` binds live state via `compose.ts` and renders the widget's runtime
entry, which mounts the dist inside a shadow root via `createWidgetShadow`.
This adds CSS containment, a stable per-widget root for Sentry, and bridges for
shadow-DOM-hostile library behaviors. See `RC-U`.

---

## Root causes and their downstream trade-offs

Each root cause is a fact about the widgets we cannot change from our side. The bullets under it are the concrete costs we pay because of that fact.

### RC-A — Widgets built for the React 16 / Redux 4 era

The widgets and `openstack-uicore-foundation` were written when React 16 was current, before hooks, before React 18's concurrent renderer, before Redux Toolkit. Their internal patterns assume class components, `dispatch`, per-app singleton stores, and older peer-dep ranges.

**Downstream:**

- **A.1 — `findDOMNode` in every uicore input → two mitigations.** `openstack-uicore-foundation` uses `react-select@2.4.4` in its `dropdown`, `radio-list`, `checkbox-list` inputs. `react-select@2.4.4` calls `ReactDOM.findDOMNode`. React 19 removed `findDOMNode`, so every widget that reaches for a uicore input (schedule widgets, extra-questions form, registration form, my-orders-tickets) would crash on the host's React 19. On the `/react` path the `find-dom-node` runtime shim re-attaches an implementation before any widget loads (V.1); on the `/web-component` path the widget runs on the bundled React 18.3.1, which still ships `findDOMNode` (RC-Y).
- **A.2 — Widgets own their Redux store; the host renders none.** Legacy widgets call `useSelector`/`useDispatch` unconditionally, so each that reads from a store mounts its own inner `<Provider>` with its own store before its selectors fire; those that don't, never call `useSelector`/`connect`. The host adds no Provider. Widgets still cannot share state or a store across a page — inherent to the widgets, not to us.
- **A.3 — Legacy peer warnings are accepted, not suppressed.** Install prints the widgets' React-16-era peer complaints (React version mismatches; optional transitive peers like `react-native`, `@react-three/fiber`, `react-onclickoutside` that we never install). pnpm reads `pnpm.peerDependencyRules` only at the installing workspace's root — this repo's root declares none, and so does the reference host's — the warnings are noise by design, and a NEW warning is still signal worth reading.
- **A.5 — `react-final-form@6` + `final-form@4` pinned.** uicore `ExtraQuestionsForm` is built on final-form v4. We inherit the whole v4/v6 API.

**Why the widgets force it.** All of the above trace to one fact: uicore is on `react-select@2.4.4`. Every dropdown/radio/checkbox input in every widget goes through this component, and it uses `findDOMNode`. There is no per-widget workaround.

**What upstream fix would remove it.** uicore replaces `react-select@2.4.4` with a modern release. Removes A.1 (the `findDOMNode` mitigations), and unblocks widgets running natively on React 19. A.2 (per-instance Redux) would still remain — separate cause.

---

### RC-B — Widgets ship pre-webpack-bundled CJS dist files

The widget `dist/index.js` files were bundled with webpack in the ~2020 era as CommonJS. They contain runtime `require('...')` calls for peer packages (`@react-pdf/renderer`), CSS assets (`awesome-bootstrap-checkbox/*.css`, `openstack-uicore-foundation/lib/css/components/*.css`), and internal modules that aren't declared as source-level ES imports.

**Downstream:**

- **B.1 — HOST: `experimental.esmExternals: 'loose'` in the host's `next.config.ts`.** `my-orders-tickets-widget/dist/index.js` contains the literal line `module.exports = require("@react-pdf/renderer")` — the SOLE live consumer (the linked `summit-registration-lite` v7.0.10 does not import @react-pdf; only a vestigial `package.json` dep remains, and building with the flag off surfaces exactly this one error). `@react-pdf/renderer` v4 is ESM-only. Webpack rejects CJS→ESM require. `esmExternals: 'loose'` synthesizes the CJS bridge. Next warns this flag is discouraged; we accept the warning because this is precisely what the flag exists for. Removing it = finishing + publishing the my-orders pdfmake migration.
- **B.2 — HOST: dev must use webpack.** `next dev --webpack` in the host's `package.json`. Turbopack's chunk resolver fails to produce module factories for CSS files inline-required inside vendored dist bundles. Vercel tracks this as PACK-2958 (open since April 2024, currently unresolved). This affects every widget dist because they all inline-require CSS at runtime. The reference host is 100% webpack — both `dev`/`dev:https` and `build` pass `--webpack`; Turbopack is blocked for dev AND build by this inline-CSS-require path (and separately by `esmExternals: 'loose'`, which Turbopack rejects outright).
- **B.3 — No tree-shaking of widget internals.** Dist files are opaque bundles. We pay full bundle-size cost for every widget even if we use one feature.
- **B.4 — Inline CSS side-effect imports inside vendored dist bundles.** uicore CSS, Bootstrap-3 CSS, and widget internal SCSS all get pulled in at module evaluation, whether visible or not.

**Why the widgets force it.** Widgets ship as pre-built bundles for a reason: they were distributed as npm packages before ES modules were standard, and rebundling them for every host bundler wasn't feasible at the time. The mixture of runtime `require` and inline CSS `require` is what webpack of that era produced.

**What upstream fix would remove it.** Widgets are rebuilt from source using modern ES imports (either publishing source with a bundler config or emitting proper ESM). Kills B.1–B.4 in one move.

---

### RC-C — Widgets ship no TypeScript

No `.d.ts` files. No JSDoc types. No documented prop tables.

**Downstream:**

- **C.1 — `src/lib/widget-modules.d.ts` (this package).** Ten ambient `declare module '<widget>/dist' { ... }` blocks — every widget declares its default export as `ComponentType<Record<string, unknown>>`. Loose. Any typo in a prop name silently succeeds at compile time.
- **C.2 — Widget prop interfaces widen with `[key: string]: unknown`.** Where a widget's server-props interface ends with an index signature (registration's `types.ts`), callers can pass undocumented props the widget accepts — TypeScript cannot catch prop-name typos there.
- **C.3 — Widget code never renders server-side.** Widgets access `window` at module scope, so the react-component renderer loads them with `next/dynamic({ ssr: false })` (injected by the host through the renderer factory's `resolveComponent` option) and the web-component path is client-only by nature. Costs us initial HTML for widget content and SEO signal on widget-heavy routes.

**Why the widgets force it.** No published types means every prop shape must be reconstructed from reading widget source. Widgets change internal expectations without notice.

**What upstream fix would remove it.** Widgets ship TypeScript declarations. Realistic only if we own or fork the packages.

---

### RC-D — Prop model is Gatsby + Redux-shaped

Widget prop shapes assume the host is Gatsby with Redux. Data is passed as whole state slices; user action feedback is via string-typed action dispatch; auth is passed as an ambient callback.

**Downstream:**

- **D.1 — `events`, `allEvents`, `filters`, `view` as bulk Redux-slice-shaped props.** Widgets take the whole events array and any current filter/view state. No incremental data, no callback shape. If we need to render `/a/schedule`, we fetch all events server-side.
- **D.2 — `onEventClick(event)` — full event object callback.** Widgets pass the entire event object, not an id. Handlers must destructure `event.id`. If the widget ever passes something other than an event, no TypeScript help.
- **D.3 — `triggerAction(action, payload)` — string-typed action dispatch.** Widget emits action strings (`"ADDED_TO_SCHEDULE"`, `"RSVP_CONFIRMED"`, `"UPDATE_FILTER"`, etc.). Client `switch (action)` over string constants. Silent no-op for actions we chose not to handle (`RSVP_*` because we cut RSVP).
- **D.4 — Auth/order lifecycle as async callback props.** `getAccessToken`, `getUserProfile`, `updateProfile`, `onPurchaseComplete`, `onTicketAssigned`, `authErrorCallback`, `authUser`, `getPasswordlessCode`, `loginWithCode`, `goToEvent`, `goToMyOrders`, `goToExtraQuestions`. Each is a hand-wired hook we pass at every widget instantiation.

**Why the widgets force it.** The widgets were designed for a Redux-connected host that dispatches actions and reads state via `mapStateToProps`. To function without that, they expose a prop-shaped API that mirrors the Redux contract.

**What upstream fix would remove it.** Widgets adopt narrower props (id-shaped callbacks, subscribed events via context, ambient theming). Not achievable at our level.

---

### RC-E — Side-effect CSS chain in widget dists

Widget `dist/index.js` files inline-require CSS. `openstack-uicore-foundation/lib/components/extra-questions.js` imports `awesome-bootstrap-checkbox/awesome-bootstrap-checkbox.css` unconditionally. uicore `dropdown.js` (and other inputs) inline-require their own component CSS.

**Downstream:**

- **E.1 — `awesome-bootstrap-checkbox` global CSS gets loaded** any time a widget rendering uses uicore extra-questions. Legacy Bootstrap-3 CSS bleeds into our page. *Largely neutralized by the shadow-DOM modules:* widget markup lives inside a shadow root, so head-injected legacy rules match nothing in the light DOM — the bytes still ship, the visual bleed is gone.
- **E.2 — uicore CSS chain (`circle-button.css`, etc.) inline-required from widget dists.** Every schedule widget pulls the button styling; if unused visually it still ships. *Inverted by the shadow-DOM modules:* head-injected CSS can't reach into a shadow root, so each side-effect stylesheet a widget actually needs (pure-react-carousel layout, uicore circle-button) is generated as a typed vendor-css module by the package's `scripts/generate-assets.mjs` and listed in that module's `sheets` — see each module's `vendor-styles.ts`.
- **E.3 — `@openeventkit/widgets` is subpath-only.** The package has no root export — anything uicore-heavy (a widget manifest, `uicore-host`, the compat modules) sitting on a shared barrel would compile the entire uicore chain into every widget-touching page. Consumers import each surface via its own subpath (`./extra-questions/manifest`, `./uicore-host`, `./compat/*`), and the `./mount` barrel deliberately excludes `configureWidgetHost` (exported as `./host`) for the same reason — it pulls uicore. A widget's uicore-bound `manifest` is exported via its own subpath (`@openeventkit/widgets/registration/manifest`, etc.); the widget's Server Component + integration glue live in the host (`src/widgets/catalog/<widget>/`), not here. The per-widget runtime entries follow the same discipline: `./<widget>/web-component` is manifest-free by construction (the widget's own bundle owns the manifest — guarded by `src/__tests__/web-component-entries.test.ts`), while `./<widget>/react` deliberately pulls the manifest graph, so a consumer ships that graph only by importing it.

**Why the widgets force it.** The dist bundles literally contain `require('.css')` calls at the JS level. There's no way to intercept this without rebundling the widget.

**What upstream fix would remove it.** Widgets defer CSS loading until component render (dynamic CSS import) OR emit a separate CSS file that consumers import explicitly.

---

### RC-F — Ambient globals contract

Widgets read state from process-level globals: `window.*`, `document.cookie`, `localStorage`, `moment.tz.*`. Nothing is passed through props; they just read.

**Downstream:**

- **F.1 — uicore config through `setConfig`.** uicore reads its settings through the getters in `lib/utils/config` (`buildAPIBaseUrl`, `getTimeServiceUrl`, `getOAuth2IDPBaseUrl`, `getOAuth2ClientId`, ...). Each getter returns the value set through `setConfig` and falls back to a `window.*` global (`window.API_BASE_URL`, `window.TIMEINTERVALSINCE1970_API_URL`, `window.IDP_BASE_URL`, `window.OAUTH2_CLIENT_ID`) when nothing is set. The host sets nothing on `window`. The host's single `configureWidgetHost` call (`./host`) fills the `HostConfig` port with its proxy base, IDP base URL, OAuth2 client id and time-service URL, and then calls `configureUicore()` (`src/lib/uicore-host.ts`), which passes them to `setConfig` as `apiBaseUrl`, `idpBaseUrl`, `oauth2ClientId`, `timeApiUrl`. The call runs at module eval (the host imports it for its side effect), before any uicore read. The web-component runtime does the same on its own uicore copy (RC-X).
- **F.2 — uicore `ClockProvider` mounted in the host chrome.** Widgets that depend on time state (schedule, live events) internally consume the uicore Clock, so the host mounts their expected context in its chrome — importing `ClockProvider` from uicore's `lib/components/clock-context` directly (the clock is a host concern; this package ships no clock surface). The clock reads the time-service URL through F.1.
- **F.3 — uicore's own token lifecycle is bypassed by the resolver.** uicore's default `getAccessToken()` reads a localStorage `authInfo` record (`{ accessToken, expiresIn, accessTokenUpdatedAt, refreshToken, idToken }`) and refreshes client-side against the IDP; on a failed refresh it wipes the record. The host keeps the token in the encrypted JWE cookie (`__session`) server-side and never writes tokens to localStorage (`AuthContext` removes any leftover `authInfo` on mount). `configureUicore()` calls `setAccessTokenResolver`, and uicore's `getAccessToken()` returns the resolver's answer before touching localStorage, so the refresh path never runs. The resolver returns the `SESSION_PRESENT` placeholder while `HostAuth.isSignedIn()` is true (or the port is not filled) and throws only when the host is certain there is no session. Every uicore caller is covered, `query-actions` included, so the widgets that ride the ambient path (`full-schedule`, `lite-schedule`, `upcoming-events`, `live-event`, `speakers`, `schedule-filter`, plus internal thunks in the prop-driven widgets) all reach the host session. Details in RC-X.
- **F.4 — URL-fragment reads.** uicore Clock reads `window.location.hash` for `#now=YYYY-MM-DD,hh:mm:ss` at module load — an undocumented time-jump backdoor. Widget prop values sometimes come from URL hash reads that we bridge (see RC-N).
- **F.5 — uicore auth flows through `setAuthHandlers`.** uicore's default `initLogOut` redirects to `${idpBaseUrl}/oauth2/end-session?client_id=${oauth2ClientId}&...` with the localStorage `idToken`, and its `utils/actions` `authErrorHandler` runs `doLogin` on 401 and hands `initLogOut` to the notify callback on 403. `configureUicore()` calls `setAuthHandlers({ initLogOut, authErrorHandler })`: `initLogOut` delegates to `HostAuth.logout` (the host's `initiateLogout`), and the 401/403 handler raises the `widget-auth-error` event for `<WidgetAuthErrorDialog>`. Any widget that surfaces a "log out" or account-menu action, and every 401/403 from a widget request, lands on the host's flows.
- **F.6 — config keys uicore reads that the host does not set.** `lib/utils/config` also serves `oauth2Flow`, `oauth2UseRefreshToken`, `scopes`, `allowedUserGroups` and `exclusiveSections`, falling back to `window.OAUTH2_FLOW`, `window.OAUTH2_USE_REFRESH_TOKEN`, `window.SCOPES`, `window.ALLOWED_USER_GROUPS`, `window.EXCLUSIVE_SECTIONS`. `HostConfig` carries none of them, so they read as undefined (or uicore's built-in default). The flow / refresh / scopes keys feed uicore's own login and refresh paths, which F.3 and F.5 bypass. If a widget path ever needs one of the others, the route is the same as F.1: add the key to `HostConfig` and to the `setConfig` call in `configureUicore()`, never a `window.*` write.

**Why the widgets force it.** Ambient config is the API contract these widgets exposed to hosts: they read uicore's config and token state, nothing comes through props. uicore's setters let the host supply that state without `window.*` globals or localStorage; the widgets still read it ambiently.

**What upstream fix would remove it.** F.1, F.3 and F.5 rest on uicore's `setConfig` / `setAccessTokenResolver` / `setAuthHandlers` setters (release status in UPSTREAM.md entries 4 and 5). F.2 goes when uicore accepts the clock URL via prop or context. F.6 stays as long as uicore keeps `window.*` fallbacks.

---

### RC-G — Legacy dep tree isolation via this package

The widget dep tree includes react-16-era peers (redux, react-redux 7, redux-thunk, redux-persist, moment, moment-timezone, lodash, i18n-react, crypto-js, spark-md5, sweetalert2, awesome-bootstrap-checkbox, final-form, react-final-form, idtoken-verifier). If these were dependencies of a host, host code could inadvertently reach for them and inherit legacy patterns.

**Downstream:**

- **G.1 — `@openeventkit/widgets` is a dedicated package.** Widget deps live here, isolated from any host. A host depends on `@openeventkit/widgets` (plus the `@openeventkit/web-components` build tool) but not directly on any widget's legacy peer.
- **G.2 — HOST: domain types live in the host (`src/types/` in the reference host).** The widget composers' interfaces need shared types (`Summit`, `SummitEvent`, `UserProfile`, etc.); the composers are host modules, so the host's `src/types/` is their home. This package needs none of them — its manifests type widget dists loosely (C.1) and everything host-shaped crosses through the core ports.
- **G.3 — This package carries the entire legacy dep tree** (~15 packages that would otherwise pollute a host).
- **G.4 — HOST: `transpilePackages: ['@openeventkit/widgets']` in the host's `next.config.ts`.** The package ships raw TypeScript source (no build step); hosts transpile it, and Next needs the transpile hint to do so.

**Why the widgets force it.** The dep tree is truly legacy; keeping it out of a host's `package.json` prevents accidental inheritance and leaves the host a modern peer surface.

**What upstream fix would remove it.** Widgets ship with modern, minimal peer deps (no bundled Redux, no moment-timezone, etc.). Then G.1 and G.2 become optional.

---

### RC-H — Visual identity mismatch

Widgets ship their own Bootstrap-3-ish CSS at module load. Users see mixed MUI + Bootstrap-3 styling on any widget-hosting page.

**Downstream:**

- **H.1 — Legacy CSS is contained by the shadow root.** Widget-shipped styles would otherwise apply page-wide at document scope. Mounting every widget inside a shadow root (RC-U) contains widget CSS to that root — only the vendor CSS we deliberately adopt reaches inside, and nothing leaks outward.
- **H.2 — Theming widget internals: colors and font reach them via CSS vars; spacing/type-scale don't.** MUI's theme *object* can't cross into a widget's own React/MUI instance (they're isolated) — but CSS custom properties can, and that's the whole theming path. **Colors**: design tokens are published as `--color_*` on `:root` (`theme/color-css-vars`, SSR'd + `CSSVariableBridge`) and inherit across the shadow boundary (RC-U.7), so widget CSS's `var(--color_*)` resolves with no per-widget wiring. **Font**: `--font_family` is published the same way, and each widget's own MUI is given a theme whose `typography.fontFamily` reads it — a port of the reference site's `theme.js`. Two mechanisms, by widget shape: a widget-side `WidgetThemeProvider` (`src/lib/context/WidgetThemeProvider.tsx`) via the manifest `wrapTree`, for widgets with no theme of their own (e.g. registration); and a build-time patch (`myTicketsFontPlugin`, wc build) for widgets that ship their own `ThemeProvider` (e.g. my-orders `CustomTheme`) — its inner theme wins, so it must set the font itself (UPSTREAM entries 10, 13). This depends on the widget bundle running a coherent MUI — the wc build serves MUI as shared MUI-5 runtime chunks (RC-Y.2; the widget bundles import the served `@mui/*`/`@emotion/*` surface through the import map rather than each carrying their own — UPSTREAM 10). **Spacing / type-scale still don't inherit** — they'd need the same var-backed treatment if a mismatch ever matters. Widgets take no color prop; colors reach them only through `:root` inheritance.

**Why the widgets force it.** Widget CSS is packaged in their dist bundles as side-effect imports. Our theme has no path in.

**What upstream fix would remove it.** Widgets expose a theming API (accept theme object as prop or via context). Or widgets stop shipping their own CSS.

---

### RC-I — Real-time model mismatch

Our real-time updates flow through `RealTimeContext` — a client-side subscription to Ably/Supabase that patches events, speakers, occupancy, etc. Widgets consume events via props but gate their re-derivation behind a sidecar `lastDataSync` counter.

**Downstream:**

- **I.1 — Widgets render fresh props on every parent re-render, but internal re-derivation is gated behind `lastDataSync`.** `full-schedule`, `lite-schedule`, `upcoming-events`, `live-event`, and `speakers` destructure `lastDataSync` in `componentDidUpdate` and diff it against `prevProps.lastDataSync`. When it changes, they recompute derived display state (grouped-by-day, filtered subset). If the parent passes a fresh `events` array reference without also bumping `lastDataSync`, `render()` sees the new data but the widget's derived state stays stale.
- **I.2 — `lastDataSync` is a redundant sidecar prop.** Reference identity of `events` is already the React-idiomatic change signal (`useMemo(() => derive(events), [events])`). The counter exists because the widgets came from a Redux era where in-place store mutation broke reference identity, so a monotonic tick was invented to compensate. That tick leaked into the public props contract. Any consumer — even a purely static host — must synthesize or source a `lastDataSync` value or the widget appears frozen. Passing a filtered subset requires also bumping the counter. Our provider exposes `lastSyncAt` for exactly this and we thread it alongside `events` to every schedule/speaker/live widget instance.
- **I.3 — Widgets do their own polling internally** (uicore Clock ticks 1Hz, some widgets refetch on visibility change). Two parallel real-time signals coexist.

**Why the widgets force it.** Widget internal derived state (grouped-by-day, filtered subsets) is gated on `lastDataSync` in class-based `componentDidUpdate` blocks. Without bumping the sidecar counter, the widget won't recompute regardless of what `events` looks like.

**What upstream fix would remove it.** Widgets derive from `props.events` via `useMemo` / `getDerivedStateFromProps` and drop the `lastDataSync` prop entirely — reference identity IS the signal. Or widgets subscribe to a passed-in observable so hosts don't have to keep tick counters in sync with data pushes.

---

### RC-J — PDF pipeline coupling

The `my-orders-tickets-widget` renders receipts using `@react-pdf/renderer`. Receipt layout and font rendering are inside the widget bundle.

**Downstream:**

- **J.1 — HOST: Nunito Sans TTF vendored in the host's `public/fonts/nunito-sans/NunitoSans-Variable.ttf`.** `@react-pdf/renderer` needs a URL for `Font.register()`, so the host serves the TTF itself.
- **J.2 — Receipt PDF layout is inside the widget.** Un-restylable beyond `receiptSettings` (organizer info, colors, logo, font family).

**Why the widgets force it.** Receipt rendering is embedded in the widget code path; the widget bundles `@react-pdf/renderer` and the layout template. We only supply configuration.

**What upstream fix would remove it.** Receipt rendering moves out of the widget (widget emits an event, host generates PDF). Or widget exposes a template-slot API.

---

### RC-K — Action dispatch → callback wire per page

Every Gatsby Redux action the widget expects becomes a hand-ported async function that we pass as a prop at the widget instantiation.

**Downstream (concrete callbacks passed per page):**

- **K.1 — `triggerAction` switch statements.** Schedule pages hand-write `switch (action) { case 'ADDED_TO_SCHEDULE': ... case 'REMOVED_FROM_SCHEDULE': ... }`. Silent no-op for actions we don't handle.
- **K.2 — `onPurchaseComplete` chain in the registration widget module.** Widget's completion callback triggers `checkOrderData → refreshProfile`. Order matters; `checkOrderData` failure is swallowed with Sentry capture so the profile refresh still runs.
- **K.3 — `onTicketAssigned → refreshProfile()`.** Widget signals a single ticket transfer; our response is a full profile refresh (we don't have granular ticket state).
- **K.4 — Every OTP/OAuth step exposed as widget prop.** `getPasswordlessCode`, `loginWithCode`, `authUser`, `authErrorCallback` — bridged to `src/lib/auth/passwordless.ts` + `useAuth`.
- **K.5 — `trackEvent` analytics callback (mandatory, not optional).** The registration widget calls `trackEvent(name, params)` **unconditionally** on ticket-change, add-to-cart, begin-checkout, and purchase-complete (GA4 ecommerce events `view_item` / `add_to_cart` / `begin_checkout` / `purchase_complete`). If the prop is absent the widget throws `TypeError: trackEvent is not a function` mid-flow — selecting a ticket crashes the form. Wired in `useRegistrationCallbacks` to `trackEvent` from `src/lib/analytics/gtm.ts`, which pushes a gtag event tuple to the dataLayer **after scrubbing PII** (`first_name`, `last_name`, `email`, `owner_*`, `qr_code`) — the ecommerce params carry buyer identity that must never reach GTM. Same callback + PII-scrub applies to every other widget that fires analytics (orders/my-tickets) in later rounds.

- **K.6 — `triggerAction` must RESOLVE to the value the widget re-dispatches.** The schedule widgets don't fire-and-forget: they `await triggerAction` and re-dispatch into their OWN store with its **resolved value** — `triggerAction('ADDED_TO_SCHEDULE', { event }).then((event) => dispatch(createAction(ADDED_TO_SCHEDULE)({ event })))`. The `.then` parameter **shadows** the original `event`, so the reducer reads `.id` off *whatever we resolve to*. A handler that resolves `void` makes the widget dispatch `{ event: undefined }` and crash at `event.id` on every add/remove click while signed in — so the handlers `await` the write and `return payload.event` (`src/widgets/shared/schedule-callbacks.ts` `useScheduleWriteCallbacks`, shared by the schedule widgets, and `upcoming-events/compose.ts`). **The same latent contract exists for `RSVP_CONFIRMED` / `RSVP_CANCELLED`** (full-schedule's `.then(rsvp =>)` / `.then(event =>)`) — dormant only because RSVP is cut; re-enabling it without echoing the resolved value back would crash identically. A `triggerAction` case that returns the wrong resolved type is a silent crash-in-waiting, not a no-op.

**Why the widgets force it.** Widgets take a hand-shaped callback for every action. No batch or convention.

**What upstream fix would remove it.** Widgets emit typed events (union type) and hosts subscribe once. Or widgets expect a single `dispatch` and act on it internally.

---

### RC-L — Marketing key registry shaped by widget consumption

The host's `src/lib/api/shared/marketing.ts` registry catalogs ~35 marketing settings. Roughly 65% exist purely because a widget prop reads them.

**Downstream:**

- **L.1 — 12 `regLite*` keys** (copy overrides for order-complete text, toggles for company input, promo code allow-flag, etc.) — pure widget prop pass-through. Consumer of these keys is the registration widget module alone.
- **L.2 — 9 certificate keys** for future certificate section on `/a/profile` — widget-driven schema even though the section is deferred.
- **L.3 — Marketing content model is Gatsby-widget-shaped.** Editors set values through the marketing admin knowing they map to widget behavior.

**Why the widgets force it.** Widgets read specific string-keyed marketing settings by convention. Renaming or restructuring breaks widget renders.

**What upstream fix would remove it.** Widgets accept typed config objects as props instead of reading marketing settings by key. Removes the direct coupling; marketing values flow through the same channel as everything else.

---

### RC-M — Hydration flicker on auth-dependent widgets

Widgets expect `profileData` / `user` / `ownedTickets` at first render. Our auth is async client-side: JWE cookie decrypted server-side; IDP profile fetched client-side.

**Downstream:**

- **M.1 — Widget renders once with `null` profile, then re-renders with real profile.** User sees the widget flash empty then populate.
- **M.2 — Bridged `loading` prop on the registration widget** from `isLoggedIn && !idpProfile` — partial mitigation but doesn't fully hide the transition.

**Why the widgets force it.** Widget contract is "give me props at mount." Async subscription isn't in the API.

**What upstream fix would remove it.** Widgets accept a `Suspense`-friendly promise, or a subscription/observer for auth state. Neither exists.

---

### RC-N — URL-hash bridging for widget-specific state

Widgets read `window.location.hash` directly for state that "just needs to be there" — attendee id, prefill email, time overrides.

**Downstream:**

- **N.1 — Registration widget module** parses `#email=...` on mount and passes to `loginInitialEmailInputValue`. Multi-attendee purchase links carry this fragment.
- **N.2 — Extra-questions page** parses `#attendee=<id>` on mount to resolve which attendee's form to load. The widget doesn't accept a param path.
- **N.3 — uicore Clock reads `#now=YYYY-MM-DD,hh:mm:ss`** at module load — undocumented time-jump backdoor for anyone with URL access in dev.

**Why the widgets force it.** URL hash is a widget-defined side channel. No prop equivalent exists.

**What upstream fix would remove it.** Widgets take the values as explicit props.

---

### RC-O — Widget-owned third-party integrations

Widgets bundle their own third-party integrations. We can't influence them beyond configuration knobs the widget exposes.

**Downstream:**

- **O.1 — Stripe embedded in `summit-registration-lite`.** Card entry, tokenization, redirect flow — all inside the widget. We pass `providerOptions.style.base.fontFamily` and `hidePostalCode`; that's the extent of influence. Switching payment providers means replacing the whole registration widget.
- **O.2 — `@react-pdf/renderer` embedded in receipt widget.** Same shape as O.1 — bundled inside, un-swappable.
- **O.3 — uicore has its own internal `useMarketingSettings`.** Widgets sometimes read marketing settings via their own hook, not through props we pass. Parallel config path.

**Why the widgets force it.** Widget authors chose these integrations at package boundary time.

**What upstream fix would remove it.** Widgets externalize integrations (Stripe becomes injectable, PDF renderer swappable, marketing-settings source configurable).

---

### RC-P — Zero widget-runtime test coverage

Unit tests exist for pure derivation logic (widget-module `derive.ts`). No test mounts a widget. Widgets are excluded from vitest because setting up their runtime env would need Redux store, DOM globals, moment-timezone, mocked summit-api, mocked auth, and more.

**Downstream:**

- **P.1 — Widget wire regressions only appear at runtime in the browser.**
- **P.2 — Green CI plus broken widget pages is a plausible state.**

**Why the widgets force it.** Widget test harnesses would need to model most of a Gatsby app to be meaningful.

**What upstream fix would remove it.** Widgets ship test harnesses / stories. Or widgets have narrow-enough API that host-side integration tests are sufficient. Neither today.

---

### RC-Q — Widgets bypass our proxies for some data

We built `/api/user/*` proxies to handle Origin allowlist for the summit API and to attach the session-cookie token server-side. Widgets ignore these proxies for parts of their flow.

**Downstream:**

- **Q.1 — Widgets fetch summit-api directly** for order polling (registration), event tokens (feedback), streaming info (some widgets). These calls go through the widget's own HTTP layer with our access token — they don't hit our proxies. So they don't get our cache tags, structured error logging, or observability.
- **Q.2 — Split observability.** Some events surface in our proxy logs; others only in the widget's `console.log`.

**Why the widgets force it.** Widgets own their HTTP layer.

**What upstream fix would remove it.** Widgets accept an injectable HTTP client (fetch-shaped) that we can supply to route calls through our proxies.

---

### RC-R — Per-widget helper module

The host renders no react-redux `<Provider>` around a widget. A scan of every widget's dist shows the four without a Provider (`speakers`, `live-event`, `event-feedback`, `schedule-filter`) don't call `useSelector` / `useDispatch` / `connect` at all, and the five that use Redux (`full-schedule`, `lite-schedule`, `upcoming-events`, `summit-registration-lite`, `my-orders-tickets-widget`) each mount their OWN inner `<Provider>` with their own `createStore` / `configureStore` before any of their selectors fire.

Shadow-DOM widget modules drop the outer Provider entirely — the reactComponent renderer wraps the widget in `<Sentry.ErrorBoundary>` and portals it into a `createWidgetShadow`, with no react-redux wrapper. If a future widget update ever introduces an entry-level `useSelector` (before its inner Provider mounts), the fix is to add the wrapper back — cheap.

**Why the widgets force it.** Every legacy widget calls `useSelector`/`useDispatch` unconditionally but mounts its own `<Provider>` before its selectors fire (RC-A.2), so the host needs none. If a future widget ever calls `useSelector` at entry level before its Provider mounts, add a host wrapper back — cheap.

**What upstream fix would remove it.** Widgets stop requiring a Redux store at all. Not needed for our workaround stance, but would tighten each widget's runtime.

---

### RC-S — Ambient module declarations for untyped dists

This package's `src/lib/widget-modules.d.ts` declares every widget dist and referenced uicore component as a loosely-typed module (`ComponentType<Record<string, unknown>>` and friends) — TypeScript refuses to import an undeclared untyped module.

**Why the widgets force it.** The dists ship no TypeScript declarations.

**What upstream fix would remove it.** Widgets ship TypeScript declarations (RC-C). Widget CSS needs no declarations: vendor CSS enters as generated typed modules (`src/lib/vendor-css/`), never as CSS imports.

---

### RC-T — Composer defaults masking widget defaults

Several of the host's widget modules set default values for widget props (in their `derive.ts` / `index.tsx`) (`withThumbs = false`, `showSendEmail = false`, `title = ''`, `showAllEvents = true`, `eventCount = 10`, `showNav = true`) before spreading the rest of props. Chosen empirically — we didn't know the widget's own default, so we set one.

**Why the widgets force it.** Widgets fail loudly or silently misbehave on `undefined` for some props, but their internal defaults aren't documented.

**What upstream fix would remove it.** Widgets ship documented defaults + accept `undefined` cleanly.

---

### RC-U — Shadow-DOM widget hosting

Widget modules under this package's `src/catalog/<name>/` mount their widget inside an open shadow root via `createWidgetShadow`. The containment gain — widget CSS scoped, per-widget root for Sentry + Redux, ambient host-app styles kept out — comes at the cost of a specific set of shadow-DOM/legacy-widget mismatches that we work around in `createWidgetShadow` (`src/core/widget-shadow.ts`) and `src/lib/bridges/`.

**Downstream:**

- **U.2 — `@font-face` inside shadow doesn't register in `document.fonts`.** Neither `adoptedStyleSheets` nor `<link>` inside a shadow root contribute font faces to the document's font set. Widget CSS that references `font-family: FontAwesome` from inside shadow renders tofu glyphs even after the font file has loaded. Workaround: the vendor-css generator (`scripts/generate-assets.mjs`) pre-splits each sheet's `@font-face` blocks into its `fontFaces` field; `createWidgetShadow` (`src/core/widget-shadow.ts`) injects them as a `<style data-widget-fonts-from="…">` into `document.head`, once per sheet id.

- **U.3 — Adopted vendor CSS needs absolute `url()` references.** `adoptedStyleSheets` created via `new CSSStyleSheet()` have no base URL, so relative `url('../fonts/…')` references would resolve against the document URL — fonts 404. The generator resolves every relative url() against a virtual `/widget-css/<name>.css` base — the same layout the `assets/` binaries ship under — and emits it `__WIDGET_ASSETS__`-prefixed, so adopted sheets resolve their assets no matter where the host serves them from. `@font-face` is additionally split out and injected into `document.head` (adopted sheets silently ignore it; registration is document-global anyway). Hand-authored CSS (react-tooltip, our button shim) stays in `styles` (adopted, no url()s).

- **U.4 — `scripts/generate-assets.mjs` (this package's own script, run via its `assets` npm script).** Vendor CSS is generated as typed TS modules under `src/lib/vendor-css/` (`export const sheet: VendorSheet`) — imports are type-checked (a wrong name fails the build instead of 404ing), the CSS ships fingerprinted inside widget chunks, and dependency bumps flow through on the next generation instead of drifting. Font/image binaries land in this package's `assets/` (committed); url() references carry the `__WIDGET_ASSETS__` placeholder that `createWidgetShadow` substitutes with `HostConfig.assetBaseUrl` (empty = site root). Regeneration runs only here (`pnpm assets`); the host's `copy:widget-assets` only copies the committed `assets/` into its `public/`. Outputs are checked into git so fresh clones don't need to run the script before typecheck. A `?raw` webpack bypass was spiked and rejected: Next's CSS pipeline captures the import before a `resourceQuery` rule can, and the processed module — not source text — comes back.

- **U.4.1 — The widget's documented CSS-dependency list is incomplete; the full set is discovered by broken UI.** `summit-registration-lite/README.md` lists only Bootstrap 3 + Font Awesome 4 as "required external stylesheets", but the widget also renders `.abc-radio` / `.abc-checkbox` markup that needs `awesome-bootstrap-checkbox` CSS (the "Ticket is for" radios + consent checkboxes render as unstyled native controls without it). It's a `devDependency` of the widget, not called out as a runtime style requirement. We found it by hitting the broken radios, not by reading docs. Expect the same for other widgets in later rounds — when a control renders as a bare native element, grep the widget's rendered class names for a `*-bootstrap-*` / vendor prefix and link that package's CSS. `awesome-bootstrap-checkbox@2.x` (which we resolve) targets the Bootstrap-4 `.form-check` structure the widget emits, even though Gatsby loaded `1.0.2` from a CDN.

- **U.5 — Bridge slot for libraries that assume document-scope APIs.** `manifest.bridges` is an array of `(shadowRoot) => cleanup?` functions the reactComponent renderer invokes at shadow attach. Concretely: `src/lib/bridges/tooltip.ts` reattaches react-tooltip@3 hover handlers because the library scans `document.querySelectorAll('[data-tip]')` at init and misses shadow-scoped triggers. Click-outside patterns are handled concretely by U.5.1; further bridges expected for MUI Popover portals and other libraries with the same class of gap.

- **U.5.1 — Document-level "click-outside" handlers read a retargeted `event.target` inside shadow (`clickOutsideRetargetBridge`).** Widgets that close a popover with `document.addEventListener('click', e => !ref.current.contains(e.target) && close())` break inside shadow. A click that originates in the shadow tree is **retargeted to the shadow host** once it crosses the boundary, so at `document` `event.target` is the host — an *ancestor* of the popover ref, never a descendant — and `ref.current.contains(event.target)` is always `false`. The handler decides every click is "outside" and closes the popover the instant the toggle opens it: the my-orders **Filter** and **Sort** dropdowns (`my-orders-tickets-widget/src/components/Filters/{Filter,Sort}.js`) open then vanish in the same click, reading as dead buttons. We can't touch the widget's listener, so `src/lib/bridges/click-outside-retarget.ts` fixes the event it reads: a **capture-phase** document listener (runs before the widget's bubble-phase one) rewrites `event.target` via `Object.defineProperty` to the real in-shadow element from `composedPath()[0]`, but only for events that were retargeted to *this* widget's host. The widget's unchanged `contains(event.target)` then sees the true element and its click-outside logic works. Declared as `manifest.bridges = [emotionMirrorBridge, clickOutsideRetargetBridge]`. Cost: three capture-phase document listeners (`pointerdown`/`mousedown`/`click`) per shadow root, each a fast no-op for events that didn't cross its boundary. Same class as U.6.1 (host↔shadow bridging); Gatsby had no shadow root, so `event.target` was the real element and these handlers worked as written.

- **U.6 — Emotion `CacheProvider` per shadow (emotion 11 / MUI).** MUI (used inside `summit-registration-lite`'s Company Autocomplete) injects CSS via emotion 11 into `document.head` by default. Widgets rendering inside shadow can't see head styles. `src/lib/context/EmotionShadowProvider.tsx` creates an emotion cache with `container: shadowRoot`, WeakMap-cached per root. Widgets using MUI wrap their subtree via `manifest.wrapTree = (c) => <EmotionShadowProvider>...</EmotionShadowProvider>`.

- **U.6.1 — Emotion mirror bridge (emotion 9 / react-select, and split emotion-11 instances).** uicore's form controls use `react-select@2.4.4`, which styles itself with **emotion 9** — a global singleton that appends `<style data-emotion>` to `document.head`. emotion 9 predates the `container` API, so the `CacheProvider` approach in U.6 can't redirect it. The same bridge also covers a second failure mode: **pnpm peer-graph instance splitting on emotion 11**. A widget whose peer set hashes differently (e.g. my-tickets resolving `@emotion/react@11.14.0(@types/react@19.2.15)` while the host uses `(@types/react@18.3.31)`) gets its *own* emotion singleton — our `CacheProvider` context is invisible to it, and its MUI styles land in `document.head` exactly like emotion 9. Diagnostic: shadow renders MUI markup (`css-*-Mui*` classes) but `style[data-emotion]` tags exist only in head. Fix: `bridges: [emotionMirrorBridge]` instead of (not in addition to) the `EmotionShadowProvider` wrap. Every uicore-react-select control (schedule day-picker, registration company field, extra-questions inputs, MOT filters) would otherwise render unstyled inside shadow. `src/lib/bridges/emotion-mirror.ts` mirrors every `[data-emotion]` tag's rules from `document.head` into a `<style>` at the top of the shadow root and keeps it synced via a MutationObserver — the emotion analog of the U.2 font-face extraction. Safe because emotion class names are content-hashed and globally unique, so the shadow copy can't collide. Declared as `manifest.bridges = [emotionMirrorBridge]`. Cost: mirroring ~38KB of head emotion CSS into each such widget's shadow (unused hashed selectors are harmless) plus a per-widget head observer.

- **U.7 — Widget colors come from `:root`, not per-widget vars.** Widget CSS uses `var(--color_*)` extensively. CSS custom properties inherit *across* the shadow boundary (verified: setting a `--color_*` on `:root` repaints inside a widget shadow), so the design tokens published on `:root` (`theme/color-css-vars`, SSR'd in the root layout + re-applied by `CSSVariableBridge`) reach widget CSS directly — no per-widget color mechanism. `createWidgetShadow` takes no per-widget color input; the only host-level style it sets is `display: block` on custom-element hosts (unregistered custom elements default to `display: inline`, which would collapse widget layout).

- **U.8 — Custom-element host tags need explicit `display: block`.** `<schedule-full>` and similar custom elements default to `display: inline`. When a manifest's `elementTag` is a custom-element name (contains `-`), `createWidgetShadow` auto-injects `display: block` into the `:host` rule so widget layout doesn't collapse.

- **U.9 — Shadow attach uses `useLayoutEffect`.** Attaching in `useEffect` leaves a paint frame where the host `<div>` is visible with no shadow content. `useLayoutEffect` attaches synchronously after DOM commit. Falls back to `useEffect` on the SSR pass to silence Next's warning.

**Why the widgets force it.** The widgets' library dependencies (react-tooltip, emotion-via-MUI) were written for document scope; the widgets' own CSS references CSS custom properties by convention (`var(--color_*)`); the widget dist bundles reference vendor font files by relative URL. Each U.2–U.8 workaround exists because a specific web-platform boundary breaks one of those assumptions when the widget lives inside shadow.

**What upstream fix would remove it.** Widgets rebuild against shadow-DOM-aware assumptions: don't rely on document-scope event delegation (RC-U.5), don't inject CSS into `document.head` at runtime (RC-U.6), don't declare `@font-face` inside their CSS or accept it as a limitation (RC-U.2). Realistic only for widgets we own or fork. Alternatively, uicore/summit-registration-lite ship their supporting styles via a discoverable manifest (paths + font URLs) so we don't have to copy them out of `node_modules` ourselves (RC-U.4).

---

### RC-V — Legacy widgets run on Next's vendored React 19

The widget dists are React-16-era (`react-bootstrap@0.33.1`, `react-select@2.4.4`, `react-transition-group@1`, legacy lifecycles + legacy context). On the `/react` path they run on the host's React 19 — and not even the installed one: Next 16's App Router renders every client module — our code *and* the widget dists in `node_modules` — with the React it vendors inside `next` (`next/dist/compiled/react*`, currently `19.3.0-canary`), aliasing bare `react`/`react-dom` imports to it at bundle time. The installed React (`^19.2.8`) governs types + Vitest/jsdom tests. No package pin can change what runs in the browser (only the Next major, or Pages Router, would). Consequences we carry:

**Downstream:**

- **V.1 — `findDOMNode` removed in React 19 → runtime shim.** `react-transition-group@1`'s `CSSTransitionGroupChild` calls `ReactDOM.findDOMNode(this)` on enter/leave; React 19 removed `findDOMNode`, so the `lite-schedule-widget` `EventList` threw `findDOMNode is not a function` and the whole schedule fell to the error boundary. `src/mount/compat/find-dom-node.ts` re-attaches a `findDOMNode` implementation onto the react-dom module object (walks the class instance's `_reactInternals` fiber to its first host node) — imported for side-effect by the reactComponent renderer, so it runs before any `next/dynamic` widget loads. Affects **dev and prod**. Next's vendored alias wins over any `node_modules` nesting, so a package pin can't fix it.

- **V.2 — StrictMode double-mount breaks `react-transition-group@1` → `reactStrictMode: false`.** The enter/appear fade adds `.items-enter` (opacity 0.01), then adds `.items-enter-active` (opacity 1) via a `requestAnimationFrame` guarded by `if (this.mounted)`. React StrictMode's dev-only mount→unmount→remount leaves `mounted` false when the rAF fires, so the `-active` class is never added and list items stay stuck at **opacity 0.01 — invisible** (schedule looks empty even when the user has events). This is dev-only (StrictMode is a no-op in prod) but constant in development. Root fix: **`reactStrictMode: false`** in the host's `next.config.ts` — these widgets predate concurrent mode and can never be StrictMode-clean, so StrictMode yields only this breakage plus doubled warnings. Note StrictMode double-mount is a React **18** feature too, so this is not fixed by downgrading React — only by disabling StrictMode.

- **V.3 — Belt-and-suspenders CSS fade (`schedule-lite/transition-group.ts`).** Independent of V.2, the enter/appear fade is re-expressed as a CSS keyframe animation keyed to `.items-enter`/`.items-appear` alone (reaches opacity 1 without the JS `-active` step). Adopted via `manifest.inlineStyles` on the lite schedule. With StrictMode off the native transition works and this is redundant insurance; it also guards prod against any non-StrictMode timing hiccup. Scoped to `transitionName="items"`.

- **V.4 — Residual legacy-context / UNSAFE-lifecycle warnings.** `react-bootstrap` `Nav`/`Navbar` (`childContextTypes`/`contextTypes`) and `react-select` `AutosizeInput` (`UNSAFE_componentWillReceiveProps`) emit React 19 deprecation warnings. `reactStrictMode: false` silences the StrictMode-gated variants ("within a strict-mode tree", UNSAFE-in-strict-mode) and the doubling; the base "removed in React 19" notices from react-bootstrap persist. They are **warnings, not failures** — legacy context still functions (day/track tab navigation verified working) — and only fully disappear when the widgets are rebuilt against React 19.

**Why the widgets force it.** They target a pre-concurrent, pre-React-19 world; Next 16 gives them React 19 + (by default) StrictMode regardless of our pin.

**What upstream fix would remove it.** Widgets rebuilt against React 19 (drop `findDOMNode`/`react-transition-group@1`, migrate off legacy context and UNSAFE lifecycles) — then V.1–V.4 all collapse and StrictMode can be restored. Realistic only for widgets we own or fork (overlaps RC-A.1).

---

### RC-W — Legacy widgets mutate the props we hand them

Legacy widgets (React-16 / Redux era) treat props as owned, mutable state rather than read-only inputs. `lite-schedule-widget` runs `summit.dates = getSummitDates(summit)` (and `summit.presentation_levels = …`) on the summit object it receives *during render*. Two facts make that a host-state corruption, not a widget-local detail:

- The realtime store returns state **by reference** — the required `useSyncExternalStore` contract (returning fresh copies would trip React's "getSnapshot should be cached" guard and loop). So `useRealTimeSummit()` / `useRealTimeEvents()` hand out the store's live slices, exactly like Redux/Zustand.
- The server hands the **same** summit object to `RealTimeProvider` (store seed) and to the widget (`summitData`), because `getSummit()` is `React.cache()`-deduped and RSC rebuilds one shared client reference.

So the widget's in-place write lands on our store's summit. The concrete failure was #155: `getSummitDates` writes moment objects onto `summit.dates`, and moment's locale functions then break the sync worker's structured clone (`postMessage` → `DataCloneError`), silently dropping every realtime update on schedule pages.

**Fix — isolate at the renderer (`src/mount/mutation-safe-props.ts`, applied by both renderer mounts).** We can't change the store (immutability is the `useSyncExternalStore` contract) and can't stop the widget mutating (it reads its own writes back — e.g. `summit.dates[0].string` for the default day). So the renderer is the boundary: every widget receives shallow copies of its **array** and **plain-object** props. Functions (callbacks), primitives, and non-plain objects (Date, Map, moment, class instances) pass through by reference so no prototype or bound method is stripped. Automatic for all widgets, no per-widget opt-in — an unforgettable invariant of the renderer.

**Shallow, deliberately — and when deep would be needed.** The copy is one level deep. It protects the observed mutation shape (top-level reassignment: `summit.dates = …`) but NOT a widget mutating a *nested* value it was handed:

- `events[i].foo = …` — a widget stamping a derived field onto an individual event object (the shallow `[...events]` copies the array, not its elements).
- `summit.tracks[j].bar = …` / any `summit.<nested>.<field> = …`.
- Sorting/splicing a nested array in place (e.g. `summit.dates.sort(...)` — though `dates` itself is replaced here, other nested arrays aren't).

None of these are observed today. If one surfaces (symptom: our store data changes unexpectedly after a widget renders, or a new `postMessage`/render glitch traces to a nested field), escalate **that widget** to a deep copy. What to change: add an opt-in to the manifest (e.g. `deepIsolate: true`, or a per-prop list like `deepIsolate: ['summitData']`) and, in `src/mount/mutation-safe-props.ts`, deep-clone those props while **preserving functions** — a bespoke recursive clone that skips functions/non-plain objects, not `structuredClone` (it throws on functions, and on values a *previous* render already dirtied). Keep it opt-in: deep-copying every prop each render (the ~40-event array) is a real per-render cost we don't want for the common case.

**Behavior note.** Widgets now receive fresh object references each render, so a widget memoizing on prop identity would re-process. Legacy widgets re-render off their own Redux anyway, so this is a non-issue in practice, but it's a real change in what the widget sees.

**What upstream fix would remove it.** Widgets treat props as immutable inputs (derive locally instead of writing back onto props). Realistic only for widgets we own or fork — overlaps the RC-A / "narrow typed props" direction.

### RC-X — my-orders-tickets-widget owns its token reads through uicore

Every widget except my-orders acquires tokens through callback props wired to
`AuthContext` (served from the `src/lib/auth/session-token.ts` cache, which
refreshes through `/api/auth/session` server-side). The my-orders dist instead imports
`getAccessToken` / `initLogOut` / `getIdToken` **directly from
`openstack-uicore-foundation/lib/security/methods`**, whose default contract is a
localStorage `authInfo` record with client-side refresh — a second token
authority a cookie-authority host does not have (the session cookie is the only one; the
host never writes tokens to localStorage).

Every widget dist also requires `openstack-uicore-foundation/lib/utils/actions`
for its request helpers, and uicore's `getAccessToken` is what those helpers
(`query-actions` included) call internally. So the token authority question is
not limited to my-orders: whatever uicore's `security/methods` answers is what
every widget request carries.

**Fix — uicore's opt-in setters, fed from the host ports.** uicore exposes
`setConfig` (`lib/utils/config`) and `setAccessTokenResolver` +
`setAuthHandlers({ initLogOut, authErrorHandler })` (`lib/security/methods`).
This package's `src/lib/uicore-host.ts` exports `configureUicore()`, which
reads the `HostConfig` and `HostAuth` ports from `src/core/` and calls the
three setters. It is host-agnostic (no host import), so the same file runs in
the Next graph and in the isolated web-component bundle. It keeps uicore's
contract:

- The token resolver returns the `SESSION_PRESENT` placeholder while the host
  reports signed-in (or the port is not filled yet); it throws ONLY when
  `HostAuth.isSignedIn()` is false. An unconfirmed session (a blip) returns the
  placeholder and lets the proxied call decide — a network hiccup never logs a
  signed-in user out. The value is a placeholder; the proxy strips
  `?access_token=` and re-auths from the httpOnly cookie. `uicore-host.ts`
  exports `SESSION_PRESENT`; the host's auth store (`src/lib/auth/auth-store.ts`)
  imports it and returns the same value from `getAccessToken`.
- `initLogOut` delegates to the port's `logout`. uicore's own `initLogOut`
  calls the handler when one is set, so a widget that invokes uicore's
  function directly (my-orders) lands on the host logout too.
- `authErrorHandler` runs for 401/403 only (uicore calls it for those two
  statuses; other statuses take uicore's default path). It raises the
  `widget-auth-error` window event
  (`src/core/widget-auth-error.ts`); it never redirects and
  never invokes the widget's notifier (some auto-invoke the callback they are
  handed, others render SweetAlert into the light DOM). The host's `<WidgetAuthErrorDialog>`,
  mounted with the host providers, is the single auth-error surface: the
  message always shows first, and only an explicit user choice acts — 401
  opens the host login modal (OTP included, no page-leave), 403 offers the
  host logout. Uniform across all nine dists regardless of notifier
  behavior; no auto-redirect exists, so no redirect loop is possible.
- `getIdToken` / `getAuthInfo` / `storeAuthInfo` / `clearAuthInfo` are
  uicore's own localStorage functions. Nothing writes the record here, so
  `getIdToken()` returns `null` and the others touch nothing the host reads.

Both ports are filled by the host's single `configureWidgetHost` call
(`./host`, imported once for its side effect so it runs at module eval). The
host maps its session-token presence onto the HostAuth port (`present` |
`unknown` → signed in, only `absent` is a definite no) and redirects to the
IDP end-session only for a confirmed `present` session. Host and widget
share one session-token cache, so a host-initiated logout is seen here too.
The same call fills the HostConfig port and then calls `configureUicore()`
(RC-F.1). The handlers read the ports at call time.

**One uicore instance per module graph.** The setters live on module state,
so they reach only the uicore copy the widgets resolve. Each graph is kept on
one copy:

- Host (reactComponent path): `webpack-compat.ts` sets
  `resolve.alias['openstack-uicore-foundation']` to `UICORE_DIR`, the directory
  of the copy `@openeventkit/widgets` itself resolves, so a `link:`ed widget
  package with its own `node_modules`, or a nested peer variant, cannot bring a
  second unconfigured uicore into the graph. The same call adds the
  react-select `findDOMNode` rule (RC-V.1). The alias is webpack-only; a
  Turbopack move needs the equivalent `turbopack.resolveAlias` entry. The
  module ships as `@openeventkit/widgets/webpack-compat`, so any host — the
  reference host and base-theme consumers alike — applies it with the same
  `applyWidgetCompat(config)` call in its own `next.config`.
- Web component: `@openeventkit/web-components`' `scripts/build.mjs`
  applies `uicorePinPlugin` to every build, resolving every
  `openstack-uicore-foundation/*` import from the web-components package's own
  `node_modules`. The shared runtime chunks serve `lib/utils/config` and
  `lib/security/methods` as import-map modules; the element's
  `mount()` calls `configureUicore()` on them once per module graph
  (the only call site, both variants). The bundle carries its own copies of
  the core ports, whose module singletons start empty; `mount`
  registers the host impls into them before anything renders — the DOM
  element is the only host↔widget channel, nothing rides window.

**Cache footgun (host-side; the reference host's `next.config.ts` handles
it).** Webpack's persistent cache tracks the host's `next.config.ts` as a
build dependency but not its imports — unless the host registers this
package's `webpack-compat.ts` in `cache.buildDependencies`, alias edits
reuse cached resolution and silently don't apply until a clean build.

**What upstream fix would remove it.** The setters are the uicore side of
the fix (release status in UPSTREAM.md entries 4 and 5). What remains is the
host wiring: `uicore-host.ts`, the two ports, the alias and the pin. A
my-orders release that takes `getAccessToken` as a callback prop like every
other widget (entry 4) drops its direct `security/methods` imports, but the
resolver still serves uicore's internal callers, so the wiring stays as long
as any widget dist externalizes uicore.

---

### RC-Y — web component hosting bundles its own React (≥17)

An alternative to the RC-U/RC-V shadow model: package a legacy widget as a self-contained custom element (`<speakers-widget>`, `<schedule-lite>`) that bundles its OWN React and mounts the widget in a shadow root, isolated from the host's React 19. This deletes the RC-V version shims (`findDOMNode`, StrictMode, legacy-context warnings) by isolation — the widget runs on a React it was built against, not the host's — at the cost of shipping a second React per web component (mitigated by a shared-runtime build variant). The full isolation model and its trade-offs are in [ISOLATION-STRATEGY.md](../web-components/ISOLATION-STRATEGY.md); this entry records the one trade-off that constrains which React a web component may bundle.

**Downstream:**

- **Y.1 — The bundled React must be ≥17; React ≤16 breaks every synthetic event inside shadow.** React ≤16 attaches all event listeners at `document`. An event that bubbles out of a shadow root is **retargeted to the shadow host** by the time it reaches `document`, so `nativeEvent.target` is the host — React can't map it to the in-shadow element's fiber and drops the event. Every `onClick` / `onMouseDown` / `onChange` inside the shadow silently no-ops. Symptom on the lite-schedule web component: the day tabs only scrolled to top (the native `href="#"` fired; the react-bootstrap `onSelect` did not) and the uicore day-picker never opened (react-select's `onMouseDown` did not fire). React **17** moved event delegation off `document` and onto the render root (the `<div>` we mount into, inside the shadow), which fixes this natively. The web components therefore bundle **React 18.3.1**, not the widgets' nominal React 16 — 18 stays API-compatible with the React-16-era widgets (legacy context, `findDOMNode`, class lifecycles all still supported), so the isolation win of RC-V survives while shadow events work. Same retargeting root cause as U.5.1, but one level lower: U.5.1 patches a *widget's* click-outside handler; this is *React's own* event system, which no bridge can reach — only a React that delegates at the render root resolves it.

- **Y.2 — Shared code is served as import-map-resolved ES modules, not one bundle-per-widget.** To avoid shipping a second React (and MUI, and uicore) per web component, each widget's **`<name>.shared.js`** is an ES module whose shared imports (react, react-dom, jsx-runtime, the exposed uicore paths, the served MUI surface) stay bare; the host inlines an **import map** (`WidgetImportMap`, generated `import-map.json`) resolving each specifier to a generated **`runtime/` chunk**, and the browser walks the module graph — no load ordering, no runtime global for modules. esbuild code-splitting across the runtime entries guarantees ONE instance of every stateful internal (uicore config/methods, emotion). The default build (`scripts/build.mjs`) emits the runtime chunks + import map + `.shared.js` files, which is all the host loads; `--standalone` emits `.standalone.js` IIFEs that bundle everything, as a drop-in for a host that serves no runtime chunks. Non-MUI widgets never pull MUI chunks (the graph only fetches what a widget imports); the MUI widgets (`schedule-full`, `my-tickets`, `registration`) share one copy. Full model: [SHARED-MUI-RUNTIME.md](../web-components/SHARED-MUI-RUNTIME.md).

- **Y.3 — Build-time requirements are declared per widget, not applied globally.** Which layer/plugins a widget gets (the MUI-5 pin, Node stubs, the font patch) is declared in its manifest as `runtimeNeeds` (a fixed `RuntimeNeed` vocabulary in `@openeventkit/widgets/core/manifest`); the wc build orchestrates via a `NEEDS_TO_PLUGINS` map; the module graph pulls MUI chunks only for widgets that import them. `analyze-widgets.mjs --check` verifies each declaration against the widget's real dependency footprint (and guards MUI-surface/barrel drift). So a widget that needs nothing special pays for nothing, and the wc build hardcodes no widget names. Full model: [RUNTIME-REQUIREMENTS.md](../web-components/RUNTIME-REQUIREMENTS.md).

**Why the widgets force it.** Nothing in the widgets demands document-level delegation; it's React ≤16's own event architecture that assumes document scope. Because the web component's whole point is to run the widget on its own bundled React, that React's version is ours to choose — and it must be one whose event system survives the shadow boundary.

**What upstream fix would remove it.** None needed — this is a host-side choice, resolved by pinning the web component's bundled React to ≥17. It only exists because the isolation model bundles a React at all; the RC-U/RC-V shadow model (widgets on the host's React 19) never hits it, since React 19 also delegates at the root.

---

## Meta observations

> **Alternative to modernization:** the four fixes below assume modernizing the
> widgets onto React 19. Isolating each widget as a web component on
> its own bundled React (18 — see RC-Y) deletes the version shims by isolation
> instead — a working POC and the full trade-off against this path is in
> [ISOLATION-STRATEGY.md](../web-components/ISOLATION-STRATEGY.md).

Roughly 50 distinct trade-offs across 25 root causes. If we collapsed the root causes into their upstream fixes, only **four upstream fixes** would remove the majority of the tax:

1. **Widgets rebuild their dist with modern ES imports** — kills RC-B (esmExternals, Turbopack incompatibility, no tree-shake, inline CSS chunks) plus RC-E (side-effect CSS chain) plus RC-S (ambient CSS declarations).
2. **uicore replaces `react-select@2.4.4`** — kills RC-A.1 (React 19 unlock) and lets us drop the peer-dep silencing.
3. **Widgets accept data + callbacks as narrow, typed props (not Redux state slices)** — kills RC-A.2 (per-instance Redux), RC-D (Gatsby-shaped prop model), RC-K (action dispatch → callback wire), RC-L (marketing keys as widget-driven schema), RC-M (hydration flicker).
4. **Widgets become shadow-DOM-aware in their runtime assumptions** — narrows RC-U (font-face injection, tooltip bridge, emotion cache pointing at shadow). Each of those bridges exists because a widget internal (or one of its deps) assumes document scope; if the widget doesn't make that assumption, the bridge collapses.

The widget repos live in the `fntechgit` org and uicore in `OpenStackweb` — the orgs that
publishes the packages — so these are ordinary upstream contributions.
The actionable, per-entry version of this list (with status, branches,
and what containment each entry deletes) lives in
[UPSTREAM.md](./UPSTREAM.md).

## Fixes that do not work

For future reference — approaches we tried or evaluated that do not actually resolve the trade-offs:

- **`transpilePackages` for widget packages under Turbopack.** Does not fix the CSS "module factory" bug — Turbopack still can't resolve CSS chains inside pre-bundled dist. Also blows compile time (multi-minute cold compile, 6GB RSS) when it tries to SWC-process widget dist trees.
- **`transpilePackages: ['@react-pdf/renderer']` under webpack.** Same problem — massive compile time processing the entire `@react-pdf/renderer` tree (pdfkit + fonts + etc.).
- **`turbopack.rules` or `turbopack.resolveAlias` for the CSS chain.** Turbopack docs are explicit: rules match source files, not internals of pre-bundled dist. `resolveAlias` maps package specifiers, not internal CSS paths.
- **Isolating React 18 to only this package.** React is a runtime singleton per document. Two React copies produce "Invalid Hook Call." Cannot scope React versions per package without iframes or web components.
- **`esmExternals: 'loose'` under Turbopack.** Turbopack rejects the flag entirely. It exists to shim webpack's CJS→ESM resolution.
- **Importing widget/vendor CSS as text with `?raw`.** Next's CSS pipeline is layered under a nested `oneOf` in webpack; a top-level `?raw` rule can't preempt it, and even `unshift` fails (vercel/next.js#82000). The generated vendor-css modules + the binaries in this package's `assets/` (served by the host) are the working route (RC-U.3, RC-U.4).
- **Monkey-patching `document.querySelectorAll` / `document.addEventListener` to see through shadow.** Would let libraries that scan or delegate at document scope discover shadow-scoped triggers — but defeats shadow's own isolation semantics globally, adds hard-to-diagnose failure modes (patched-target confuses libraries that expect the retargeted host), and turns every library upgrade into an audit. Test-only tools like `query-selector-shadow-dom` explicitly disclaim production use.
- **Re-dispatching composed events from shadow to `document.body` with a spoofed `target`.** `event.target` is set by the dispatch machinery when the event fires, and a `defineProperty` override placed before `dispatchEvent` doesn't reliably survive. Cannot lie about `event.target` to a `document.addEventListener` handler at the platform level. Per-library shadow-aware bridges (RC-U.5) are the working route.

## Upstream fixes ordered by blast radius

If we ever get pressure on the widget authors, request these first:

| Priority | Fix | Removes |
|---|---|---|
| 1 | Rebuild widget dists with ES imports and per-widget CSS files | RC-B, RC-E, RC-S |
| 2 | uicore drops or upgrades `react-select@2.4.4` | RC-A.1, RC-A.3 |
| 3 | Widgets accept narrow typed props (no Redux slice shapes) | RC-A.2, RC-D, RC-K, RC-L, RC-M |
| 4 | Widgets ship TypeScript declarations | RC-C, RC-S |
| 5 | Widgets expose theming API + injectable HTTP client | RC-H, RC-Q |
| 6 | Widgets subscribe to a passed-in real-time signal | RC-I |
| 7 | uicore accepts clock URL via prop or context | RC-F.1, RC-F.2 |
| 8 | Widgets externalize third-party integrations (Stripe, PDF) | RC-O |
| 9 | Widget deps stop assuming document scope (event delegation, `document.head` CSS injection, `document.body` portals) | RC-U.2, RC-U.5, RC-U.6 |
| 10 | Widgets/uicore ship a manifest of the supporting stylesheets + font paths they need | RC-U.3, RC-U.4 |

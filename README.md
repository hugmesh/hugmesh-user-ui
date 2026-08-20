# hugmesh-user-ui

The self-service **user console** for [HugMesh](https://github.com/hugmesh-net), a
federated community platform with Matrix/Mastodon interoperability. This is
where a signed-in member manages their own profile and avatar, publishes
"cards" (sandboxed rich mini-pages), controls their block list and visibility,
manages connected external clients, and reads notifications — always scoped to
their own account, never anyone else's.

It ships as an **Angular 22 native-federation remote**, paired with the
[`hugmesh-user-bff-api`](https://github.com/hugmesh-net/hugmesh-user-bff-api)
backend-for-frontend. The [`hugmesh-host-shell`](https://github.com/hugmesh-net/hugmesh-host-shell)
host federates this remote's exposed `USER_ROUTES` at runtime and mounts them
at the user role-home, so they resolve to:

| Host path                   | View                              | Component                          |
| --------------------------- | --------------------------------- | ---------------------------------- |
| `` (role-home)              | Welcome / getting-started guide   | `HomeComponent`                    |
| `profile`                   | Profile editor                    | `ProfileComponent`                 |
| `cards`                     | Federation card manager           | `CardsComponent`                   |
| `blocks`                    | Self-block list                   | `SelfBlockComponent`               |
| `recommend-instance-block`  | Instance-block recommendation     | `RecommendInstanceBlockComponent`  |
| `self-silence`              | Self-service visibility hide      | `SelfSilenceComponent`             |
| `connected-apps`            | Connected apps + device sessions  | `ConnectedAppsComponent`           |
| `sessions`                  | Active login sessions (list + revoke own) | `SessionsComponent`        |
| `preferences`               | Durable per-user preferences (e.g. `media.poison.default` toggle) | `PreferencesComponent` |
| `notifications`             | In-app notification inbox         | `NotificationsComponent`           |
| `notification-preferences`  | Per-category notification opt-in toggles | `NotificationPreferencesComponent` |

> **Status legend** — this README uses: ✅ **shipped** (merged to `main`) ·
> 🚧 **in-flight** (code on an open branch/PR, not yet merged) ·
> 🔭 **planned** (design-complete, no code). All eleven routes above are
> ✅ shipped (`src/app/user.routes.ts`). Roadmap items are collected under
> [Roadmap](#roadmap).

Casdoor **ROLE_USER** floor — the host route-guards the user role-home. ALWAYS
the caller's OWN data: the paired BFF forces owner = authenticated subject, so a
user can only ever read/write their own profile (incl. avatar), cards, blocks,
self-silence, preferences, clients, stream status, login sessions, and
notifications.

The **connected-apps** view additionally mirrors the BFF's external-client-role
gate: a caller WITHOUT a Matrix/Mastodon external-client role sees that surface
**disabled with helptext** (defence-in-depth — the API stays the source of truth,
the UI explains the missing capability rather than 403-ing).

## Federation

`federation.config.js` (built on the byte-identical `federation-base.js` shared
across every HugMesh remote) exposes two modules under the remote name
**`user`**:

- `./routes` → `src/app/user.routes.ts` (`USER_ROUTES`) — the role-home surface.
- `./profile` → `src/app/profile.component.ts` (`ProfileComponent`) — exposed
  standalone so the host can mount the profile editor as a **modal** later.

The build emits `dist/user/browser/remoteEntry.json`, whose `exposes` entries
the host consumes to lazy-load the routes / profile modal.

> 🔭 **Platform roadmap.** Today the host's federation map is static. The UI
> standard's target is **dynamic DB-hosted federation**: remote URLs served from
> the database and wired through ArgoCD + the gateway's route-access, so this
> remote's `federation.config.js` / `federation-base.js` participate in
> runtime-managed federation. See [Roadmap](#roadmap).

## Datastore services

All data access is through RxJS `BehaviorSubject`-backed datastore services that
wrap `HttpClient` to the same-origin `/bff/user/**` surface (the gateway fronts
hugmesh-user-bff-api):

| Service              | user-bff-api endpoints                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `UserProfileService`     | `GET/PUT /bff/user/profile` (carries `screenReaderName` + `avatarUrl`), `POST /bff/user/profile/{password,email}`, `POST /bff/user/profile/avatar` (multipart avatar upload), `GET/POST/DELETE /bff/user/home-guide[/dismiss]` |
| `CardsService`           | `GET /bff/user/cards`, `GET /bff/user/cards/{slug}` (versions), `GET /bff/user/cards/{slug}/body` (current source, for Edit pre-fill), `PUT /bff/user/cards/{slug}` (octet-stream), `DELETE /bff/user/cards/{slug}` |
| `BlockService`           | `GET/POST /bff/user/blocks`, `DELETE /bff/user/blocks/{id}`, `POST /bff/user/recommend-instance-block` |
| `SelfSilenceService`     | `GET /bff/user/self-silence/status`, `POST /bff/user/self-silence/{activate,cancel,email-mod}` |
| `ConnectedClientsService` | `GET /bff/user/connected-clients`, `DELETE /bff/user/connected-clients/{id}` (external-client role) |
| `PreferencesService`     | `GET /bff/user/preferences` (resolved map, server defaults merged in), `PUT /bff/user/preferences` `{key, value}` upsert → updated map. Owner is always the authenticated subject; known key `media.poison.default` (values `off`/`low`/`medium`/`high`). |
| `OwncastService`         | `GET /bff/owncast/user/my-stream` → `{ streamUrl, visibility }` for the caller's OWN broadcast grant (200 with grant, 404/empty when none). Backs the `sd-owncast-player` card publish-gate. |
| `SessionsService`        | `GET /bff/user/sessions` (caller's own active login sessions), `DELETE /bff/user/sessions/{id}` (revoke one own session; the BFF validates ownership server-side before deleting the `bff_session` row). |
| `NotificationsService`   | `GET /bff/user/notifications` (caller's in-app feed, newest-first, optional `?limit`), `POST /bff/user/notifications/{id}/read` (idempotent mark-read), `GET /bff/user/notifications/events` (real-time SSE push via `startLive()`/`stopLive()`). Exposes `unreadCount$` for a host-shell bell badge and `liveStatus$` (`idle`/`connecting`/`live`/`degraded`) so a consumer can honestly disclose when the feed isn't currently live. |
| `NotificationPreferencesService` | `GET /bff/user/notification-preferences` (all four category prefs), `PUT /bff/user/notification-preferences` `{category, enabled}` upsert. The `account-restriction` category is forced-on (the BFF ignores `enabled:false` for it). |

> Endpoint owner is ALWAYS the authenticated subject (server-enforced), so a user
> can only ever read/write THEIR OWN profile, cards, blocks, self-silence,
> preferences, clients, stream status, login sessions, and notifications.

### Request authentication (HttpOnly cookie, no browser-held bearer)

✅ Every outgoing `HttpClient` request passes through `authInterceptor`
(`src/app/auth.interceptor.ts`), which simply clones the request with
`withCredentials: true` so the browser's HttpOnly `bff_` session cookie rides
along automatically. The interceptor does **not** read or attach anything from
`SessionService` — the browser holds no bearer token at all in this model.
Requests made while the cookie is absent (not logged in) are still sent; the
BFF rejects them with `401`.

> ⚠️ **What actually authenticates the request.** Under the SSO model, login-ui
> runs the Casdoor OIDC authorization-code (PKCE) redirect and
> **hugmesh-user-bff-api** does the server-side code→token exchange and holds
> per-session JWT custody/refresh; the browser **never sees the Casdoor JWT**,
> and never sees the opaque `bff_` session token as script-readable state
> either, only as an HttpOnly cookie. At the
> edge, the gateway is a pure Casdoor-JWT OAuth2 resource server: a
> pre-security exchange filter swaps the HttpOnly `bff_` cookie for the
> internal custody JWT, then runs unchanged JWT validation + the data-driven
> `gateway_route_access` role gate. So this remote's job is just to send the
> cookie; the gateway, not the browser, presents the JWT downstream.

```mermaid
sequenceDiagram
    participant Browser as Browser HttpClient
    participant Gateway as Gateway
    participant BFF as user-bff-api
    Browser->>Gateway: request, withCredentials true, HttpOnly bff_ cookie attached
    Gateway->>Gateway: BffCookieToBearerWebFilter exchanges bff_ cookie for internal JWT
    Gateway->>Gateway: JWT validation and gateway_route_access role gate
    Gateway->>BFF: forwarded request carrying internal JWT
    BFF-->>Gateway: response, owner forced to JWT subject
    Gateway-->>Browser: response
```

The remaining session state (`id`, `label`, `provider`, `roles`,
`registrationComplete` — **no token field**) is persisted to
**`localStorage`** under the shared **`hug.session`** key, with cross-instance
reconciliation over the **`snap-session-change`** broadcast contract
(`src/app/session.service.ts`) — the same key/broadcast every HugMesh UI
uses. This is UI-only role-signal state for defence-in-depth menu/route
gating (see [`SnapSession`](#cross-cutting-a11y-utilities-copied-per-remote));
it carries nothing an attacker could replay against the BFF, so an earlier
plan to move a bearer token out of `localStorage` no longer applies here —
see [Roadmap](#roadmap).

### Cross-cutting a11y utilities (copied per remote)

native-federation forbids a shared runtime import across remotes, so this remote
ships its own byte-identical copies:

- `accessible-name.ts` — `accessibleName(displayName, screenReaderName)` +
  `isPrintableAscii` + `defaultScreenReaderName`, mirroring the server's
  `ScreenReaderNames` rule (printable ASCII **U+0020..U+007E** — not the naive
  `/^[\x00-\x7F]*$/` that wrongly accepts NUL/tab/newline/DEL the server 422s).
  The profile editor uses it for the screen-reader-name validator + live preview.
- `session.service.ts` — the canonical `hug.session` signal store + role
  computeds, including `hasExternalClientRole` (drives the connected-apps gate).
- `.field-help` / `.hint` (`styles.scss`) — the disabled-control +
  `aria-describedby` helptext convention used wherever the UI mirrors an API gate.

## Develop

```bash
npm install
npm start            # ng serve user → http://localhost:4206 (standalone dev shell)
```

The standalone dev shell (`AppComponent`, selector `hug-user-root`) mounts
`USER_ROUTES` at `/` so the remote is browsable on its own. In production the
host loads `./routes` directly and this shell is not used.

### Typed BFF client (ng-openapi-gen)

✅ A typed client for the user-bff-api surface is generated with
[`ng-openapi-gen`](https://www.npmjs.com/package/ng-openapi-gen) — the platform
UI standard's canonical client-generation approach. The generated client
(`src/app/api`) AND its input spec (`openapi.json`) are **committed** so the build
is deterministic and needs no network or running BFF.

```bash
npm run gen          # generate from the committed ./openapi.json into src/app/api
npm run gen:spec     # refresh ./openapi.json from the BFF's COMMITTED spec, then npm run gen
```

**Deterministic spec source (no running server).** `hugmesh-user-bff-api`
produces `src/main/resources/openapi/openapi.json` as a build artefact: its
`OpenApiSpecDumpTest` (an ordinary `./mvnw test`) boots the context under the
`test` profile, GETs `/v3/api-docs`, and writes a key-sorted, byte-stable spec.
`gen:spec` copies that committed spec next door (default
`../hugmesh-user-bff-api/...`, override with `USER_BFF_SPEC=/path/to/openapi.json`)
and regenerates — replacing the old `gen:fetch` that curled a manually-run BFF on
`localhost:8080` (not CI-friendly). To refresh after a BFF API change: re-run the
BFF spec-dump test, commit the BFF spec, then `npm run gen:spec` here and commit
the regenerated client.

`ng-openapi-gen.json` reads `openapi.json` and writes typed models/services to
`src/app/api` (`skipJsonSuffix`, `enumStyle: alias`). The hand-written
`*.service.ts` datastore services delegate to these generated typed services —
eight of nine are migrated (`UserProfileService`, `CardsService`, `BlockService`,
`SelfSilenceService`, `ConnectedClientsService`, `PreferencesService`,
`SessionsService`, `NotificationsService`). Three calls stay hand-rolled for
reasons the generator cannot cover — the multipart avatar upload, the
octet-stream card-body read, and the SSE notification stream — and
`NotificationPreferencesService` is blocked on an upstream spec collision; all
four are documented in [Deferrals](#deferrals).

## Build

```bash
npm run build        # ng build user → dist/user/browser/ (incl. remoteEntry.json)
```

## Test

```bash
npm test             # ng test user --watch=false --browsers=ChromeHeadlessCI
```

✅ `karma.conf.js` adds the JUnit reporter (`karma-junit-reporter`), so a CI run
writes a JUnit report to **`test-results/results.xml`** (reporters
`progress`/`kjhtml`/`junit`). The `ChromeHeadlessCI` launcher runs
`--no-sandbox --disable-dev-shm-usage`.

🚧 An end-to-end **Playwright + BDD (Gherkin)** harness lives alongside the unit
specs. It's early-stage — its cluster-dependent scenarios are tagged off by
default (see [`e2e/README.md`](e2e/README.md)) — and exercises the user-console
surfaces against the federated host, growing toward the platform's full-stack
SSO/security e2e coverage (see [Roadmap](#roadmap)).

## Deploy

`Dockerfile` builds the remote and serves `dist/user/browser` via nginx with
`Access-Control-Allow-Origin "*"` (so the host can fetch `remoteEntry.json` and
chunks cross-origin) and an SPA fallback to `/index.html`; `GET /healthz`
returns `200`. ✅ The nginx config also emits baseline HTTP **security headers**
on every response (`always`): `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and
`Strict-Transport-Security` (HSTS, one year + `includeSubDomains`). Stricter
policies (CSP, COEP/CORP, Permissions-Policy) are deliberately deferred to the
live-cluster pass (per-UI tuning + browser validation). Runs as its own pod in
the hugmesh-frontend namespace, fronted
by the fe-gateway at `/user`. CI is **GitLab** (`.gitlab-ci.yml`) — the GitHub
repo is pull-mirrored into in-cluster GitLab. There are **no GitHub Actions**.

✅ The GitLab pipeline runs `stages: [test, e2e, build, pentest]`:

- **`test`** — runs `npm test` in a `node:24-alpine` + chromium container with
  `ChromeHeadlessCI`, uploading the JUnit report at `test-results/results.xml`
  as a `junit` artifact. This stage **gates** `build:image` (`needs: [test]`).
- **`e2e:bdd`** — runs `bddgen` + `playwright test --list` (offline, no live stack) to prove the Gherkin features compile and all scenarios are discoverable; `allow_failure: true`, `needs: []` (does not gate `build:image`).
- **`build:image`** — builds and pushes the container image (immutable
  `tag`/SHA + moving branch tag) to the in-cluster GitLab registry.
- **`pentest`** — thin `pentest:sca` / `pentest:dast` jobs that `extends:` the
  centralized OWASP pen-test stage `include:`d from `hugmesh-generator`
  (`allow_failure: true`, default-branch + MR rules). One source of truth across
  all onboarded repos — see the platform pen-test standard. `make pentest` runs
  the same SCA (`npm audit` + OWASP dependency-check via Docker) and DAST
  (delegates to the generator's `run-pentest.sh` against `DAST_TARGET_URL`)
  surface locally so a dev can self-scan before pushing; it degrades to a note
  rather than failing when Docker/a target URL is absent.


## Sandboxed, draggable section card builder

The cards manager (`CardsComponent`) embeds a sandboxed, **section-based** card
builder (`CardEditorComponent`). A card is an **ordered list of sections** the
author can add, remove, and **reorder by drag-and-drop** (Angular CDK —
keyboard-accessible: a real drag-handle button plus explicit *Move up* / *Move
down* controls). Each section has a title, a body, and an **orientation**
(alignment left/center/right + a 1–4 **columns** toggle). The author writes
section content as HTML using a curated set of **provided `sd-*` tags** and may
embed **MathTeX**, and sees a **live preview** as they type. On publish, the
section document is serialised (a v2 body: one-line section JSON + the existing
fenced CSS block) and sent as the entry-file octet-stream body through the
unchanged `CardsService.put` → `PUT /bff/user/cards/{slug}` contract, so
re-opening a card restores the exact section structure and ownership stays
server-side (the BFF forces owner = authenticated subject). Legacy markdown
bodies decode to a single section, so older cards keep working.

✅ **Edit pre-fill + Delete.** *Edit* now seeds the slug/visibility AND pre-fills
the editor with the card's CURRENT content: `CardsComponent.edit()` reads the raw
stored entry-file body (`CardsService.readBody` → `GET /bff/user/cards/{slug}/body`,
owner-scoped upstream) and `decodeDocument` round-trips the full section structure
back into the editor, so the author edits the real prior sections instead of
re-authoring (publishing still creates a new version; a failed body read falls back
to an empty editor with explanatory status). Each card also has a **Delete** control
(`CardsComponent.remove()` → `CardsService.delete` → `DELETE /bff/user/cards/{slug}`,
owner-scoped) that drops the caller's own card and refreshes the list. The generated
typed client carries `src/app/api/fn/cards/body.ts` and `delete-1.ts` for these.

### Provided Angular tags (the sanctioned vocabulary)

`src/app/card-tags.ts` defines the ONLY custom tags an author may use — the
editor's tag palette inserts a starter snippet for each:

| Tag | Renders to | Key attributes |
| --- | --- | --- |
| `<sd-card-section>` | a titled `<div>` block | `title`, `align` (left/center/right) |
| `<sd-columns>` | a CSS-grid column layout | `count` (1–4) |
| `<sd-callout>` | a coloured note box (`role="note"`) | `tone` (info/success/warning/danger) |
| `<sd-badge>` | an inline pill/label | `tone` (info/success/warning/danger) |
| `<sd-divider>` | a horizontal rule (`<hr>`) | — |
| `<sd-math>` | KaTeX-rendered LaTeX | `display` (block/inline) |
| `<sd-owncast-player>` | a live-stream player region for the author's OWN Owncast broadcast (requires a broadcast grant) | — (attributes are ignored; the HLS URL is **platform-supplied**, never author-injectable) |

Each provided tag is **lowered to plain allow-listed markup** (`<div>`/`<span>`/
`<hr>` with a fixed `class`) *before* sanitisation, and out-of-list attribute
values are clamped to a safe default. So after lowering there are no custom
elements left — anything not on this list (and any `<script>/<iframe>/on*=/style=`)
is still stripped by the allow-list walk.

### MathTeX (KaTeX, pre-rendered, script-free)

Math is written as `<sd-math>…</sd-math>` or with `$$…$$` (display) / `\(…\)`
(inline) delimiters, and rendered with **KaTeX** (`card-math.ts`). The TeX is
rendered to **static HTML + accessible MathML at preview/build time** — never as
a runtime script in the sandbox. Because KaTeX's output legitimately needs inline
positioning `style` (which the allow-list strips), each rendered fragment is
swapped for an **unguessable placeholder token** before sanitisation and
re-substituted after — so user text can neither forge a placeholder nor smuggle
markup through this channel. KaTeX runs with `trust:false` (refuses
`\href`/`\url`), so its output has no `<script>`, no live URLs, just MathML for
assistive tech. Its **structural CSS is inlined and scoped to `.card-root`**
(`katex-css.ts`, generated by `scripts/gen-katex-css.mjs`). Relative font URLs
can't resolve in a null-origin `srcdoc`, so a **minimal font subset** (KaTeX
Main regular/bold/italic/bold-italic, the default Math-Italic variable style,
and the two most common stretchy-delimiter sizes, Size1/Size2 — 7 of the 20
upstream `@font-face`s) is **base64 data-URI-inlined** directly into the CSS,
so those glyphs render for real offline/air-gapped, with no network round-trip
either. Every other font (AMS, Caligraphic, Fraktur, Script, SansSerif,
Typewriter, Size3/4, …) is still `@font-face`-stripped — inlining all 20 would
meaningfully bloat this bundle for rarely-used symbol sets — so those rarer
glyphs fall back to the system serif/sans (the accessible MathML layer is
unaffected either way).

### Owncast live-stream player (platform-supplied HLS, never author-injectable)

✅ `<sd-owncast-player>` lets an author embed a player for **their own** Owncast
broadcast on a card. The HLS URL is **never read from the author's markup** — it
is supplied by the platform:

- On lowering (`lowerProvidedTags`, `card-tags.ts`), `<sd-owncast-player>` is
  reduced to a plain allow-listed `<div>`; any attributes on the source element
  are silently ignored. When a platform `streamUrl` is available the `<div>`
  carries `class="sd-owncast-player"`, `role="region"`, an `aria-label`, and a
  single **`data-hls-src`** attribute (the only place `data-hls-src` is allowed
  on `div` in the sanitiser allow-list, `card-sanitize.ts`). With no stream URL
  it lowers to an accessible **placeholder** note instead.
- `renderSafeCardHtml(rawHtml, streamUrl?)` threads the platform-supplied
  `streamUrl` through lowering so the HLS source can only ever come from the
  platform.
- The **live** card renderer (outside the sandbox) is responsible for wiring
  **HLS.js** off `data-hls-src`. Inside the preview's null-origin sandbox there
  is no `allow-scripts`, so the preview just shows the notice text.

**Publish-gate (`CardsComponent`).** When the card content contains
`<sd-owncast-player>`, publish first calls `OwncastService.myStream()`
(`GET /bff/owncast/user/my-stream`) and tracks an `owncastGrantState` signal
(`unchecked` → `checking` → `granted`/`denied`). If there is no active broadcast
grant, **Publish is blocked** with helptext ("You need a broadcast grant from an
admin to publish a live stream card."), and the platform stream URL is only
resolved server-side when a grant is confirmed. This mirrors the BFF's grant as
the source of truth (defence-in-depth — the UI explains the missing capability
rather than relying on the client).

### Sandboxing model (defence in depth)

User content can **never** script or restyle the host shell. Two independent
walls (`src/app/card-sanitize.ts` builds the preview document):

1. **Sanitise + scope (content wall).** Math is extracted to placeholders, the
   provided `sd-*` tags are lowered to safe markup, then the result is run
   through `sanitizeHtml` — a `DOMParser`-based tag/attribute **allow-list** that
   removes `<script>/<iframe>/<style>/<svg>/…` subtrees, strips every `on*=`
   handler and inline `style=`, and restricts `href`/`src` to safe schemes
   (drops `javascript:`, `data:text/html`, …; keeps inert `data:image/*`).
   Trusted KaTeX HTML is re-inserted only after this walk. The user CSS is run
   through `scopeCss`, which prefixes **every** selector with `.card-root` (and
   collapses `html`/`body`/`:root` to `.card-root`), strips `</style>` breakout,
   `@import`, `expression(`, `javascript:` and `-moz-binding` — so the CSS can
   only ever style the card, not the page around it.
2. **Sandboxed iframe (origin wall).** The sanitised, scoped document is loaded
   into an `<iframe sandbox srcdoc>` whose sandbox token list is **empty** — no
   `allow-scripts`, no `allow-same-origin`. The frame is therefore a unique,
   **opaque origin with scripting disabled**: even if the content wall ever
   missed something, the framed document cannot execute JS or reach the host
   DOM / cookies / storage.

The dangerous-input logic lives in framework-free modules with direct unit tests
(`card-sanitize.spec.ts`, `card-tags.spec.ts`, `card-math.spec.ts`,
`card-sections.spec.ts`) asserting that `<script>`, `onerror=`, host-escaping CSS
(`body{display:none}`), `javascript:` URLs and `<style>` breakout are stripped or
scoped — even when mixed with provided tags and math — and that a section reorder
is reflected in the serialised body. `card-editor.component.spec.ts` asserts the
iframe carries no `allow-scripts`/`allow-same-origin`, that the drag handle +
move controls + tag palette are keyboard-operable (real buttons, `aria-pressed`
toggles), and that `<sd-math>` renders KaTeX while a `<script>` stays stripped.

## Status

Every route and feature described in this README is merged to `main` and
ships in the production image. The user console covers all eleven role-home
routes (profile incl. avatar upload, cards, blocks,
recommend-instance-block, self-silence, connected-apps, sessions,
preferences, notifications, notification-preferences) plus the sandboxed
section card builder, the Owncast player tag, real-time SSE-backed
notifications with a KaTeX font subset inlined for the sandboxed card preview,
the HttpOnly-cookie auth model (no browser-held bearer, see
[Request authentication](#request-authentication-httponly-cookie-no-browser-held-bearer)),
a typed ng-openapi-gen client (eight of nine datastore services migrated — see
[Deferrals](#deferrals)), baseline nginx security headers, a GitLab
`test → build → pentest` pipeline, and a growing Playwright + BDD e2e harness
(early-stage — see [`e2e/README.md`](e2e/README.md)).

This remote sits inside the wider HugMesh platform's shared ecosystem baseline
and SSO model:

- **SSO via Casdoor (the auth model).** Sign-in is performed by
  [`login-ui`](https://github.com/hugmesh-net/login-ui) as a Casdoor OIDC
  authorization-code (PKCE) redirect; **hugmesh-user-bff-api**
  performs the server-side code→token exchange and holds per-session JWT
  custody/refresh. This browser holds **no token at all** — the BFF sets the
  session as an **HttpOnly `bff_` cookie** (script-unreadable) and the user
  never sees their own Casdoor JWT. The gateway is a pure Casdoor-JWT OAuth2
  resource server: a pre-security exchange filter swaps the `bff_` cookie for
  the internal custody JWT before JWT validation + the data-driven
  `gateway_route_access` role gate (`GatewayRouteAccessFilter`) run.
  ADMIN/GAME-MASTER bypass within their own domain; SUPERADMIN is
  cross-domain. Cloudflare fronts production. **End-to-end SSO (incl. e2e)
  is in progress** platform-wide (see [Roadmap](#roadmap)).
- **Login/session relocation.** Login, session, and account logic is being
  **relocated from admin-bff into user-bff**, with the shared
  account/session/MFA/Casdoor-admin infra extracted to the new
  **hugmesh-auth-core** artifact (consumed by user-bff + admin-bff). Account
  and session **data** still lives in admin-bff-db; user-bff reaches it via
  admin-bff `/bff/internal` over mTLS + `X-Internal-Token`. None of this changes
  this UI's contract: it talks `/bff/user/**` and carries the opaque session
  bearer.
- **Backend baseline (for the paired BFF).** Spring Boot 4.0.7 / Spring Cloud
  2025.1.2, on the shared `hugmesh-parent` (2.7.0) metapom +
  `hugmesh-commons` + `hugmesh-auth-core`. Spring Cloud
  Gateway 5.0 route config now lives under
  `spring.cloud.gateway.server.webflux.routes` (the legacy
  `spring.cloud.gateway.routes` prefix silently binds nothing). These are server
  facts; this remote is unaffected at the code level but its `/bff/user/**`
  traffic flows through that corrected gateway.

## Roadmap

Mostly platform-level work that touches this remote but is **not shipped
here**, marked per the status legend; a few items below ARE shipped here (✅)
because they only became real once the platform-wide dependency landed —
those are called out explicitly rather than left in a separate list.

- 🚧 **End-to-end SSO + e2e** — login-ui Casdoor OIDC → user-bff custody →
  opaque `bff_` session, with the gateway `bff_`→JWT exchange filter, is being
  driven live end-to-end (incl. the user-console e2e harness above). The
  interceptor + `SessionService` are this remote's client-side touchpoints.
- ✅ **Bearer token removed from the browser (shipped here).** This remote is
  cut over to the HttpOnly `bff_` cookie model
  described in [Request authentication](#request-authentication-httponly-cookie-no-browser-held-bearer):
  `authInterceptor` sends `withCredentials: true` and no longer reads or
  attaches a bearer, and `SnapSession` no longer has a token field at all —
  only `id`/`label`/`provider`/`roles`/`registrationComplete` remain in
  `localStorage`. This supersedes an earlier plan to move the bearer out of
  `localStorage` for this remote: there is no bearer left in the browser to
  move.
- 🔭 **Dynamic DB-hosted federation** — DB-served remote URLs wired through
  ArgoCD + the gateway route-access (see [Federation](#federation)); this
  remote's `federation.config.js` / `federation-base.js` are the integration
  points.
- ✅ **Notifications — SSE stream (shipped here).** `GET /bff/user/notifications/events`
  is available on user-bff-api's `main` branch, and this remote consumes it:
  `NotificationsService.startLive()`/`stopLive()` (called from
  `NotificationsComponent`'s `ngOnInit`/`ngOnDestroy`) subscribe via cookie-auth
  `fetch()` + `ReadableStream` line parsing (NOT the native `EventSource` API —
  this platform's browser holds no bearer token to attach, only the HttpOnly
  `bff_` cookie, which `fetch(..., { credentials: 'include' })` sends
  automatically). New events prepend into the same `notifications$`
  `BehaviorSubject` `list()`/`markRead()` already feed, so the inbox updates in
  real time without a manual reload. A dropped connection (idle-timeout close,
  network error, non-2xx) retries on a fixed backoff and `liveStatus$` reports
  `degraded` for the honest duration the feed is NOT live — the component
  surfaces this as a `role="status"` banner rather than silently showing a
  quietly-stale list. **Wire-format note:** Spring WebFlux's
  `ServerSentEventHttpMessageWriter` (verified by disassembling the exact
  `spring-web-7.0.8.jar` this platform ships) emits `data:` fields with **no**
  space before the JSON payload — this client's line parser is spec-compliant
  (splits on the first colon, strips at most one leading space) rather than
  requiring an exact `"data: "` prefix.
- ✅ **Notification toast (host-shell) — shipped in
  [`hugmesh-host-shell`](https://github.com/hugmesh-net/hugmesh-host-shell).**
  `NotificationToastService` subscribes to the same SSE stream and renders a
  toast when a real-time notification arrives, independently of this remote
  (separate module-federation bundle). This remote's `unreadCount$` signal
  remains the badge integration point.
- 🚧 **Notifications — external channels** — ✅ the in-app notification **inbox**
  (`/notifications`) and per-category **opt-in toggles** (`/notification-preferences`,
  with `account-restriction` forced-on) now ship in the user console (see the
  route table + datastore services). Still in-flight platform-wide: the
  external-channel adapters (Matrix DM / Akkoma feed / phpBB / email) the
  in-app preferences will eventually fan out to.
- 🔭 **Casdoor MFA / step-up** — design-complete WebAuthn + TOTP + recovery with
  per-role defaults, `gateway_route_access.mfa_required` (fail-closed) and
  BFF-driven challenge stamping `mfa_satisfied` into the opaque BFF session. If
  MFA enrollment / step-up surfaces in the user console, it belongs here —
  **not** present in this repo's code today.
- 🔭 **Encrypted versioned backups, egress VPN, per-node attached storage,
  desktop app governance, workload console, device-license registry, games
  app-store, A/V via coturn/TURN** — platform initiatives that may surface
  user-facing controls later; none present in this repo today.

## Deferrals

- **KaTeX fonts in the sandbox — minimal subset inlined, the rest still
  deferred.** The null-origin `srcdoc` iframe cannot fetch KaTeX's web fonts
  over the network, so `scripts/gen-katex-css.mjs` now base64 data-URI-inlines
  a **minimal 7-font subset** (KaTeX Main regular/bold/italic/bold-italic,
  Math-Italic, Size1/Size2 — see **MathTeX** above) directly into
  `katex-css.ts`, covering the vast majority of simple arithmetic/algebra a
  card author is likely to write. The other 13 upstream `@font-face`s (AMS,
  Caligraphic, Fraktur, Script, SansSerif, Typewriter, Size3/4, …) are still
  `@font-face`-stripped to keep this bundle from growing meaningfully for
  rarely-used symbol sets — math using those falls back to the system
  serif/sans (the MathML a11y layer is unaffected either way). A future option
  is to inline more of the remaining 13 if a symbol-set gap turns out to
  matter in practice.
- **CDK drag overlay styles** — the `.cdk-drag-preview` element CDK appends to
  `document.body` during a drag is outside the component's view encapsulation, so
  its drop-shadow polish is best-effort; reordering itself works fully via
  pointer, the drag handle, and the Move up/down buttons.
- **Typed client migration is eight-of-nine.** The generated `ng-openapi-gen`
  client (`src/app/api`) is wired into `UserProfileService`, `CardsService`,
  `BlockService`, `SelfSilenceService`, `ConnectedClientsService`,
  `PreferencesService`, `SessionsService`, and `NotificationsService`. What is
  still hand-rolled, and why:
  - **`NotificationPreferencesService` (whole service).** user-bff-api has two
    distinct nested records both named `PreferenceUpsert`
    (`UserPreferencesController`'s `{key, value}` and
    `NotificationPreferenceController`'s `{category, enabled}`) and springdoc
    collapses them into one `#/components/schemas/PreferenceUpsert`. The
    generated `put1()` is therefore typed `{key, value}` and would send the
    wrong body to a controller that requires `category` + `enabled`. Fix the
    ambiguity on the BFF (e.g. `@Schema(name = …)`), re-run `npm run gen:spec`,
    then migrate. Also noted while migrating the rest: the spec and the
    controller both return `Map<String, Boolean>` here, not the
    `NotificationPreference[]` this service models — a separate defect.
  - **`UserProfileService.uploadAvatar`.** `multipart/form-data` file posts are
    not modelled cleanly by ng-openapi-gen.
  - **`CardsService.readBody`.** The BFF declares that response as
    `application/octet-stream` / `format: byte`, so the generated
    `fn/cards/body.ts` requests `responseType: 'blob'` while typing the result
    `string` — the Edit pre-fill would get a `Blob` where it expects text.
  - **`NotificationsService.startLive`.** The `text/event-stream` endpoint has
    no generated counterpart, and needs `fetch()` + `ReadableStream` for the
    cookie-authenticated stream anyway.
- **`renderMarkdown`/`buildPreviewDoc` (`card-sanitize.ts`) — dead-code
  candidate, deliberately NOT removed here.** Grep confirms `CardEditorComponent`
  (the only editor shipped) calls `buildCardPreview` exclusively; the
  markdown-body single-editor path these two functions serve was superseded by
  the section-model editor. They are unreachable from any shipped UI code path,
  but each still has dedicated, non-trivial security tests in
  `card-sanitize.spec.ts` (XSS-escaping, `javascript:` link stripping) that
  were never removed alongside the migration. Flagging rather than deleting,
  as a deliberately conservative choice — this is a documented candidate for
  removal, not an oversight.

## Related HugMesh repositories

This remote is one piece of the larger [HugMesh](https://github.com/hugmesh-net)
platform. Repositories referenced throughout this document:

| Repository | Role |
| --- | --- |
| [`hugmesh-host-shell`](https://github.com/hugmesh-net/hugmesh-host-shell) | The shell application that federates and mounts this and every other remote at runtime |
| [`hugmesh-user-bff-api`](https://github.com/hugmesh-net/hugmesh-user-bff-api) | This remote's paired backend-for-frontend — the `/bff/user/**` surface |
| [`login-ui`](https://github.com/hugmesh-net/login-ui) | Performs the Casdoor OIDC sign-in redirect on behalf of every remote |
| [`hugmesh-auth-core`](https://github.com/hugmesh-net/hugmesh-auth-core) | Shared account/session/MFA/Casdoor-admin library consumed by the user and admin BFFs |
| [`hugmesh-generator`](https://github.com/hugmesh-net/hugmesh-generator) | Platform code generator and shared CI templates, including the centralized pen-test stage this repo's pipeline extends |

## Contributing

Issues and pull requests are welcome. Before opening a PR:

1. Run `npm test` and, if you touched the e2e harness, `npx playwright test --list`
   from `e2e/` (see [`e2e/README.md`](e2e/README.md)) to confirm the suites still
   pass/compile.
2. Keep the sandboxing model in mind for any change touching card rendering —
   see [Sandboxing model](#sandboxing-model-defence-in-depth) — and add or update
   the corresponding unit tests in `card-sanitize.spec.ts` / `card-tags.spec.ts` /
   `card-math.spec.ts`.
3. Describe the change and, where relevant, which route(s) or datastore
   service(s) it affects.

## License

MIT — see [`LICENSE`](LICENSE).

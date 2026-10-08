# hugmesh-user-ui — e2e (Playwright + playwright-bdd)

Gherkin/BDD e2e harness for the **user-ui** native-federation remote — the
**self-service** surface where every resource is `owner == subject`. It copies
the `hugmesh-games/e2e` pattern and mirrors the merged wave-2b-1 PRs
(admin-ui#39, superadmin-appstore-ui#2, login-ui#19).

## Ships dark (wave 2b)

Any scenario that needs a live stack (host shell, `user-bff-api`, Casdoor seed)
is tagged **`@cluster`** at the feature level. That is 18 of the 20 features.
The other two, `profile-edit-client-side.feature` and
`recommend-gate-client-side.feature`, need no backend.

`playwright.config.ts` filters `@cluster` out with `tags: 'not @cluster'`, so
the **default run needs no cluster**. Offline, the harness still proves that the
Gherkin **compiles** and the scenarios are **discoverable**.

`@cluster` is a plain filter tag. It is not playwright-bdd's reserved `@skip`,
which drops a scenario from generation entirely: `--list` would show 0 and we
could not prove the features parse.

## Test honesty rules this suite follows

- **Victim-creates-first** — every cross-user DENY attacks a REAL id or slug the
  victim created (or captured) in the same scenario. The victim re-reads it
  untouched afterwards. A 404 on a made-up id proves nothing.
- **Real sessions for real writes** — scenarios that exercise the BFF log in
  through Casdoor (`is logged in in their own context`), so the HttpOnly `bff_`
  cookie rides every fetch (the browser holds no bearer since PRs #31/#32).
  Seeded `hug.session` localStorage sessions are ONLY for pure client-side
  behaviour (role-signal gates, a11y).
- **Bounded waits, never sleeps** — cross-user readbacks poll through the
  `expect.poll`-style helpers in `tests/helpers/poll.ts`
  ("X appears in \<ctx\>'s list within Ns").
- **One context per persona** — `_registry.ts` holds `pageRegistry` and
  `ctxRegistry`; the After hook closes the contexts.

## Coverage — the three classes + elevated roles + a11y

| Area | Feature | Class |
| --- | --- | --- |
| `features/self-service/self-service-surfaces.feature` | each owner==subject view ALLOW; connected-apps **disabled+helptext** DENY surface and the granted-branch ALLOW; the signed-out login bounce; the recommend-instance-block REAL submit and API echo | USER-SITUATIONAL |
| `features/self-service/cards-lifecycle.feature` | REAL editor publish; internal (draft) cards invisible to peers on every read channel (no content leak on any status); a published card read by its designed admin cross-owner reader (visibility-independent by design) and refused 401 when signed out (no anonymous card serving exists) | USER-SITUATIONAL |
| `features/self-service/profile-edit-client-side.feature` | profile-editor behaviour that never touches the BFF (form validation, a11y screen-reader-name preview, optimistic default-fill, avatar file-type/size gate); ships **untagged** (no `@cluster`) and runs against a plain `ng serve` with no backend | USER-SITUATIONAL |
| `features/self-service/profile-preferences-notifications.feature` | REAL persist round-trips (reload and read back, not just "the form submitted"): profile `displayName` save, `/preferences` `media.poison.default` select, notification-preferences toggles | USER-SITUATIONAL |
| `features/self-service/profile-account-actions.feature` | the other backend-dependent profile fields (visibility/pronouns/timezone/vanity subdomain) as a reload-readback round-trip, plus avatar upload (`POST /bff/user/profile/avatar` → `avatarUrl` replaces the local preview) | USER-SITUATIONAL |
| `features/self-service/notifications-seeded-inbox.feature` | inbox mark-as-read and unread count, proven as a before/after **delta** over a REAL row made through the test-seed endpoint (ships dark behind `app.test-seed.enabled`) | USER-SITUATIONAL |
| `features/self-service/recommend-gate-client-side.feature` | the recommend-instance-block form for a user WITHOUT a Matrix/Mastodon platform role: gate notice, `aria-disabled` plus `aria-describedby` helptext (not native `disabled`), and nothing is sent; ships **untagged**, no backend | USER-SITUATIONAL |
| `features/self-service/cards-edit-delete.feature` | card Edit pre-fill restores the exact prior sections and CSS (`readBody` then `decodeDocument`); republish adds a version (a `versionDir` delta); Delete removes the row server-side, proven after a reload | USER-SITUATIONAL |
| `features/self-service/home-guide-dismissal.feature` | the getting-started guide: the dismiss write, persistence across a reload, show-again, and propagation to a second device; each scenario restores the guide | USER-SITUATIONAL |
| `features/self-service/notification-preferences-delivery.feature` | the effect of a toggle, not its stored value: a muted category is not delivered (the seed reports `delivered=false` and the inbox never carries the row), and forced-on `account-restriction` is delivered after an attempted opt-out | USER-SITUATIONAL |
| `features/self-service/profile-preferences-coverage.feature` | the fields the other persist suites skip: `gender`, an explicit `screenReaderName`, the `infra-impacting` and `feature-availability` categories, and `account-restriction` shown forced-on and locked | USER-SITUATIONAL |
| `features/self-service/self-silence-ui-lifecycle.feature` | self-silence through the real form: local-to-ISO time conversion, future-time validation, active readback with wake time, the `aria-disabled` activate gate, cancel; each scenario re-reads the server status | USER-SITUATIONAL |
| `features/self-service/sessions-lifecycle.feature` | the `/sessions` view: the "This device" marker, revoke through the UI, revoking another device's session signs that device out (its next `/bff` call returns 401), and a second user is denied revoking it (404) | USER-SITUATIONAL |
| `features/multiuser/own-resource-management.feature` | two users manage their OWN lists concurrently; both REALLY publish cards; self-silence independence (hiding one user changes nothing for the other) | MULTIUSER-SITUATIONAL |
| `features/cross-user/owner-subject-isolation.feature` | victim-creates-first DENYs on blocks/cards/connected-clients; self-silence subject-only independence; unauthenticated → 401 | CROSS-USER isolation |
| `features/cross-user/preferences-notifications-isolation.feature` | preferences, notification-preferences and notifications are scoped EXCLUSIVELY from the JWT subject server-side (no owner id to attack); proven by two real parallel sessions that each read only their own resource | CROSS-USER isolation |
| `features/cross-user/notifications-seeded-isolation.feature` | the same proof for an inbox that HAS a row (made through the test-seed endpoint): victim-creates-first, each DENY paired with the victim's own unaffected re-read | CROSS-USER isolation |
| `features/cross-user/platform-role-deny-floors.feature` | the API floors behind the disabled controls: without a platform role a user cannot create a matrix or mastodon self-block or start the moderation chain; without an external-client role the connected-clients list is refused; each paired with its ALLOW contrast | CROSS-USER / platform roles |
| `features/cross-user/elevated-role-owner-subject.feature` | mod/admin/superadmin get the SAME 404 as a plain user on another user's blocks/sessions/silence (owner==subject has no role override), plus the own-resource ALLOW halves | CROSS-USER / elevated roles |
| `features/a11y/accessibility.feature` | skip-link/focusable main, named landmarks, polite live regions, describedby helptext, tab order | A11Y |

## Run

```sh
npm install            # installs @playwright/test + playwright-bdd
npx bddgen             # compile .feature -> .features-gen/*.spec.js (default: not @cluster)
npx playwright test --list   # discover scenarios (no cluster needed)
```

To check that every scenario parses, `@cluster` ones included, generate with no
tag filter:

```sh
cat > pw-validate.config.ts <<'EOF'
import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
const d = defineBddConfig({ features: 'features/**/*.feature',
  steps: ['features/steps/**/*.ts', 'features/support/**/*.ts'] });
export default defineConfig({ reporter: [['list']],
  use: { ignoreHTTPSErrors: true, screenshot: 'on', video: 'on' },
  projects: [{ name: 'bdd', testDir: d, use: { ...devices['Desktop Chrome'] } }] });
EOF
npx bddgen -c pw-validate.config.ts
npx playwright test --list -c pw-validate.config.ts
rm pw-validate.config.ts
```

### Live run (later wave)

Drop a feature's `@cluster` tag, export the seed-user passwords
(`E2E_ALICE_PASSWORD`, `E2E_BOB_PASSWORD`, `E2E_CAROL_PASSWORD`,
`E2E_DAVE_PASSWORD`, `E2E_ERIN_PASSWORD`, `E2E_MOD_PASSWORD`,
`E2E_ADMIN_PASSWORD`, `E2E_SUPERADMIN_PASSWORD`, or a single `E2E_PASSWORD`),
point `E2E_BASE_URL` at the host front door (default
`https://host.docker.internal:8443`), then `npm run bdd`.

The `E2E_<ROLE>_PASSWORD` and `E2E_PASSWORD` variables are optional overrides.
Without them, `passwordFor()` in `tests/helpers/roles.ts` reads the run-state
`.e2e-credentials` file that hugmesh-generator's `make stack-seed` writes. It
looks at `$E2E_CREDENTIALS_FILE`, or at a `.e2e-credentials` found by walking up
from the current directory. The generator writes that file at its own repo
root. In a sibling checkout layout that root is not an ancestor of this repo, so
export `E2E_CREDENTIALS_FILE=<generator>/.e2e-credentials`.

There is no built-in password. If nothing resolves, the suite throws and names
`make stack-seed`, rather than log in with a guessable default.

Live seed prerequisites the features assume. `make stack-seed` seeds
`e2e-user`, `e2e-mod`, `e2e-admin` and `e2e-superadmin`, plus Gmail-style users
named `alice@gmail.com`, `bob@gmail.com`, `carol@gmail.com` and
`dave@gmail.com` (`tests/stack/seed-e2e.sh` and `tests/e2e-extra-personas.sh` in
hugmesh-generator). It does not define `erin`, `mod-user`, `admin-user` or
`superadmin-user`. This suite types `alice`, `bob`, `carol`, `dave`, `erin`,
`mod-user`, `admin-user` and `superadmin-user` into the login form, so make
sure all eight exist in Casdoor before a live run.

- `erin` carries the Matrix PLATFORM role (`ROLE_MATRIX`); the
  recommend-instance-block endpoint is `hasAnyRole('MATRIX','MASTODON')`.
- `carol` has at least one REAL connected client row (connect an external
  client once). Otherwise the cross-user revoke scenario fails loudly instead of
  passing against nothing.
- `mod-user` / `admin-user` / `superadmin-user` carry the matching Casdoor
  roles (plus the `user` floor) and share alice's brand/domain.
- `notifications-seeded-inbox.feature`, `notifications-seeded-isolation.feature`
  and `notification-preferences-delivery.feature` need user-bff-api's
  `app.test-seed.enabled=true` (env `APP_TEST_SEED_ENABLED=true`). Its
  `TestSeedNotificationController` is the only user-reachable way to create a
  real notification row. The production writer is the `ROLE_SERVICE`-gated
  internal deliver endpoint, called by the hugmesh-actions reconciler, not by a
  browser session.

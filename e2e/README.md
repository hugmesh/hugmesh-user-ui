# hugmesh-user-ui — e2e (Playwright + playwright-bdd)

Gherkin/BDD e2e harness for the **user-ui** native-federation remote — the
**self-service** surface where every resource is `owner == subject`. Copied from
the proven `hugmesh-games/e2e` pattern and mirrors the merged wave-2b-1 PRs
(admin-ui#39, superadmin-appstore-ui#2, login-ui#19).

## Ships dark (wave 2b)

Every scenario that needs a live stack (host shell + `user-bff-api` + Casdoor
seed) is tagged **`@cluster`** at the feature level. The default
`playwright.config.ts` filters them out with `tags: 'not @cluster'`, so the
**default run requires no cluster**. The harness still proves the Gherkin
**compiles** and the scenarios are **discoverable** offline.

`@cluster` is a plain filter tag — NOT playwright-bdd's reserved `@skip`, which
would drop a scenario from generation entirely (so `--list` would show 0 and we
could not prove the features parse).

## Test honesty rules this suite follows

- **Victim-creates-first** — every cross-user DENY attacks a REAL id/slug the
  victim created (or captured) in the same scenario, and the victim re-reads it
  untouched afterwards. A 404 on a fabricated id proves nothing.
- **Real sessions for real writes** — scenarios that exercise the BFF log in
  through Casdoor (`is logged in in their own context`) so the HttpOnly `bff_`
  cookie rides every fetch (the browser holds no bearer since PRs #31/#32).
  Seeded `hug.session` localStorage sessions are ONLY for pure client-side
  behaviour (role-signal gates, a11y).
- **Bounded waits, never sleeps** — cross-user readbacks poll via the
  `expect.poll`-style helpers in `tests/helpers/poll.ts`
  ("X appears in \<ctx\>'s list within Ns").
- **One context per persona** — `_registry.ts` pageRegistry/ctxRegistry;
  contexts are closed in the After hook.

## Coverage — the three classes + elevated roles + a11y

| Area | Feature | Class |
| --- | --- | --- |
| `features/self-service/self-service-surfaces.feature` | each owner==subject view ALLOW; connected-apps **disabled+helptext** DENY surface + the granted-branch ALLOW; the true signed-out login bounce; the recommend-instance-block REAL submit + API echo | USER-SITUATIONAL |
| `features/self-service/cards-lifecycle.feature` | REAL editor publish; internal (draft) cards invisible to peers on every read channel (no content leak on any status); a published card read by its designed admin cross-owner reader (visibility-independent by design) and 401-refused signed-out (no anonymous card serving exists) | USER-SITUATIONAL |
| `features/self-service/profile-edit-client-side.feature` | profile-editor behaviour that never touches the BFF (form validation, a11y screen-reader-name preview, optimistic default-fill, avatar file-type/size gate) — ships **untagged** (no `@cluster`), runs against a plain `ng serve` with no backend | USER-SITUATIONAL |
| `features/self-service/profile-preferences-notifications.feature` | REAL persist round-trips (reload-and-readback, not just "the form submitted"): profile `displayName` save, `/preferences` `media.poison.default` select, notification-preferences toggles | USER-SITUATIONAL |
| `features/self-service/profile-account-actions.feature` | the remaining backend-dependent profile fields (visibility/pronouns/timezone/vanity subdomain) as a reload-readback round-trip, plus avatar upload (`POST /bff/user/profile/avatar` → `avatarUrl` replaces the local preview) | USER-SITUATIONAL |
| `features/self-service/notifications-seeded-inbox.feature` | notification inbox mark-as-read + unread-count, proven as a before/after **delta** over a REAL row created via the test-seed endpoint (ships dark behind `app.test-seed.enabled`) | USER-SITUATIONAL |
| `features/multiuser/own-resource-management.feature` | two users manage their OWN lists concurrently; both REALLY publish cards; self-silence independence (one user hidden changes nothing for the other) | MULTIUSER-SITUATIONAL |
| `features/cross-user/owner-subject-isolation.feature` | victim-creates-first DENYs on blocks/cards/connected-clients; self-silence subject-only independence; unauthenticated → 401 | CROSS-USER isolation |
| `features/cross-user/preferences-notifications-isolation.feature` | preferences / notification-preferences / notifications are scoped EXCLUSIVELY from the JWT subject server-side (no addressable owner id to attack) — proven via two real parallel sessions each reading only their own resource | CROSS-USER isolation |
| `features/cross-user/notifications-seeded-isolation.feature` | extends the isolation proof to an inbox that actually HAS a row (via the test-seed endpoint): victim-creates-first, each DENY paired with the victim's own unaffected re-read | CROSS-USER isolation |
| `features/cross-user/elevated-role-owner-subject.feature` | mod/admin/superadmin get the SAME 404 as a plain user on another user's blocks/sessions/silence (owner==subject has no role override), plus the own-resource ALLOW halves | CROSS-USER / elevated roles |
| `features/a11y/accessibility.feature` | skip-link/focusable main, named landmarks, polite live regions, describedby helptext, tab order | A11Y |

## Run

```sh
npm install            # installs @playwright/test + playwright-bdd
npx bddgen             # compile .feature -> .features-gen/*.spec.js (default: not @cluster)
npx playwright test --list   # discover scenarios (no cluster needed)
```

To prove EVERY scenario parses (including the `@cluster` ones), generate with no
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
point `E2E_BASE_URL` at the host front door, then `npm run bdd`.

The per-user `E2E_<ROLE>_PASSWORD` / shared `E2E_PASSWORD` env vars above are
optional overrides, not requirements: `tests/helpers/roles.ts` (`passwordFor()`)
falls back to the run-state `.e2e-credentials` file written by
hugmesh-generator's `make stack-seed` (`$E2E_CREDENTIALS_FILE`, or a
`.e2e-credentials` found by walking up from cwd). The generator writes that file
at its own repo root, which is NOT an ancestor of this repo in a sibling
checkout layout — there, export `E2E_CREDENTIALS_FILE=<generator>/.e2e-credentials`.
There is no built-in literal
password — if nothing resolves, the suite throws naming `make stack-seed`
rather than silently authenticating with a guessable default.

Live seed prerequisites the features assume:

- `erin` carries the Matrix PLATFORM role (`ROLE_MATRIX`) — the
  recommend-instance-block endpoint is `hasAnyRole('MATRIX','MASTODON')`.
- `carol` has at least one REAL connected client row (connect an external
  client once); the cross-user revoke scenario fails loudly otherwise instead
  of passing against nothing.
- `mod-user` / `admin-user` / `superadmin-user` carry the matching Casdoor
  roles (plus the `user` floor) and share alice's brand/domain.
- `notifications-seeded-inbox.feature` and `notifications-seeded-isolation.feature`
  need user-bff-api's `app.test-seed.enabled=true` (its `TestSeedNotificationController`
  is the only user-reachable way to create a real notification row — the
  production writer is the `ROLE_SERVICE`-gated internal deliver endpoint,
  called by the hugmesh-actions reconciler, not a browser session).

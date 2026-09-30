import * as fs from 'fs';
import * as path from 'path';
import { Browser, BrowserContext, Page } from '@playwright/test';

/**
 * Catalogue of Casdoor seed users for the user-ui e2e matrix. Adapted from the
 * proven hugmesh.games/e2e helper (and mirrored on the merged admin-ui#39
 * harness), but keyed to THIS app's session model: the user-ui (and its host)
 * persist a {@link SnapSession} under the `hug.session` localStorage key (see
 * src/app/session.service.ts), whose `roles: string[]` drives the lowercased,
 * Casdoor-derived role signals — isUser / isAdmin / isMod and the
 * external-client flags (matrix_external_client / mastodon_external_client) that
 * gate the connected-apps surface.
 *
 * The user-ui is the SELF-SERVICE surface: every resource is owner==subject, so
 * there are no in-remote role guards — the hugmesh.net host enforces
 * ROLE_USER, and the user-bff-api re-enforces owner==subject on every
 * `/bff/user/**` call. The catalogue therefore exercises the THREE coverage
 * classes through that lens:
 *   - USER-SITUATIONAL  — a user reaches each of their OWN self-service surfaces
 *                         (ALLOW); the connected-apps action is disabled+helptext
 *                         when the external-client role is absent (DENY surface).
 *   - MULTIUSER         — two users each manage their own resources concurrently
 *                         without colliding (each sees only their own list).
 *   - CROSS-USER        — user-b cannot read or mutate user-a's resource via the
 *                         BFF (owner==subject -> 403/404, fail-closed), an
 *                         unauthenticated client is rejected (401), AND an
 *                         ELEVATED role (mod/admin/superadmin) is bound by the
 *                         same owner==subject rule on strictly-personal
 *                         resources (self-blocks, login sessions, self-silence).
 *
 * The `kind` tag selects which role-specific assertions a feature drives.
 * Passwords resolve via {@link passwordFor} — per-user override env, then the
 * shared `E2E_PASSWORD` env, then the run-state credentials file that
 * `make stack-seed` (hugmesh-generator) writes. There is no literal fallback:
 * an unresolved password throws rather than silently authenticating with a
 * guessable default.
 */
export type RoleKind =
  | 'user'
  | 'platform-user'
  | 'external-client'
  | 'mod'
  | 'admin'
  | 'superadmin';

export interface SeedUser {
  /** CLI-friendly username referenced from .feature lines. */
  username: string;
  /** env var the compose overlay routes the cred through. */
  passwordEnv: string;
  /** Identity provider — user-ui sessions are google- or discord-backed. */
  provider: 'google' | 'discord';
  /** The lowercased Casdoor roles this user carries in `hug.session.roles`. */
  roles: string[];
  /** Drives role-specific assertions. */
  kind: RoleKind;
}

export const SEED_USERS: SeedUser[] = [
  // ── Plain users — the self-service floor. Casdoor always grants 'user'; the
  //    user-bff-api gates every surface on hasRole('USER') and scopes the read
  //    to the subject. `alice` and `bob` are two DISTINCT owners — the
  //    cross-user isolation specs assert each is DENIED on the other's resource.
  { username: 'alice', passwordEnv: 'E2E_ALICE_PASSWORD', provider: 'google',  roles: ['user'], kind: 'user' },
  { username: 'bob',   passwordEnv: 'E2E_BOB_PASSWORD',   provider: 'discord', roles: ['user'], kind: 'user' },

  // ── Homeserver-platform user — carries the Matrix PLATFORM access role
  //    ('matrix' ⇐ ROLE_MATRIX). The recommend-instance-block endpoint is gated
  //    hasAnyRole('MATRIX','MASTODON') server-side (BlockController), so only a
  //    platform participant may start the USER→MOD→ADMIN chain — `erin` drives
  //    that ALLOW half.
  { username: 'erin', passwordEnv: 'E2E_ERIN_PASSWORD', provider: 'google', roles: ['user', 'matrix'], kind: 'platform-user' },

  // ── External-client user — additionally carries a Matrix external-client role,
  //    so the connected-apps surface is ENABLED for them (the ALLOW half of the
  //    connected-apps disabled+helptext gate). `carol` exercises the granted
  //    branch of ConnectedAppsComponent.
  { username: 'carol', passwordEnv: 'E2E_CAROL_PASSWORD', provider: 'google', roles: ['user', 'matrix_external_client'], kind: 'external-client' },

  // ── A mastodon external-client user — the OTHER external-client branch, so the
  //    disabled+helptext gate is proven against BOTH external-client markers.
  { username: 'dave', passwordEnv: 'E2E_DAVE_PASSWORD', provider: 'discord', roles: ['user', 'mastodon_external_client'], kind: 'external-client' },

  // ── ELEVATED roles — the P4 owner==subject completion. On the SELF-SERVICE
  //    surface an elevated role changes NOTHING for strictly-personal resources:
  //    /bff/user/blocks, /bff/user/sessions and /bff/user/self-silence derive
  //    the owner from the JWT subject ONLY (never a path/body field), so an
  //    admin addressing another user's real resource id gets the SAME 404 a
  //    plain user gets. These personas prove that (each also carries 'user' —
  //    Casdoor always grants the floor role, and the host role-home requires it).
  { username: 'mod-user',        passwordEnv: 'E2E_MOD_PASSWORD',        provider: 'discord', roles: ['user', 'mod'],                 kind: 'mod' },
  { username: 'admin-user',      passwordEnv: 'E2E_ADMIN_PASSWORD',      provider: 'google',  roles: ['user', 'admin'],               kind: 'admin' },
  { username: 'superadmin-user', passwordEnv: 'E2E_SUPERADMIN_PASSWORD', provider: 'google',  roles: ['user', 'admin', 'superadmin'], kind: 'superadmin' },
];

/**
 * Walk up from `dir` looking for `filename`, the way you'd look for a `.git`
 * or `package.json` root. This repo is a CONSUMER of hugmesh-generator's
 * credentials file, not the generator: Playwright runs in its own process
 * (possibly its own container) and may be invoked with `cwd` at the repo root
 * or at `e2e/`, either of which the generator could consider "here" when it
 * wrote `.e2e-credentials`. Returns `undefined` — never throws — when the walk
 * reaches the filesystem root without a match.
 */
function findUpward(filename: string, dir: string): string | undefined {
  for (;;) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * The run-state credentials file path to use: `E2E_CREDENTIALS_FILE` verbatim
 * if set (its existence is checked when reading, not here — an explicit path
 * that doesn't exist yet should show up in the error message, not be silently
 * swapped for something else), otherwise the nearest `.e2e-credentials`
 * walking up from `cwd`, otherwise the conventional `<cwd>/.e2e-credentials`
 * path (used only for the "not found" error message).
 */
function credentialsFilePath(): string {
  return (
    process.env['E2E_CREDENTIALS_FILE']
    || findUpward('.e2e-credentials', process.cwd())
    || path.join(process.cwd(), '.e2e-credentials')
  );
}

/**
 * Parse the plain `KEY=value` run-state credentials file written by
 * hugmesh-generator's `e2e_password_ensure()` (`tests/stack/e2e-password.sh`
 * in that repo — no quoting, no `export` keyword, so it also sources with
 * `set -a; . file; set +a` and loads via `docker compose --env-file`).
 *
 * A MISSING file (`ENOENT`) is the expected, common case — a fresh checkout
 * before anyone has run `make stack-seed` — so this returns an empty map
 * rather than throwing; the caller turns "nothing resolved" into one clear
 * error. Any other read error (e.g. `EACCES` on a root-owned mode-600 file
 * left by a sudo'd `make e2e`) is rethrown: reporting it as "key not found"
 * would point the user at the wrong remedy.
 */
function readCredentialsFile(filePath: string): Map<string, string> {
  const values = new Map<string, string>();
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return values;
    }
    throw new Error(
      `cannot read the run-state credentials file ${filePath}: ${(err as Error).message}`,
    );
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      continue;
    }
    values.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return values;
}

/**
 * Resolve a seed user's password. Precedence (Rule 4 of the random-password
 * contract — consumers RESOLVE, they never invent):
 *
 *   1. the per-user override, `process.env[user.passwordEnv]`
 *   2. the shared override/propagation var, `process.env.E2E_PASSWORD`
 *   3. the run-state credentials file (`E2E_CREDENTIALS_FILE` or a
 *      `.e2e-credentials` walked up from `cwd`), checked under the same two
 *      keys in the same order
 *
 * If none of those resolve, this THROWS — naming `make stack-seed` and the
 * file path it looked for — instead of ever falling back to a literal. A
 * silent literal default is the exact bug this replaces: it would let a
 * misconfigured run authenticate with a guessable password and still go
 * green.
 */
export function passwordFor(user: SeedUser): string {
  const perUser = process.env[user.passwordEnv];
  if (perUser) {
    return perUser;
  }

  const shared = process.env['E2E_PASSWORD'];
  if (shared) {
    return shared;
  }

  const filePath = credentialsFilePath();
  const fromFile = readCredentialsFile(filePath);
  const fileValue = fromFile.get(user.passwordEnv) ?? fromFile.get('E2E_PASSWORD');
  if (fileValue) {
    return fileValue;
  }

  throw new Error(
    `No e2e password for seed user "${user.username}": neither $${user.passwordEnv} nor $E2E_PASSWORD is ` +
      `set, and neither key was found in the run-state credentials file (${filePath}). Run \`make stack-seed\` ` +
      `(hugmesh-generator) to seed the stack and write that file, or export E2E_CREDENTIALS_FILE to point at ` +
      `wherever it was written, then re-run.`,
  );
}

/**
 * Create a fresh browser context that trusts the e2e self-signed cert AND uses
 * the same baseURL as the playwright config. The default `browser.newContext()`
 * does NOT inherit project-level `use` options (Playwright design choice), so a
 * spec that opens a manual context misses `ignoreHTTPSErrors: true` and every
 * HTTPS request fails the cert check — the native-federation manifest fetch is
 * the first casualty. Specs that need multiple users in parallel (the cross-user
 * isolation matrix) MUST call this instead of `browser.newContext()`.
 */
export async function newE2eContext(browser: Browser): Promise<BrowserContext> {
  return await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: process.env.E2E_BASE_URL ?? 'https://host.docker.internal:8443',
  });
}

/**
 * Drive the federated login form and wait for `hug.session` in localStorage.
 *
 * @cluster-only — this helper hits a LIVE Casdoor + host shell, so it is only
 * exercised by scenarios tagged `@cluster` today (the wave ships dark). It is
 * written now so a later wave can un-tag a feature without rewriting steps.
 *
 * The user-ui's host shell renders the login micro-frontend; on success the
 * SessionService writes `hug.session` (see set()/broadcast()) and the gateway
 * sets the HttpOnly `bff_` cookie via Set-Cookie. We wait for the non-secret
 * `hug.session` key to appear so a follow-up guarded navigation doesn't race
 * the write — the bearer no longer lives in the browser (PRs #31/#32); every
 * /bff/** call authenticates via the cookie the login response set on this
 * context.
 */
export async function login(page: Page, user: SeedUser): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  // The login remote exposes its form via formControlName selectors (the public
  // selector contract shared across the HugMesh UIs).
  await page.locator('input[formControlName="username"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.fill('input[formControlName="username"]', user.username);
  await page.fill('input[formControlName="password"]', passwordFor(user));
  await page.click('button.login-btn');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const raw = window.localStorage.getItem('hug.session');
      if (!raw) return false;
      try {
        return Boolean(JSON.parse(raw).id);
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 15_000 },
  );
}

/**
 * Seed a {@link SnapSession} directly into localStorage WITHOUT a Casdoor round
 * trip. Mirrors the shape SessionService.set() writes (id, label, provider,
 * roles, registrationComplete — NO token: since PRs #31/#32 the browser holds
 * only the HttpOnly `bff_` cookie), so the role signals (isUser /
 * hasExternalClientRole) behave exactly as in production. Used by the
 * offline/dark scenarios that assert pure client-side behaviour (skip-link
 * focus, the connected-apps disabled+helptext gate) without needing the BFF.
 * Scenarios that EXERCISE the BFF must use login() instead — a seeded
 * localStorage session carries no cookie, so every /bff/** call would 401.
 */
export async function seedSession(page: Page, user: SeedUser): Promise<void> {
  const session = {
    id: `${user.provider}:${user.username}@example.test`,
    label: user.username,
    provider: user.provider,
    roles: user.roles,
    registrationComplete: true,
  };
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    ['hug.session', JSON.stringify(session)] as const,
  );
}

/** Clear the session — used between role swaps so a stale identity doesn't carry
 *  into the next scenario's check. */
export async function clearSession(page: Page): Promise<void> {
  await page.evaluate(() => window.localStorage.removeItem('hug.session'));
}

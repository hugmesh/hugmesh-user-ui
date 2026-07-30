// Session / login / navigation step definitions backing the user-ui features.
//
// Two flavours of "logged in":
//   - `Given "X" is logged in`         — full Casdoor round-trip via login()
//     (LIVE; only reached by @cluster scenarios — the wave ships dark). The
//     login response sets the HttpOnly `bff_` cookie on the context, so every
//     subsequent /bff/** fetch from that page authenticates for real.
//   - `Given "X" has a seeded session` — writes hug.session directly via an
//     addInitScript (OFFLINE-capable; exercises the pure client-side behaviour
//     the SessionService role signals drive — e.g. the connected-apps
//     disabled+helptext gate). A seeded session carries NO cookie, so it must
//     never be used by a step that asserts a BFF success.
//
// The user-ui is the SELF-SERVICE remote: it has no in-remote role guards (the
// host enforces ROLE_USER), so navigation simply mounts the addressed
// self-service view. The DENY surface here is owner==subject: the user-bff-api
// re-enforces it on every /bff/user/** call, so a cross-user read/mutate returns
// 403/404 even if the UI were bypassed. All such steps live in @cluster features
// today because they need the host shell + BFF; bddgen still compiles them so
// `--list` proves they parse.

import { expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry, ctxRegistry, responseState } from './_registry';
import {
  SeedUser,
  login,
  seedSession,
  clearSession,
  newE2eContext,
} from '../../tests/helpers/roles';

// ── Session priming ───────────────────────────────────────────────────────

Given('a clean session', async ({ page }) => {
  await clearSession(page);
});

Given('{string} is logged in', async ({ page, user }, username: string) => {
  const u: SeedUser = user(username);
  await login(page, u);
  pageRegistry.set(u.username, page);
});

Given('{string} is logged in in their own context', async ({ browser, user }, username: string) => {
  // REAL login in an isolated context — the cross-user REAL-WRITE matrix. Each
  // identity gets its own cookie jar so several authenticated users coexist in
  // one scenario, each carrying their OWN HttpOnly bff_ cookie.
  const u: SeedUser = user(username);
  const ctx = await newE2eContext(browser);
  const page = await ctx.newPage();
  await login(page, u);
  ctxRegistry.set(u.username, ctx);
  pageRegistry.set(u.username, page);
});

Given('{string} has a seeded session', async ({ page, user }, username: string) => {
  const u: SeedUser = user(username);
  // addInitScript must run BEFORE the first navigation, so register the page and
  // seed; the navigation step that follows picks the session up on load.
  await seedSession(page, u);
  pageRegistry.set(u.username, page);
});

Given('{string} has a seeded session in their own context', async ({ browser, user }, username: string) => {
  // Cross-user / multiuser matrix: give each user an isolated context so two
  // identities can coexist in one scenario without sharing localStorage.
  const u: SeedUser = user(username);
  const ctx = await newE2eContext(browser);
  const page = await ctx.newPage();
  await seedSession(page, u);
  ctxRegistry.set(u.username, ctx);
  pageRegistry.set(u.username, page);
});

Given('{string} has a signed-out context', async ({ browser, user }, username: string) => {
  // The unauthenticated floor: a FRESH context with NO seeded session and NO
  // cookie jar contents. The persona name is only the registry key the follow-up
  // navigation/assertion steps address — nothing about this visitor is
  // authenticated. (This is the honest version of the old "bounce" scenario,
  // which seeded a session first and therefore tested a logged-in render.)
  const u: SeedUser = user(username);
  const ctx = await newE2eContext(browser);
  const page = await ctx.newPage();
  ctxRegistry.set(u.username, ctx);
  pageRegistry.set(u.username, page);
});

// ── Navigation ─────────────────────────────────────────────────────────────

When('{string} navigates to {string}', async ({ user }, username: string, path: string) => {
  const u: SeedUser = user(username);
  const page = pageRegistry.get(u.username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
});

// ── View-rendered assertions (self-service ALLOW) ───────────────────────────

Then('{string} sees the {string} view', async ({ user }, username: string, testid: string) => {
  // ALLOW: the self-service view rendered. Every user view carries a stable
  // data-testid (home-view, profile-view, cards-view, self-block-view,
  // recommend-instance-block-view, self-silence-view, connected-apps-view).
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="${testid}"]`)).toBeVisible({ timeout: 15_000 });
});

Then('{string} does not see the {string} view', async ({ user }, username: string, testid: string) => {
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="${testid}"]`)).toHaveCount(0);
});

Then('{string} is redirected to the login page', async ({ user }, username: string) => {
  // DENY floor: an unauthenticated visit to a host-guarded route settles on
  // /login (the host's ROLE_USER guard returns parseUrl('/login')).
  const page = pageRegistry.get(user(username).username)!;
  await page.waitForURL(/\/login(\?|$)/, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/login(\?|$)/);
});

// ── Element-presence assertions (rows / empty-state / helptext) ─────────────

Then('{string} sees the {string} element', async ({ user }, username: string, testid: string) => {
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="${testid}"]`)).toBeVisible({ timeout: 15_000 });
});

Then('{string} does not see the {string} element', async ({ user }, username: string, testid: string) => {
  // Absence half of a branch assertion (e.g. the granted connected-apps view
  // renders the management surface and the gated button is simply NOT in the
  // DOM).
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="${testid}"]`)).toHaveCount(0);
});

Then('{string} sees help text {string}', async ({ user }, username: string, testid: string) => {
  // A field-help / gate-help span explaining WHY an action is unavailable or
  // what it does — the requirement's "disabled+helptext" pairing.
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.locator(`[data-testid="${testid}"]`)).toBeVisible();
});

// ── Disabled + helptext (the connected-apps ALLOW-but-restricted surface) ────

Then('{string} sees the {string} control disabled', async ({ user }, username: string, testid: string) => {
  // ConnectedAppsComponent uses aria-disabled (NOT native disabled) so the
  // control stays focusable and a screen reader announces the aria-describedby
  // helptext explaining the external-client gate. Assert the a11y contract.
  const page = pageRegistry.get(user(username).username)!;
  const el = page.locator(`[data-testid="${testid}"]`);
  await expect(el).toBeVisible();
  await expect(el).toHaveAttribute('aria-disabled', 'true');
});

Then('{string} sees the {string} control enabled', async ({ user }, username: string, testid: string) => {
  // A real enabled-control assertion (matches the merged admin-ui step): the
  // control is present, natively enabled, AND not aria-disabled — so both the
  // pointer contract and the a11y contract say "usable". (The previous version
  // asserted toBeVisible() AND toHaveCount(0) on the same locator — a
  // contradiction that could never pass against a live stack.)
  const page = pageRegistry.get(user(username).username)!;
  const el = page.locator(`[data-testid="${testid}"]`);
  await expect(el).toBeVisible();
  await expect(el).toBeEnabled();
  await expect(el).not.toHaveAttribute('aria-disabled', 'true');
});

// ── Self-service form interaction (MULTIUSER own-resource management) ────────

When('{string} fills {string} with {string}', async ({ user }, username: string, testid: string, value: string) => {
  const page = pageRegistry.get(user(username).username)!;
  await page.locator(`[data-testid="${testid}"]`).fill(value);
});

When('{string} clicks the {string} control', async ({ user }, username: string, testid: string) => {
  const page = pageRegistry.get(user(username).username)!;
  await page.locator(`[data-testid="${testid}"]`).click();
});

Then('{string} sees a row for {string}', async ({ user }, username: string, value: string) => {
  // Own-resource readback: the just-added self-block / card appears in the
  // user's own list (and ONLY the owner's list — the BFF scopes the read).
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.getByText(value, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
});

Then('{string} does not see a row for {string}', async ({ user }, username: string, value: string) => {
  // MULTIUSER isolation at the display layer: user-b's list never shows
  // user-a's resource because each list is owner-scoped server-side.
  const page = pageRegistry.get(user(username).username)!;
  await expect(page.getByText(value, { exact: true })).toHaveCount(0);
});

// ── API-level cross-user DENY (owner==subject, fail-closed) ──────────────────
// The view is display-only; the user-bff-api is the real gate. These steps fire
// a same-origin fetch with credentials:'include' so the HttpOnly bff_ cookie
// rides the request (the gateway turns it into the bearer server-side) and the
// actual @PreAuthorize(hasRole('USER')) + owner==subject chain is exercised;
// capture the status.

When('{string} GETs {string}', async ({ user }, username: string, path: string) => {
  const page = pageRegistry.get(user(username).username)!;
  responseState.lastStatus = await page.evaluate(
    async (url) => {
      const r = await fetch(url, { credentials: 'include' });
      return r.status;
    },
    path,
  );
});

When('{string} DELETEs {string}', async ({ user }, username: string, path: string) => {
  const page = pageRegistry.get(user(username).username)!;
  responseState.lastStatus = await page.evaluate(
    async (url) => {
      const r = await fetch(url, { method: 'DELETE', credentials: 'include' });
      return r.status;
    },
    path,
  );
});

When('the unauthenticated client GETs {string}', async ({ page }, path: string) => {
  await page.goto('/');
  responseState.lastStatus = await page.evaluate(async (p) => {
    const r = await fetch(p);
    return r.status;
  }, path);
});

Then('the response status is {int}', async ({}, expected: number) => {
  expect(responseState.lastStatus).toBe(expected);
});

Then('the response status is one of {int} or {int}', async ({}, a: number, b: number) => {
  expect([a, b]).toContain(responseState.lastStatus);
});

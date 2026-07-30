// MULTI-DEVICE step definitions — the SAME user signed in from two independent
// browser contexts ("devices"). The cross-user suites cover two DIFFERENT users;
// these cover the two-tab / two-device situations that are their own class of
// behaviour: a durable per-user preference propagating across devices, a login
// session on one device being killed from another, and last-write-wins on a
// whole-model profile save.
//
// Each device gets its OWN BrowserContext (its own cookie jar), so the two
// sessions are genuinely distinct on the server — a real second login, not a
// shared tab. Pages/contexts are registered under a compound "username#device"
// key so the After() hook (fixtures.ts) still tears them down, and so these
// steps never collide with the plain-username registry the single-context steps
// use.
//
// @cluster-only — every step here performs a REAL Casdoor login through the host
// shell, so the scenarios that use them are @cluster (ship dark). bddgen still
// compiles them and `playwright test --list` discovers them.

import { expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry, ctxRegistry, responseState } from './_registry';
import { SeedUser, login, newE2eContext } from '../../tests/helpers/roles';

/** Compound registry key for a specific user's specific device. */
function deviceKey(username: string, device: string): string {
  return `${username}#${device}`;
}

function devicePage(username: string, device: string) {
  const page = pageRegistry.get(deviceKey(username, device));
  if (!page) {
    throw new Error(
      `No page for "${username}" on device "${device}" — add a "is logged in on device" step first.`,
    );
  }
  return page;
}

// ── Device login ────────────────────────────────────────────────────────────

Given(
  '{string} is logged in on device {string}',
  async ({ browser, user }, username: string, device: string) => {
    const u: SeedUser = user(username);
    const ctx = await newE2eContext(browser);
    const page = await ctx.newPage();
    await login(page, u);
    const key = deviceKey(username, device);
    ctxRegistry.set(key, ctx);
    pageRegistry.set(key, page);
  },
);

// ── Device navigation / view assertions ─────────────────────────────────────

When(
  '{string} on device {string} navigates to {string}',
  async ({}, username: string, device: string, path: string) => {
    await devicePage(username, device).goto(path, { waitUntil: 'domcontentloaded' });
  },
);

Then(
  '{string} on device {string} sees the {string} element',
  async ({}, username: string, device: string, testid: string) => {
    await expect(devicePage(username, device).locator(`[data-testid="${testid}"]`)).toBeVisible({
      timeout: 15_000,
    });
  },
);

Then(
  '{string} on device {string} does not see the {string} element',
  async ({}, username: string, device: string, testid: string) => {
    await expect(devicePage(username, device).locator(`[data-testid="${testid}"]`)).toHaveCount(0);
  },
);

When(
  '{string} on device {string} clicks the {string} control',
  async ({}, username: string, device: string, testid: string) => {
    await devicePage(username, device).locator(`[data-testid="${testid}"]`).click();
  },
);

When(
  '{string} on device {string} fills {string} with {string}',
  async ({}, username: string, device: string, testid: string, value: string) => {
    await devicePage(username, device).locator(`[data-testid="${testid}"]`).fill(value);
  },
);

Then(
  '{string} on device {string} sees {string} with value {string}',
  async ({}, username: string, device: string, testid: string, value: string) => {
    await expect(devicePage(username, device).locator(`[data-testid="${testid}"]`)).toHaveValue(value, {
      timeout: 15_000,
    });
  },
);

// ── Login sessions across devices (the cross-device kill) ────────────────────

/** Per-scenario capture of each device's OWN current session id (the row the
 *  BFF marks current=true for that device's cookie). Module-global, reset by the
 *  registry teardown between scenarios via the After() hook clearing nothing here
 *  — so clear it explicitly on capture-collision by keying on device. */
const deviceSessionIds = new Map<string, string>();

Given(
  '{string} on device {string} captures their current session id',
  async ({}, username: string, device: string) => {
    const id = await devicePage(username, device).evaluate(async () => {
      const r = await fetch('/bff/user/sessions', { credentials: 'include' });
      if (!r.ok) throw new Error(`GET /bff/user/sessions -> ${r.status}`);
      const rows = (await r.json()) as Array<{ id?: string; current?: boolean }>;
      // The device's OWN row is the one the BFF flags current for THIS cookie.
      const own = rows.find((s) => s.current) ?? rows[0];
      return own?.id ?? '';
    });
    if (!id) {
      throw new Error(`device "${device}" for "${username}" lists no session id — cannot capture the kill target.`);
    }
    deviceSessionIds.set(deviceKey(username, device), id);
  },
);

Then(
  '{string} on device {string} sees at least {int} session rows',
  async ({}, username: string, device: string, min: number) => {
    const rows = devicePage(username, device).locator('[data-testid="sessions-rows"] tbody tr');
    await expect
      .poll(async () => rows.count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(min);
  },
);

Then(
  '{string} on device {string} sees the this-device marker',
  async ({}, username: string, device: string) => {
    // sessions.component labels the current session "This device (<id>)".
    await expect(
      devicePage(username, device).getByText('This device', { exact: false }).first(),
    ).toBeVisible({ timeout: 15_000 });
  },
);

When(
  '{string} on device {string} revokes device {string} via the sessions UI',
  async ({}, username: string, actingDevice: string, targetDevice: string) => {
    const targetId = deviceSessionIds.get(deviceKey(username, targetDevice));
    if (!targetId) {
      throw new Error(
        `no captured session id for device "${targetDevice}" — add its "captures their current session id" step first.`,
      );
    }
    const page = devicePage(username, actingDevice);
    // Click the REAL revoke button for the target device's row in the acting
    // device's /sessions table (data-revoke carries the session id).
    await page.locator(`[data-testid="session-revoke"][data-revoke="${targetId}"]`).click();
    // The acting device's own list refreshes; the revoked row must be gone.
    await expect(page.locator(`tr[data-session-id="${targetId}"]`)).toHaveCount(0, { timeout: 15_000 });
  },
);

Then(
  '{string} on device {string} can no longer make an authenticated call',
  async ({}, username: string, device: string) => {
    // The end-to-end consequence that makes a revoke REAL: the killed device's
    // cookie no longer authenticates — its next /bff call is rejected (401),
    // not merely absent from a list.
    const status = await devicePage(username, device).evaluate(async () => {
      const r = await fetch('/bff/user/profile', { credentials: 'include' });
      return r.status;
    });
    responseState.lastStatus = status;
    expect(status, "the revoked device's next authenticated call must be rejected (401)").toBe(401);
  },
);

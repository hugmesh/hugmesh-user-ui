// Profile edit / preferences / notification-preferences step definitions —
// REAL persist assertions (reload from the server and read the value back),
// per the wave's honest-test standard: a "saved" message alone never proves a
// write stuck. Mirrors the victim-creates-first uniquification discipline in
// mutation-steps.ts (scenarioState.uniqueNames + scenarioNonce) for the one
// field here that needs it (the profile display name); the preference/toggle
// values are a small closed enum so no uniquification is needed for them —
// each scenario simply asserts the exact value it just set survives a reload.
//
// Markup under test:
//   - profile.component.html: profile-displayName (input), profile-save
//     (button), profile-status (role=status, "Profile saved." on success).
//   - preferences.component.html: prefs-poison-select (select), prefs-status
//     (role=status, "Preference saved." on success). No root data-testid on
//     this component (see the feature file's header note) — the ALLOW-render
//     oracle is the fieldset element, asserted via the existing generic
//     "sees the {string} element" step.
//   - notification-preferences.component.html: notif-pref-toggle-<category>
//     (checkbox), notif-prefs-status (role=status, "Preference saved." on
//     success).

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, scenarioState, scenarioNonce, responseState } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

// ── Profile edit — real save + reload readback ──────────────────────────────

When(
  '{string} sets their display name to {string}',
  async ({ user }, username: string, baseName: string) => {
    // Uniquify so a repeat live run never asserts a stale value left by a
    // previous run against the same seed user.
    const fullName = `${baseName} ${scenarioNonce()}`;
    scenarioState.uniqueNames.set(baseName, fullName);
    await pageOf(user(username).username)
      .locator('[data-testid="profile-displayName"]')
      .fill(fullName);
  },
);

When('{string} saves their profile', async ({ user }, username: string) => {
  await pageOf(user(username).username).locator('[data-testid="profile-save"]').click();
});

Then('{string} sees the profile saved confirmation', async ({ user }, username: string) => {
  // profile-status only carries this exact text after the PUT resolved (the
  // catch branch writes the could-not-save message instead) — a real success
  // oracle, not a render check.
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="profile-status"]'))
    .toHaveText('Profile saved.', { timeout: 15_000 });
  await expect(page.locator('[data-testid="profile-error"]')).toHaveCount(0);
});

Then(
  '{string} sees their display name {string} persisted after reload',
  async ({ user }, username: string, baseName: string) => {
    const fullName = scenarioState.uniqueNames.get(baseName);
    if (!fullName) {
      throw new Error(`No display-name edit for "${baseName}" was made in this scenario.`);
    }
    // The prior "navigates to" step already reloaded /profile; ngOnInit's
    // profiles.load() repopulates the field from the server, so this reads
    // back exactly what the PUT stored — not the in-memory form state.
    const page = pageOf(user(username).username);
    await expect(page.locator('[data-testid="profile-displayName"]'))
      .toHaveValue(fullName, { timeout: 15_000 });
  },
);

// ── Any free-text profile field — uniquified save + reload readback ─────────
// Generalises the display-name pattern above to the fields the persist suites
// never drove (notably `gender`, the one profile field absent from both). The
// value is uniquified per scenario for the same reason: against a persistent
// stack a FIXED literal would already be stored from an earlier run, so the
// assertion would pass even if the PUT silently did nothing.

When(
  '{string} sets their {string} profile field to {string}',
  async ({ user }, username: string, testid: string, baseValue: string) => {
    const fullValue = `${baseValue} ${scenarioNonce()}`;
    scenarioState.uniqueNames.set(`${testid}:${baseValue}`, fullValue);
    await pageOf(user(username).username).locator(`[data-testid="${testid}"]`).fill(fullValue);
  },
);

Then(
  '{string} sees their {string} profile field {string} persisted after reload',
  async ({ user }, username: string, testid: string, baseValue: string) => {
    const fullValue = scenarioState.uniqueNames.get(`${testid}:${baseValue}`);
    if (!fullValue) {
      throw new Error(`No edit of "${testid}" to "${baseValue}" was made in this scenario.`);
    }
    // The prior "navigates to" step reloaded /profile; ngOnInit's profiles.load()
    // repopulates every field from the server, so this reads back what the PUT
    // actually stored — not leftover in-memory form state.
    await expect(pageOf(user(username).username).locator(`[data-testid="${testid}"]`))
      .toHaveValue(fullValue, { timeout: 15_000 });
  },
);

// ── Preferences — media.poison.default round-trip ───────────────────────────

When(
  '{string} sets their default AI-cloak mode to {string}',
  async ({ user }, username: string, mode: string) => {
    await pageOf(user(username).username)
      .locator('[data-testid="prefs-poison-select"]')
      .selectOption(mode);
  },
);

Then('{string} sees the preference saved confirmation', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="prefs-status"]'))
    .toHaveText('Preference saved.', { timeout: 15_000 });
});

Then(
  '{string} sees the AI-cloak mode {string} after reload',
  async ({ user }, username: string, mode: string) => {
    // The prior "navigates to" step reloaded /preferences; ngOnInit re-fetches
    // via PreferencesService.load(), so the select's value reflects the
    // server's resolved map, not a leftover in-memory selection.
    const page = pageOf(user(username).username);
    await expect(page.locator('[data-testid="prefs-poison-select"]'))
      .toHaveValue(mode, { timeout: 15_000 });
  },
);

// ── Notification preferences — category toggle round-trip ───────────────────

When(
  '{string} turns off the {string} notification category',
  async ({ user }, username: string, category: string) => {
    await pageOf(user(username).username)
      .locator(`[data-testid="notif-pref-toggle-${category}"]`)
      .uncheck();
  },
);

When(
  '{string} turns on the {string} notification category',
  async ({ user }, username: string, category: string) => {
    // The restore half — used at the end of a delivery scenario to put a
    // persistent stack back the way it found it (leave-no-trace).
    await pageOf(user(username).username)
      .locator(`[data-testid="notif-pref-toggle-${category}"]`)
      .check();
  },
);

Then(
  '{string} sees the notification preference saved confirmation',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    await expect(page.locator('[data-testid="notif-prefs-status"]'))
      .toHaveText('Preference saved.', { timeout: 15_000 });
  },
);

Then(
  '{string} sees the {string} notification category off after reload',
  async ({ user }, username: string, category: string) => {
    // The prior "navigates to" step reloaded /notification-preferences;
    // ngOnInit re-fetches via NotificationPreferencesService.load(), so this
    // reads the server's resolved state, not the optimistic local update.
    const page = pageOf(user(username).username);
    await expect(page.locator(`[data-testid="notif-pref-toggle-${category}"]`))
      .not.toBeChecked({ timeout: 15_000 });
  },
);

Then(
  '{string} sees the {string} notification category on after reload',
  async ({ user }, username: string, category: string) => {
    // The RESTORE half of a toggle round-trip. Turning a category off and back
    // on again, each half proven across a reload, is what shows the write path
    // works in BOTH directions — an off-only assertion would also pass against
    // a surface that could never re-enable anything.
    const page = pageOf(user(username).username);
    await expect(page.locator(`[data-testid="notif-pref-toggle-${category}"]`))
      .toBeChecked({ timeout: 15_000 });
  },
);

Then(
  '{string} sees the {string} notification category forced on and locked',
  async ({ user }, username: string, category: string) => {
    // account-restriction is un-silenceable: rendered checked AND disabled, so
    // the control cannot even be driven. (The SERVER-side coercion is asserted
    // separately by the real PUT in profile-preferences-notifications.feature —
    // this is only the UI mirror of that invariant.)
    const page = pageOf(user(username).username);
    const toggle = page.locator(`[data-testid="notif-pref-toggle-${category}"]`);
    await expect(toggle).toBeChecked({ timeout: 15_000 });
    await expect(toggle).toBeDisabled();
  },
);

// ── PUT /bff/user/notification-preferences — the forced-on invariant ────────

let notifPrefPutEcho: { status: number; json: unknown } = { status: 0, json: null };

When(
  '{string} PUTs {string} with body {string}',
  async ({ user }, username: string, path: string, body: string) => {
    const page = pageOf(user(username).username);
    const result = await page.evaluate(
      async ({ url, b }) => {
        const r = await fetch(url, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: b,
        });
        let parsed: unknown = null;
        try {
          parsed = await r.json();
        } catch {
          parsed = null;
        }
        return { status: r.status, json: parsed };
      },
      { url: path, b: body },
    );
    responseState.lastStatus = result.status;
    notifPrefPutEcho = result;
  },
);

Then(
  'the notification-preference response confirms account-restriction is forced on',
  async ({}) => {
    // The BFF's PreferenceUpsert coerces enabled=false to true for
    // account-restriction (NotificationPreferenceController) — this asserts
    // the REAL server response body, not the UI's disabled checkbox (which
    // merely mirrors the invariant, it doesn't enforce it).
    const body = notifPrefPutEcho.json as Record<string, boolean> | null;
    expect(body, 'expected a JSON body on the PUT response').toBeTruthy();
    expect(body?.['account-restriction']).toBe(true);
  },
);

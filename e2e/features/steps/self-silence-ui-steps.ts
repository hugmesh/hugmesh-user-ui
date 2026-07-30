// SELF-SILENCE **UI FORM** step definitions.
//
// Every self-silence activation in the rest of the suite goes through the BFF
// ("activates a self-silence ... via the BFF"), so the real form path was
// untested: the datetime-local local->ISO conversion, the future-time
// validation, the active readback with its wake time, the aria-disabled
// activate gate + "already hidden" helptext, and the cancel button. These steps
// drive that form and only that form.
//
// Honesty rules applied here:
//   - The oracle for "it really activated" is NEVER the UI's own status line
//     alone. `Then "X" has an active self-silence` (mutation-steps.ts) re-reads
//     GET /bff/user/self-silence/status through the user's own cookie, so the
//     server is the witness. The UI assertions are additional, not substitute.
//   - The datetime-local value is built in the BROWSER's timezone (via
//     page.evaluate), not the test runner's. The component parses the field
//     with `new Date(this.until)` — which interprets a bare
//     "YYYY-MM-DDTHH:mm" as LOCAL time — so a runner/browser timezone skew
//     would otherwise silently shift the deadline and could push a "+1 hour"
//     into the past, making the future-time validation fire and the scenario
//     fail for the wrong reason.
//
// Markup under test (verified against src/app/self-silence.component.html):
//   self-silence-until (datetime-local input), self-silence-reason (input),
//   self-silence-activate (submit), self-silence-active (readback container),
//   self-silence-wake (the auto-reactivate line), self-silence-cancel,
//   self-silence-already (the disabled-while-active helptext),
//   self-silence-error (role=alert validation message),
//   self-silence-status (role=status action feedback).

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

/**
 * Format `now + offsetMinutes` as the `YYYY-MM-DDTHH:mm` string a
 * `datetime-local` input holds, computed INSIDE the browser so it is in the
 * page's timezone (see the header note on why the runner's clock/zone must not
 * be used).
 */
async function localDatetimeValue(
  username: string,
  offsetMinutes: number,
): Promise<string> {
  return await pageOf(username).evaluate((mins) => {
    const d = new Date(Date.now() + mins * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  }, offsetMinutes);
}

// ── Filling the real datetime-local field ───────────────────────────────────

When(
  '{string} sets the self-silence end time to {int} minutes from now',
  async ({ user }, username: string, minutes: number) => {
    const name = user(username).username;
    const value = await localDatetimeValue(name, minutes);
    await pageOf(name).locator('[data-testid="self-silence-until"]').fill(value);
  },
);

When(
  '{string} sets the self-silence end time to {int} minutes in the past',
  async ({ user }, username: string, minutes: number) => {
    // Drives the client-side future-time guard: activate() must refuse and
    // render self-silence-error WITHOUT calling the BFF.
    const name = user(username).username;
    const value = await localDatetimeValue(name, -Math.abs(minutes));
    await pageOf(name).locator('[data-testid="self-silence-until"]').fill(value);
  },
);

When(
  '{string} gives the self-silence reason {string}',
  async ({ user }, username: string, reason: string) => {
    await pageOf(user(username).username)
      .locator('[data-testid="self-silence-reason"]')
      .fill(reason);
  },
);

When('{string} submits the self-silence form', async ({ user }, username: string) => {
  await pageOf(user(username).username).locator('[data-testid="self-silence-activate"]').click();
});

// ── Outcome assertions ──────────────────────────────────────────────────────

Then('{string} sees the self-silence activated confirmation', async ({ user }, username: string) => {
  // self-silence-status carries this exact text ONLY after the activate() POST
  // resolved; the catch branch writes "Could not activate your self-silence."
  // instead — so this is a success oracle, not a render check.
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="self-silence-status"]'))
    .toHaveText('You are now hidden from others.', { timeout: 15_000 });
});

Then('{string} sees the self-silence cancelled confirmation', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="self-silence-status"]'))
    .toHaveText('Your self-silence was cancelled — you are visible again.', { timeout: 15_000 });
});

Then(
  '{string} sees the self-silence wake time readback',
  async ({ user }, username: string) => {
    // The readback block only renders when active() is true (a 200 status row
    // with no clearedAt and a FUTURE expiresAt). Assert the wake line actually
    // carries a rendered date rather than an empty `| date` pipe result — an
    // empty string would still be "visible" and prove nothing.
    const page = pageOf(user(username).username);
    const wake = page.locator('[data-testid="self-silence-wake"]');
    await expect(wake).toBeVisible({ timeout: 15_000 });
    await expect(wake.locator('strong')).not.toBeEmpty();
  },
);

Then(
  '{string} sees the self-silence future-time validation error',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    await expect(page.locator('[data-testid="self-silence-error"]'))
      .toHaveText('The end time must be in the future.', { timeout: 15_000 });
  },
);

Then(
  '{string} sees no self-silence activated confirmation',
  async ({ user }, username: string) => {
    // The negative half of the client-side guard: the status live region must
    // still be EMPTY, proving activate() early-returned before the POST rather
    // than posting and failing.
    const page = pageOf(user(username).username);
    await expect(page.locator('[data-testid="self-silence-status"]')).toHaveText('');
  },
);

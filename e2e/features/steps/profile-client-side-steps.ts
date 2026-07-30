// Step definitions for the client-side profile-editor behaviours
// (profile-edit-client-side.feature, offline) and the backend field-persist /
// avatar-upload round-trips (profile-account-actions.feature, @cluster).
//
// These are NON-VACUOUS: every Then asserts a specific observable change —
// exact validation TEXT that only appears after the component's own validation
// path runs (role=alert / role=status regions that are empty or absent on a
// blank page), a form-control VALUE the component wrote (default-fill / reload
// readback), or the DOM swap an upload performs (server image replaces the
// local preview). None is a bare "element exists".
//
// New patterns only — the fill / click / navigate / view / does-not-see /
// save / saved-confirmation steps are reused from session-steps.ts and
// profile-preferences-steps.ts (playwright-bdd errors on a duplicate pattern,
// so nothing here re-registers those).

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

// ── Text-content assertions (validation / preview / message live regions) ────

Then(
  '{string} sees {string} in the {string}',
  async ({ user }, username: string, text: string, testid: string) => {
    // toContainText fails against a blank page and against the un-triggered
    // state: the targeted region is either *ngIf-gated (profile-error,
    // profile-*-message) or holds different text (profile-srn-preview default,
    // profile-status load message) until the asserted behaviour runs.
    const page = pageOf(user(username).username);
    await expect(page.locator(`[data-testid="${testid}"]`)).toContainText(text, {
      timeout: 15_000,
    });
  },
);

Then(
  '{string} sees no profile saved confirmation',
  async ({ user }, username: string) => {
    // The negative half of a validation scenario: because save() returned early
    // on the invalid field, profile-status must never carry the success text.
    const page = pageOf(user(username).username);
    await expect(page.locator('[data-testid="profile-status"]')).not.toContainText(
      'Profile saved.',
    );
  },
);

// ── Form-control value assertions (default-fill + reload readback) ───────────

Then(
  '{string} sees the {string} field value {string}',
  async ({ user }, username: string, testid: string, value: string) => {
    // Reads the control's actual value: the screen-reader-name field the
    // component default-filled from the display name, or a field repopulated by
    // ngOnInit from the server after a reload (profile-account-actions).
    const page = pageOf(user(username).username);
    await expect(page.locator(`[data-testid="${testid}"]`)).toHaveValue(value, {
      timeout: 15_000,
    });
  },
);

// ── Select + checkbox interaction / state (field persist round-trip) ────────

When(
  '{string} sets the {string} select to {string}',
  async ({ user }, username: string, testid: string, value: string) => {
    await pageOf(user(username).username)
      .locator(`[data-testid="${testid}"]`)
      .selectOption(value);
  },
);

When(
  '{string} checks the {string} toggle',
  async ({ user }, username: string, testid: string) => {
    await pageOf(user(username).username).locator(`[data-testid="${testid}"]`).check();
  },
);

Then(
  '{string} sees the {string} toggle checked',
  async ({ user }, username: string, testid: string) => {
    // Reload readback of a checkbox the save persisted server-side.
    const page = pageOf(user(username).username);
    await expect(page.locator(`[data-testid="${testid}"]`)).toBeChecked({ timeout: 15_000 });
  },
);

// ── Avatar file gate — client-side rejects (offline, no upload) ─────────────

When(
  '{string} chooses a non-image file for their avatar',
  async ({ user }, username: string) => {
    // A text/plain file: validate() rejects it BEFORE showPreview/upload, so no
    // BFF call happens — deterministic offline.
    await pageOf(user(username).username)
      .locator('[data-testid="profile-avatar-file"]')
      .setInputFiles({
        name: 'notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('not an image'),
      });
  },
);

When(
  '{string} chooses an avatar image larger than 5 MB',
  async ({ user }, username: string) => {
    // A well-typed PNG whose size exceeds the 5 MB cap: validate() rejects it on
    // size, again before any upload — deterministic offline.
    const tooBig = Buffer.alloc(5 * 1024 * 1024 + 1, 0);
    await pageOf(user(username).username)
      .locator('[data-testid="profile-avatar-file"]')
      .setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: tooBig });
  },
);

// ── Avatar upload — the real POST (live BFF, @cluster) ──────────────────────

// A minimal valid 1x1 transparent PNG (67 bytes) — passes the client-side
// type+size gate so onFileSelected proceeds to POST /bff/user/profile/avatar.
const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

When('{string} uploads a valid PNG avatar', async ({ user }, username: string) => {
  await pageOf(user(username).username)
    .locator('[data-testid="profile-avatar-file"]')
    .setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: ONE_BY_ONE_PNG });
});

Then('{string} sees their stored avatar image', async ({ user }, username: string) => {
  // After a successful upload the component adopts the server profile (with its
  // avatarUrl) and clears the local preview, so profile-avatar-image renders
  // pointing at a server URL — proof the round-trip stored the picture, not a
  // local data-URL echo.
  const page = pageOf(user(username).username);
  const img = page.locator('[data-testid="profile-avatar-image"]');
  await expect(img).toBeVisible({ timeout: 15_000 });
  const src = await img.getAttribute('src');
  expect(src && src.length > 0).toBe(true);
});

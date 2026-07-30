// CARD EDIT / DELETE step definitions — the two riskiest client-side card paths
// that cards-lifecycle.feature never exercised (it proves publish only).
//
//   EDIT   — clicking a row's edit button calls CardsService.readBody(slug) and
//            feeds the raw stored body through decodeDocument(), which must
//            restore the EXACT prior sections and scoped CSS. That is a lossless
//            codec round-trip through the server: encodeDocument on publish,
//            decodeDocument on edit. If either side drops a field the author
//            silently loses content on their next republish.
//   DELETE — removing a row must delete it server-side AND, when the deleted
//            card is the one currently loaded in the editor, clear the form.
//
// Honesty rules applied here:
//   - The prefill assertion reads the REAL field values through toHaveValue
//     against the exact text published earlier in the same scenario (uniquified
//     via scenarioNonce), not a substring or a non-empty check — a codec that
//     dropped the second section or the CSS would pass a "not empty" assertion.
//   - "Republishing made a new version" is asserted as a CHANGE from the
//     version captured before (versionDir bump), never as a hardcoded value.
//   - "Deleted" is proven from the SERVER: the owner-scoped GET /bff/user/cards
//     list is re-read (bounded poll) after a full page reload, so a row merely
//     removed from the in-memory signal cannot pass.

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, scenarioState, scenarioNonce } from './_registry';
import { cardSlugsFor } from '../../tests/helpers/poll';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

function cardOf(baseSlug: string) {
  const c = scenarioState.cards.get(baseSlug);
  if (!c) throw new Error(`No card "${baseSlug}" was published in this scenario.`);
  return c;
}

// Authored text and captured versions live in scenarioState (reset by the
// Before/After hooks in support/fixtures.ts) rather than in module-level maps:
// step files are loaded ONCE per worker, so a module-level Map would carry a
// previous scenario's values into the next one and a scenario missing its
// "write" step could silently assert against stale text.

function bodyKey(baseSlug: string, index: number): string {
  return `${baseSlug}#${index}`;
}

function titleKey(baseSlug: string, index: number): string {
  return `title:${baseSlug}#${index}`;
}

function cssKey(baseSlug: string): string {
  return `css:${baseSlug}`;
}

// ── Authoring a multi-section card with scoped CSS ──────────────────────────

When(
  '{string} adds another card section',
  async ({ user }, username: string) => {
    await pageOf(user(username).username).locator('[data-testid="add-section"]').click();
  },
);

When(
  '{string} writes card section {int} of {string} as {string}',
  async ({ user }, username: string, index: number, baseSlug: string, text: string) => {
    // Uniquified so a repeat run against a persistent stack cannot pass by
    // reading back a body an earlier run stored under the same slug.
    const value = `${text} ${scenarioNonce()}`;
    scenarioState.cardAuthoring.set(bodyKey(baseSlug, index), value);
    await pageOf(user(username).username)
      .locator(`[data-testid="section-body-${index}"]`)
      .fill(value);
  },
);

When(
  '{string} titles card section {int} of {string} as {string}',
  async ({ user }, username: string, index: number, baseSlug: string, title: string) => {
    const value = `${title} ${scenarioNonce()}`;
    scenarioState.cardAuthoring.set(titleKey(baseSlug, index), value);
    await pageOf(user(username).username)
      .locator(`[data-testid="section-title-${index}"]`)
      .fill(value);
  },
);

When(
  '{string} writes the card CSS for {string} as {string}',
  async ({ user }, username: string, baseSlug: string, css: string) => {
    scenarioState.cardAuthoring.set(cssKey(baseSlug), css);
    await pageOf(user(username).username).locator('[data-testid="card-css-body"]').fill(css);
  },
);

// ── Edit: open a published card back into the editor ────────────────────────

When(
  '{string} clicks edit on the card row for {string}',
  async ({ user }, username: string, baseSlug: string) => {
    const card = cardOf(baseSlug);
    await pageOf(user(username).username)
      .locator(`[data-testid="cards-rows"] tr[data-card-slug="${card.slug}"] button[data-edit]`)
      .click();
  },
);

Then(
  '{string} sees card section {int} of {string} prefilled with the published text',
  async ({ user }, username: string, index: number, baseSlug: string) => {
    // The lossless-codec oracle: readBody -> decodeDocument must reproduce the
    // EXACT source string this scenario published into that section.
    const expected = scenarioState.cardAuthoring.get(bodyKey(baseSlug, index));
    if (expected === undefined) {
      throw new Error(`Section ${index} of "${baseSlug}" was never written in this scenario.`);
    }
    await expect(pageOf(user(username).username).locator(`[data-testid="section-body-${index}"]`))
      .toHaveValue(expected, { timeout: 15_000 });
  },
);

Then(
  '{string} sees card section {int} of {string} titled with the published title',
  async ({ user }, username: string, index: number, baseSlug: string) => {
    const expected = scenarioState.cardAuthoring.get(titleKey(baseSlug, index));
    if (expected === undefined) {
      throw new Error(`Section ${index} of "${baseSlug}" was never titled in this scenario.`);
    }
    await expect(pageOf(user(username).username).locator(`[data-testid="section-title-${index}"]`))
      .toHaveValue(expected, { timeout: 15_000 });
  },
);

Then(
  '{string} sees the card CSS for {string} prefilled with the published style',
  async ({ user }, username: string, baseSlug: string) => {
    const expected = scenarioState.cardAuthoring.get(cssKey(baseSlug));
    if (expected === undefined) {
      throw new Error(`No card CSS was written for "${baseSlug}" in this scenario.`);
    }
    await expect(pageOf(user(username).username).locator('[data-testid="card-css-body"]'))
      .toHaveValue(expected, { timeout: 15_000 });
  },
);

// ── Version bump across a republish ─────────────────────────────────────────

/** Read the versionDir cell of a card's row straight out of the rendered table
 *  (column order: slug, visibility, version, created — see cards.component.html). */
async function versionDirOf(username: string, slug: string): Promise<string> {
  const cell = pageOf(username)
    .locator(`[data-testid="cards-rows"] tr[data-card-slug="${slug}"] td`)
    .nth(2);
  await expect(cell).toBeVisible({ timeout: 15_000 });
  return ((await cell.textContent()) ?? '').trim();
}

Then(
  '{string} captures the version of the card {string}',
  async ({ user }, username: string, baseSlug: string) => {
    const card = cardOf(baseSlug);
    const v = await versionDirOf(user(username).username, card.slug);
    expect(v, 'the card row must render a versionDir to capture').not.toHaveLength(0);
    scenarioState.cardVersions.set(baseSlug, v);
  },
);

Then(
  '{string} sees the version of the card {string} changed',
  async ({ user }, username: string, baseSlug: string) => {
    // A republish writes a NEW version directory. Asserted as a delta from the
    // captured value (never a hardcoded version string), so the oracle holds on
    // a persistent stack where the card may already have any version history.
    const card = cardOf(baseSlug);
    const before = scenarioState.cardVersions.get(baseSlug);
    if (!before) throw new Error(`The version of "${baseSlug}" was never captured in this scenario.`);
    const name = user(username).username;
    await expect
      .poll(async () => await versionDirOf(name, card.slug), {
        timeout: 15_000,
        message: `card "${card.slug}" versionDir did not change from "${before}" after republish`,
      })
      .not.toBe(before);
  },
);

// ── Delete ──────────────────────────────────────────────────────────────────

When(
  '{string} clicks delete on the card row for {string}',
  async ({ user }, username: string, baseSlug: string) => {
    const card = cardOf(baseSlug);
    await pageOf(user(username).username)
      .locator(`[data-testid="cards-rows"] tr[data-card-slug="${card.slug}"] button[data-delete]`)
      .click();
  },
);

Then(
  '{string} sees the card deleted confirmation for {string}',
  async ({ user }, username: string, baseSlug: string) => {
    // cards-status carries this text ONLY after the DELETE resolved — the catch
    // branch writes "Could not delete ..." instead.
    const card = cardOf(baseSlug);
    await expect(pageOf(user(username).username).locator('[data-testid="cards-status"]'))
      .toHaveText(`Card "${card.slug}" deleted.`, { timeout: 15_000 });
  },
);

Then(
  '{string} no longer has the card {string} on the server',
  async ({ user }, username: string, baseSlug: string) => {
    // The SERVER is the witness: re-read the owner-scoped list rather than
    // trusting the row's disappearance from the in-memory signal.
    const card = cardOf(baseSlug);
    const page = pageOf(user(username).username);
    await expect
      .poll(async () => await cardSlugsFor(page), {
        timeout: 15_000,
        message: `card "${card.slug}" was still listed by the server after delete`,
      })
      .not.toContain(card.slug);
  },
);

Then(
  '{string} sees no card row for {string}',
  async ({ user }, username: string, baseSlug: string) => {
    const card = cardOf(baseSlug);
    await expect(
      pageOf(user(username).username)
        .locator(`[data-testid="cards-rows"] tr[data-card-slug="${card.slug}"]`),
    ).toHaveCount(0);
  },
);

Then(
  '{string} sees the card editor cleared',
  async ({ user }, username: string) => {
    // remove() clears the form when the deleted card is the one loaded: slug and
    // entryFile blank and the editor reset to a single empty section.
    const page = pageOf(user(username).username);
    await expect(page.locator('[data-testid="cards-slug"]')).toHaveValue('');
    await expect(page.locator('[data-testid="section-body-0"]')).toHaveValue('');
    await expect(page.locator('[data-testid="section-body-1"]')).toHaveCount(0);
  },
);

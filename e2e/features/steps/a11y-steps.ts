// Accessibility step definitions. The user-ui carries the org a11y standard:
// the shell renders a skip-link + focusable main region (app.component.html:
//   <a class="skip" href="#main">Skip to main content</a>
//   <main id="main" tabindex="-1"><router-outlet /></main>)
// and every self-service view roots an accessibly-named landmark
// (aria-labelledby a heading) with a polite role="status" live region. These
// steps assert those contracts against the real shell + view markup.
//
// Persona-less steps ("the {string} view has an accessible name") bind the
// default `page` fixture — the a11y feature drives a single seeded persona on
// the default page, so the fixture and the persona's page are the same object.
// (They previously declared a phantom `username` parameter the pattern never
// supplied, which failed playwright-bdd's arity check at bddgen time and broke
// the documented no-filter validation — fixed in the P0 wave.)

import { expect } from '@playwright/test';
import { Then, When } from '../support/fixtures';
import { pageRegistry } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

// ── Skip-link ────────────────────────────────────────────────────────────────

Then('{string} can tab to the skip link', async ({}, username: string) => {
  const page = pageOf(username);
  await page.keyboard.press('Tab');
  const skip = page.locator('a.skip');
  await expect(skip).toBeFocused();
  await expect(skip).toHaveAttribute('href', '#main');
});

Then('activating the skip link moves focus to the main region', async ({ page }) => {
  await page.locator('a.skip').press('Enter');
  const main = page.locator('main#main');
  await expect(main).toBeFocused();
  // The skip target must be programmatically focusable without being a tab stop.
  await expect(main).toHaveAttribute('tabindex', '-1');
});

// ── ARIA landmarks / labels ──────────────────────────────────────────────────

Then('the {string} view has an accessible name', async ({ page }, testid: string) => {
  const view = page.locator(`[data-testid="${testid}"]`);
  // Each self-service view root is aria-labelledby a heading (or has an explicit
  // aria-label) — assert one of the two is present so assistive tech can name
  // the region.
  const labelledby = await view.getAttribute('aria-labelledby');
  const ariaLabel = await view.getAttribute('aria-label');
  expect(Boolean(labelledby) || Boolean(ariaLabel)).toBe(true);
});

Then('the {string} live region announces politely', async ({ page }, testid: string) => {
  const status = page.locator(`[data-testid="${testid}"]`);
  // Every view's status line is role="status" + aria-live="polite" — a
  // non-error, politely announced surface (e.g. home-status, cards-status).
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveAttribute('aria-live', 'polite');
});

// ── Roving / tab-order focus through the self-service form ───────────────────

When('{string} focuses the {string} field', async ({}, username: string, testid: string) => {
  const page = pageOf(username);
  await page.locator(`[data-testid="${testid}"]`).focus();
});

Then('tabbing advances focus to the {string} field', async ({ page }, testid: string) => {
  await page.keyboard.press('Tab');
  await expect(page.locator(`[data-testid="${testid}"]`)).toBeFocused();
});

// ── Field describedby (helptext is programmatically associated) ──────────────

Then('the {string} field is described by help text', async ({ page }, testid: string) => {
  const field = page.locator(`[data-testid="${testid}"]`);
  const describedby = await field.getAttribute('aria-describedby');
  expect(describedby && describedby.length > 0).toBe(true);
  // At least one referenced id must resolve to a real element in the DOM, so the
  // association is not dangling.
  const firstId = (describedby ?? '').split(/\s+/).filter(Boolean)[0];
  await expect(page.locator(`#${firstId}`)).toHaveCount(1);
});

// ── Focus restoration after a route change ───────────────────────────────────

Then('focus is restored to the main region after navigation', async ({ page }) => {
  await expect(page.locator('main#main')).toBeFocused();
});

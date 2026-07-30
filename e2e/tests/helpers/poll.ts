import { Page, expect } from '@playwright/test';

/**
 * expect.poll-style CROSS-USER wait helpers (the org standard for "X appears in
 * <ctx>'s view within Ns" assertions — NEVER a bare waitForTimeout). Each helper
 * re-fetches the observing user's OWN view of a collection through their page's
 * origin (credentials:'include', so their HttpOnly bff_ cookie rides the call
 * and the user-bff owner==subject chain answers for THAT user) until the
 * expectation holds or the deadline passes. Mirrors the merged admin-ui
 * tests/helpers/poll.ts idiom.
 */

/** One user's CURRENT self-block rows, fetched as that user (owner-scoped by
 *  the BFF — the JWT subject is the only owner the list can ever show). */
export async function blockRowsFor(
  page: Page,
): Promise<Array<{ id: string; target: string }>> {
  return await page.evaluate(async () => {
    const r = await fetch('/bff/user/blocks', { credentials: 'include' });
    if (!r.ok) throw new Error(`GET /bff/user/blocks → ${r.status}`);
    const body = (await r.json()) as Array<{ id?: string; target?: string }>;
    return (body ?? []).map((b) => ({ id: b.id ?? '', target: b.target ?? '' }));
  });
}

/**
 * Poll the observing user's /bff/user/blocks list until a row with the given
 * (already-uniquified) target is visible to THEM. The victim-creates-first
 * oracle's readback half: the row must really exist in the owner's scoped list
 * before an attacker DENY against its id proves anything.
 */
export async function pollForBlockTarget(
  page: Page,
  fullTarget: string,
  seconds: number,
): Promise<void> {
  await expect
    .poll(
      async () => (await blockRowsFor(page)).map((b) => b.target),
      {
        timeout: seconds * 1000,
        message: `self-block "${fullTarget}" did not appear in the observer's list within ${seconds}s`,
      },
    )
    .toContain(fullTarget);
}

/** One user's CURRENT card slugs, fetched as that user (GET /bff/user/cards is
 *  the owner-scoped "mine" list — it can never show another owner's cards). */
export async function cardSlugsFor(page: Page): Promise<string[]> {
  return await page.evaluate(async () => {
    const r = await fetch('/bff/user/cards', { credentials: 'include' });
    if (!r.ok) throw new Error(`GET /bff/user/cards → ${r.status}`);
    const body = (await r.json()) as Array<{ slug?: string }>;
    return (body ?? []).map((c) => c.slug ?? '');
  });
}

/**
 * Poll the observing user's /bff/user/cards list until a card with the given
 * (already-uniquified) slug is visible to THEM — "the card X appears in <ctx>'s
 * cards list within Ns".
 */
export async function pollForCardSlug(
  page: Page,
  slug: string,
  seconds: number,
): Promise<void> {
  await expect
    .poll(
      async () => await cardSlugsFor(page),
      {
        timeout: seconds * 1000,
        message: `card "${slug}" did not appear in the observer's cards list within ${seconds}s`,
      },
    )
    .toContain(slug);
}

/** A user's own self-silence ACTIVE flag, computed exactly as the UI computes
 *  it (SelfSilenceComponent.active): a 200 row with no clearedAt and a FUTURE
 *  expiresAt. 204 (no row) and cleared/expired rows are all "not active". */
export async function selfSilenceActiveFor(page: Page): Promise<boolean> {
  return await page.evaluate(async () => {
    const r = await fetch('/bff/user/self-silence/status', { credentials: 'include' });
    if (r.status === 204) return false;
    if (!r.ok) throw new Error(`GET /bff/user/self-silence/status → ${r.status}`);
    const s = (await r.json()) as { clearedAt?: string; expiresAt?: string };
    if (!s || s.clearedAt || !s.expiresAt) return false;
    return new Date(s.expiresAt).getTime() > Date.now();
  });
}

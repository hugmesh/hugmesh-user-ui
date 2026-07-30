// REAL-WRITE (mutation) step definitions — the victim-creates-first discipline
// for the SELF-SERVICE surface. Mirrors the merged admin-ui mutation-steps
// pattern.
//
// Two write channels, both honest:
//   - UI writes: drive the real self-service form (cards editor, the
//     recommend-instance-block form) and prove the outcome in the SAME view the
//     user sees (published/submitted confirmation + the row appearing) AND —
//     where the UI swallows the response body — capture the REAL BFF response
//     via waitForResponse so the echo can be asserted.
//   - BFF writes: fire the same same-origin fetch the app's services fire
//     (credentials:'include' → the HttpOnly bff_ cookie), capture the REAL
//     server-issued id/slug/hash, and use it as the oracle for the cross-user
//     DENYs. A DENY against a fabricated id proves nothing (the 404 just says
//     "no such row" — it cannot distinguish owner==subject enforcement from a
//     typo); every attacked id here was created by its victim first, and the
//     victim re-reads it AFTER the attack.
//
// Names are uniquified per scenario (scenarioNonce) so repeated live runs never
// collide; the feature files keep the declarative base names.

import { expect } from '@playwright/test';
import { When, Then, Given } from '../support/fixtures';
import { pageRegistry, responseState, scenarioState, scenarioNonce } from './_registry';
import {
  blockRowsFor,
  cardSlugsFor,
  pollForBlockTarget,
  pollForCardSlug,
  selfSilenceActiveFor,
} from '../../tests/helpers/poll';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

function blockOf(baseTarget: string) {
  const b = scenarioState.blocks.get(baseTarget);
  if (!b) throw new Error(`No self-block for "${baseTarget}" was created in this scenario.`);
  return b;
}

function cardOf(baseSlug: string) {
  const c = scenarioState.cards.get(baseSlug);
  if (!c) throw new Error(`No card "${baseSlug}" was published in this scenario.`);
  return c;
}

// ── Self-blocks — BFF create + cross-user attack (victim-creates-first) ─────

When(
  '{string} creates a self-block for {string} via the BFF',
  async ({ user }, username: string, baseTarget: string) => {
    const page = pageOf(user(username).username);
    // Uniquify inside the localpart so a repeat live run cannot pass on a stale
    // row: "@spammer:bad.example.org" -> "@spammer-<nonce>:bad.example.org".
    const fullTarget = baseTarget.replace(/^@([^:]+)/, `@$1-${scenarioNonce()}`);
    // platform 'internal' needs only the ROLE_USER floor (matrix/mastodon
    // targets are platform-role gated server-side) — every persona can create
    // its own row here, which is exactly what the owner==subject matrix needs.
    const created = await page.evaluate(
      async ([target]) => {
        const r = await fetch('/bff/user/blocks', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target, platform: 'internal' }),
        });
        return r.status;
      },
      [fullTarget] as const,
    );
    // Honest ALLOW: the create must really succeed before its row can serve as
    // the cross-user DENY oracle.
    expect(created, 'victim self-block create must succeed (200)').toBe(200);
    // The create response is a result envelope (pushed/external), not the row —
    // capture the REAL server-issued UUID from the owner-scoped readback.
    const rows = await blockRowsFor(page);
    const row = rows.find((b) => b.target === fullTarget);
    if (!row?.id) throw new Error(`created self-block "${fullTarget}" not found in owner readback`);
    scenarioState.blocks.set(baseTarget, { id: row.id, fullTarget });
  },
);

Then(
  'the self-block for {string} appears in {string}\'s list within {int} seconds',
  async ({ user }, baseTarget: string, username: string, seconds: number) => {
    const target = blockOf(baseTarget);
    await pollForBlockTarget(pageOf(user(username).username), target.fullTarget, seconds);
  },
);

When(
  '{string} attempts to delete the self-block for {string} via the BFF',
  async ({ user }, username: string, baseTarget: string) => {
    const target = blockOf(baseTarget);
    const page = pageOf(user(username).username);
    responseState.lastStatus = await page.evaluate(
      async ([id]) => {
        const r = await fetch(`/bff/user/blocks/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        return r.status;
      },
      [target.id] as const,
    );
  },
);

When(
  '{string} deletes their own self-block for {string} via the BFF',
  async ({ user }, username: string, baseTarget: string) => {
    // The owner ALLOW half — proves an elevated role is not blanket-blocked but
    // simply subject-scoped like everyone else.
    const target = blockOf(baseTarget);
    const page = pageOf(user(username).username);
    const status = await page.evaluate(
      async ([id]) => {
        const r = await fetch(`/bff/user/blocks/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        return r.status;
      },
      [target.id] as const,
    );
    expect(status, 'owner delete of their own self-block must succeed (204)').toBe(204);
  },
);

Then(
  '{string} still lists the self-block for {string}',
  async ({ user }, username: string, baseTarget: string) => {
    // The second half of the oracle: the attacked row is UNTOUCHED for its
    // owner — same server-issued id, same target.
    const target = blockOf(baseTarget);
    const rows = await blockRowsFor(pageOf(user(username).username));
    expect(rows).toContainEqual({ id: target.id, target: target.fullTarget });
  },
);

Then(
  '{string} no longer lists the self-block for {string}',
  async ({ user }, username: string, baseTarget: string) => {
    const target = blockOf(baseTarget);
    const rows = await blockRowsFor(pageOf(user(username).username));
    expect(rows.map((b) => b.id)).not.toContain(target.id);
  },
);

Then(
  '{string}\'s self-block list does not contain the self-block for {string}',
  async ({ user }, username: string, baseTarget: string) => {
    // Scope assertion: the observer's OWN owner-scoped list never carries the
    // victim's row — even when the observer holds an elevated role.
    const target = blockOf(baseTarget);
    const rows = await blockRowsFor(pageOf(user(username).username));
    expect(rows.map((b) => b.target)).not.toContain(target.fullTarget);
  },
);

// ── Cards — BFF publish + cross-user attack (victim-creates-first) ──────────

When(
  '{string} publishes a card {string} with visibility {string} via the BFF',
  async ({ user }, username: string, baseSlug: string, visibility: string) => {
    const page = pageOf(user(username).username);
    const slug = `${baseSlug}-${scenarioNonce()}`;
    const bodyText = `e2e victim-creates-first card body for ${slug}`;
    const created = await page.evaluate(
      async ([s, vis, body]) => {
        const r = await fetch(`/bff/user/cards/${encodeURIComponent(s)}?visibility=${encodeURIComponent(vis)}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/octet-stream' },
          body,
        });
        return { status: r.status, json: r.ok ? await r.json() : null };
      },
      [slug, visibility, bodyText] as const,
    );
    expect(created.status, 'victim card publish must succeed (200)').toBe(200);
    const stored = created.json as { slug?: string; contentHash?: string } | null;
    if (!stored?.contentHash) {
      throw new Error('card publish returned no contentHash — cannot run the victim-creates-first oracle');
    }
    scenarioState.cards.set(baseSlug, { slug, contentHash: stored.contentHash, bodyText });
  },
);

Then(
  'the card {string} appears in {string}\'s cards list within {int} seconds',
  async ({ user }, baseSlug: string, username: string, seconds: number) => {
    const card = cardOf(baseSlug);
    await pollForCardSlug(pageOf(user(username).username), card.slug, seconds);
  },
);

Then(
  'the card {string} does not appear in {string}\'s cards list',
  async ({ user }, baseSlug: string, username: string) => {
    // GET /bff/user/cards is the owner-scoped "mine" list — another owner's
    // card must never surface in it, whatever its visibility.
    const card = cardOf(baseSlug);
    const slugs = await cardSlugsFor(pageOf(user(username).username));
    expect(slugs).not.toContain(card.slug);
  },
);

Then(
  '{string} reads no versions for the card {string} via the BFF',
  async ({ user }, username: string, baseSlug: string) => {
    // The peer-read oracle: GET /bff/user/cards/{slug} answers with the
    // CALLER's own versions of that slug (owner-scoped upstream for non-admin
    // callers), so a peer reading the victim's REAL slug gets an EMPTY list —
    // never the victim's metadata.
    const card = cardOf(baseSlug);
    const page = pageOf(user(username).username);
    const read = await page.evaluate(
      async ([slug]) => {
        const r = await fetch(`/bff/user/cards/${encodeURIComponent(slug)}`, { credentials: 'include' });
        return { status: r.status, json: r.ok ? await r.json() : null };
      },
      [card.slug] as const,
    );
    expect(read.status).toBe(200);
    expect(read.json as unknown[]).toEqual([]);
  },
);

Then(
  '{string} reads the card {string} metadata via the BFF',
  async ({ user }, username: string, baseSlug: string) => {
    // Positive readback against the REAL published version: at least one row
    // for the slug, carrying the exact contentHash the publish returned.
    const card = cardOf(baseSlug);
    const page = pageOf(user(username).username);
    const read = await page.evaluate(
      async ([slug]) => {
        const r = await fetch(`/bff/user/cards/${encodeURIComponent(slug)}`, { credentials: 'include' });
        return { status: r.status, json: r.ok ? await r.json() : null };
      },
      [card.slug] as const,
    );
    expect(read.status).toBe(200);
    const hashes = ((read.json ?? []) as Array<{ contentHash?: string }>).map((v) => v.contentHash);
    expect(hashes).toContain(card.contentHash);
  },
);

When(
  '{string} attempts to delete the card {string} via the BFF',
  async ({ user }, username: string, baseSlug: string) => {
    const card = cardOf(baseSlug);
    const page = pageOf(user(username).username);
    responseState.lastStatus = await page.evaluate(
      async ([slug]) => {
        const r = await fetch(`/bff/user/cards/${encodeURIComponent(slug)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        return r.status;
      },
      [card.slug] as const,
    );
  },
);

When(
  '{string} attempts to read the card {string} body via the BFF',
  async ({ user }, username: string, baseSlug: string) => {
    // Capture status AND body text: the deny status is asserted by the
    // scenario, and the no-content-leak step below proves the error surface
    // (whatever its shape) never carried the victim's card source.
    const card = cardOf(baseSlug);
    const page = pageOf(user(username).username);
    const result = await page.evaluate(
      async ([slug]) => {
        const r = await fetch(`/bff/user/cards/${encodeURIComponent(slug)}/body`, { credentials: 'include' });
        return { status: r.status, text: await r.text().catch(() => '') };
      },
      [card.slug] as const,
    );
    responseState.lastStatus = result.status;
    responseState.lastBodyText = result.text;
  },
);

Then(
  'the card {string} body was not leaked in the response',
  async ({}, baseSlug: string) => {
    // The content half of the cross-owner body-read DENY oracle: whatever
    // status/error shape the BFF surfaced, the response body must not carry
    // the exact source text the victim published.
    const card = cardOf(baseSlug);
    if (!card.bodyText) {
      throw new Error(
        `card "${baseSlug}" carries no recorded body text — publish it via the BFF step so the leak oracle has a real needle.`,
      );
    }
    expect(responseState.lastBodyText).not.toContain(card.bodyText);
  },
);

When(
  'the unauthenticated client attempts to read the card {string} via the BFF',
  async ({ page }, baseSlug: string) => {
    // The signed-out floor for cards: there is NO anonymous card-serving path on
    // this platform (the gateway's auth floor is anyExchange().authenticated();
    // the only permitAll federation read — the vanity profile resolve — serves
    // registry profile fragments, not user cards). PUBLIC visibility means
    // "visible to other AUTHENTICATED readers of the designed surfaces", so the
    // honest signed-out assertion is the 401 refusal on the REAL slug.
    const card = cardOf(baseSlug);
    await page.goto('/');
    responseState.lastStatus = await page.evaluate(async (slug) => {
      const r = await fetch(`/bff/user/cards/${encodeURIComponent(slug)}`);
      return r.status;
    }, card.slug);
  },
);

// ── Cards — UI publish (the real editor flow) ────────────────────────────────

When('{string} slugs the card {string}', async ({ user }, username: string, baseSlug: string) => {
  // Uniquify so a repeat run against a live stack cannot pass on a stale row;
  // the nonce is lowercase alnum so the slug stays URL-safe per the helptext.
  const slug = `${baseSlug}-${scenarioNonce()}`;
  scenarioState.cards.set(baseSlug, { slug, contentHash: '', bodyText: '' });
  await pageOf(user(username).username).locator('[data-testid="cards-slug"]').fill(slug);
});

When('{string} writes the card section {string}', async ({ user }, username: string, text: string) => {
  // The sandboxed WYSIWYG editor renders one empty section by default; its body
  // textarea is section-body-0. Content here satisfies publish()'s "at least
  // one section with content" precondition.
  await pageOf(user(username).username).locator('[data-testid="section-body-0"]').fill(text);
});

When('{string} sets the card visibility to {string}', async ({ user }, username: string, visibility: string) => {
  await pageOf(user(username).username).locator('[data-testid="cards-visibility"]').selectOption(visibility);
});

When('{string} submits the card editor', async ({ user }, username: string) => {
  await pageOf(user(username).username).locator('[data-testid="cards-publish"]').click();
});

Then(
  '{string} sees the card published confirmation for {string}',
  async ({ user }, username: string, baseSlug: string) => {
    // cards-status only carries `Card "<slug>" published.` after the BFF PUT
    // resolved (a failed publish writes the could-not-publish message instead,
    // and a validation miss renders cards-error) — so this is a real success
    // oracle, not a render check.
    const card = cardOf(baseSlug);
    const page = pageOf(user(username).username);
    await expect(page.locator('[data-testid="cards-status"]'))
      .toHaveText(`Card "${card.slug}" published.`, { timeout: 15_000 });
    await expect(page.locator('[data-testid="cards-error"]')).toHaveCount(0);
  },
);

Then('{string} sees a card row for {string}', async ({ user }, username: string, baseSlug: string) => {
  // The list row is fed by the owner-scoped re-fetch after the PUT — it only
  // exists when the server really stored the version.
  const card = cardOf(baseSlug);
  const page = pageOf(user(username).username);
  await expect(page.locator(`[data-testid="cards-rows"] tr[data-card-slug="${card.slug}"]`))
    .toBeVisible({ timeout: 15_000 });
});

// ── Connected clients — capture-then-attack (rows are minted by real external
//    client connects, so the victim CAPTURES an existing own row instead of
//    creating one; an empty list fails loudly rather than passing on nothing) ─

Given(
  '{string} captures their first connected client id',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    const clients = await page.evaluate(async () => {
      const r = await fetch('/bff/user/connected-clients', { credentials: 'include' });
      if (!r.ok) throw new Error(`GET /bff/user/connected-clients → ${r.status}`);
      return (await r.json()) as Array<{ id?: string }>;
    });
    const id = clients?.[0]?.id;
    // Honest precondition: no row means this scenario CANNOT prove anything —
    // fail loudly (seed a connected client for this user) instead of "passing"
    // against a fabricated id.
    if (!id) {
      throw new Error(
        `"${username}" has no connected clients — seed one (connect an external client) before this scenario can prove the cross-user revoke DENY.`,
      );
    }
    scenarioState.clientIds.set(user(username).username, id);
  },
);

When(
  '{string} attempts to revoke {string}\'s captured connected client via the BFF',
  async ({ user }, attacker: string, victim: string) => {
    const id = scenarioState.clientIds.get(user(victim).username);
    if (!id) throw new Error(`No connected client captured for "${victim}" in this scenario.`);
    const page = pageOf(user(attacker).username);
    responseState.lastStatus = await page.evaluate(
      async ([clientId]) => {
        const r = await fetch(`/bff/user/connected-clients/${encodeURIComponent(clientId)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        return r.status;
      },
      [id] as const,
    );
  },
);

Then(
  '{string} still lists their captured connected client',
  async ({ user }, username: string) => {
    const id = scenarioState.clientIds.get(user(username).username);
    if (!id) throw new Error(`No connected client captured for "${username}" in this scenario.`);
    const page = pageOf(user(username).username);
    const ids = await page.evaluate(async () => {
      const r = await fetch('/bff/user/connected-clients', { credentials: 'include' });
      if (!r.ok) throw new Error(`GET /bff/user/connected-clients → ${r.status}`);
      return ((await r.json()) as Array<{ id?: string }>).map((c) => c.id ?? '');
    });
    expect(ids).toContain(id);
  },
);

// ── Self-silence — independence (subject-only; there is no cross-user address
//    channel at all: activate/status/cancel all derive the owner from the JWT) ─

When(
  '{string} activates a self-silence ending in {int} minutes via the BFF',
  async ({ user }, username: string, minutes: number) => {
    const page = pageOf(user(username).username);
    const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
    const status = await page.evaluate(
      async ([until]) => {
        const r = await fetch('/bff/user/self-silence/activate', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresAt: until, reason: 'e2e independence probe' }),
        });
        return r.status;
      },
      [expiresAt] as const,
    );
    expect(status, 'self-silence activate must succeed (200)').toBe(200);
  },
);

Then('{string} has an active self-silence', async ({ user }, username: string) => {
  expect(await selfSilenceActiveFor(pageOf(user(username).username))).toBe(true);
});

Then('{string} has no active self-silence', async ({ user }, username: string) => {
  expect(await selfSilenceActiveFor(pageOf(user(username).username))).toBe(false);
});

When('{string} cancels their own self-silence via the BFF', async ({ user }, username: string) => {
  // The ALLOW form: the caller HAS an active silence, so the subject-only
  // cancel must really succeed. (For the nothing-active probe use the
  // "attempts to cancel" step below — cancel-with-nothing-active is a 404 by
  // contract, so asserting 204 there would be a step that can never pass.)
  const page = pageOf(user(username).username);
  const status = await page.evaluate(async () => {
    const r = await fetch('/bff/user/self-silence/cancel', { method: 'POST', credentials: 'include' });
    return r.status;
  });
  expect(status, 'self-silence cancel must succeed (204)').toBe(204);
});

When(
  '{string} attempts to cancel their own self-silence via the BFF',
  async ({ user }, username: string) => {
    // The independence probe: fire the subject-only cancel WITHOUT asserting
    // success — user-bff SelfSilenceService.cancel answers 404 ("no active
    // self-silence to cancel") when the CALLER has nothing active, which is
    // exactly what the subject-only-channel scenarios assert next.
    const page = pageOf(user(username).username);
    responseState.lastStatus = await page.evaluate(async () => {
      const r = await fetch('/bff/user/self-silence/cancel', { method: 'POST', credentials: 'include' });
      return r.status;
    });
  },
);

// ── Login sessions — capture-then-attack (the session row is REAL: it was
//    minted by this scenario's own login) ────────────────────────────────────

Given('{string} captures their current login session id', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const rows = await page.evaluate(async () => {
    const r = await fetch('/bff/user/sessions', { credentials: 'include' });
    if (!r.ok) throw new Error(`GET /bff/user/sessions → ${r.status}`);
    return (await r.json()) as Array<{ id?: string }>;
  });
  const id = rows?.[0]?.id;
  if (!id) {
    throw new Error(`"${username}" lists no login sessions even though they just logged in — cannot capture the oracle id.`);
  }
  scenarioState.sessionIds.set(user(username).username, id);
});

When(
  '{string} attempts to revoke {string}\'s login session via the BFF',
  async ({ user }, attacker: string, victim: string) => {
    const id = scenarioState.sessionIds.get(user(victim).username);
    if (!id) throw new Error(`No login session captured for "${victim}" in this scenario.`);
    const page = pageOf(user(attacker).username);
    responseState.lastStatus = await page.evaluate(
      async ([sessionId]) => {
        const r = await fetch(`/bff/user/sessions/${encodeURIComponent(sessionId)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        return r.status;
      },
      [id] as const,
    );
  },
);

Then('{string} still lists their login session', async ({ user }, username: string) => {
  const id = scenarioState.sessionIds.get(user(username).username);
  if (!id) throw new Error(`No login session captured for "${username}" in this scenario.`);
  const page = pageOf(user(username).username);
  const ids = await page.evaluate(async () => {
    const r = await fetch('/bff/user/sessions', { credentials: 'include' });
    if (!r.ok) throw new Error(`GET /bff/user/sessions → ${r.status}`);
    return ((await r.json()) as Array<{ id?: string }>).map((s) => s.id ?? '');
  });
  expect(ids).toContain(id);
});

// ── Recommend-instance-block — real form submit + API echo ───────────────────

/** The BFF echo captured from the REAL form submit (the UI swallows the JSON,
 *  so the step snapshots the response in flight). Reset per scenario is not
 *  needed — each submit overwrites it and the assertion step follows its own
 *  submit in the same scenario. */
let recommendEcho: { status: number; json: unknown } = { status: 0, json: null };

When(
  '{string} recommends a block on instance {string} via the form',
  async ({ user }, username: string, baseInstance: string) => {
    const page = pageOf(user(username).username);
    // Uniquify as a subdomain so repeat live runs mint distinct moderation rows
    // while the value stays a plausible instance domain.
    const fullInstance = `e2e-${scenarioNonce()}.${baseInstance}`;
    scenarioState.uniqueNames.set(baseInstance, fullInstance);
    await page.locator('[data-testid="recommend-instance"]').fill(fullInstance);
    await page.locator('[data-testid="recommend-reason"]').fill('e2e: flagged for moderator review (harness probe).');
    // Click the REAL control and capture the REAL BFF response in flight — the
    // retrievability oracle (the created moderation request comes back in the
    // echo: recommended:true + the federation row with status=recommended).
    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/bff/user/recommend-instance-block') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      page.locator('[data-testid="recommend-submit"]').click(),
    ]);
    recommendEcho = {
      status: resp.status(),
      json: await resp.json().catch(() => null),
    };
  },
);

Then(
  '{string} sees the recommendation confirmation for {string}',
  async ({ user }, username: string, baseInstance: string) => {
    const fullInstance = scenarioState.uniqueNames.get(baseInstance);
    if (!fullInstance) throw new Error(`No recommendation for "${baseInstance}" was submitted in this scenario.`);
    const page = pageOf(user(username).username);
    // The polite status line only carries this exact text after the POST
    // resolved OK (the catch branch writes the could-not-submit message).
    await expect(page.locator('[data-testid="recommend-status"]'))
      .toHaveText(`Recommended a block on "${fullInstance}" for moderator review.`, { timeout: 15_000 });
    await expect(page.locator('[data-testid="recommend-error"]')).toHaveCount(0);
  },
);

Then(
  'the recommendation for {string} is acknowledged with a moderation request id',
  async ({}, baseInstance: string) => {
    const fullInstance = scenarioState.uniqueNames.get(baseInstance);
    if (!fullInstance) throw new Error(`No recommendation for "${baseInstance}" was submitted in this scenario.`);
    // The API echo is the user-side retrievability proof: the BFF answers the
    // submit with the created federation moderation request (the mod-queue view
    // of the same row lives in mod-ui's suite). recommended:true + the row's
    // server-issued id + status=recommended, per BlockService/ModerationController.
    expect(recommendEcho.status).toBe(200);
    const body = recommendEcho.json as {
      recommended?: boolean;
      instance?: string;
      federation?: { id?: number | string; status?: string };
    } | null;
    expect(body?.recommended).toBe(true);
    expect(body?.instance).toBe(fullInstance);
    expect(body?.federation?.id).toBeTruthy();
    expect(body?.federation?.status).toBe('recommended');
  },
);

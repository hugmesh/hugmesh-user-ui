// Notifications inbox — seeded-fixture step definitions. Prior to
// TestSeedNotificationController (user-bff-api PR, POST
// /bff/user/notifications/test-seed, TEST/SEED-ONLY, ships dark behind
// app.test-seed.enabled), there was NO user-reachable way to create a real
// user_notifications row — the only production writer is the ROLE_SERVICE-gated
// InternalNotificationController, called by the hugmesh-actions reconciler,
// unreachable from any human/browser session. profile-preferences-notifications
// .feature's header records that gap explicitly. These steps close it:
// victim-creates-first via the seed endpoint (self-only — the seeded row is
// really the victim's own), then drive mark-as-read + unread-count through the
// REAL UI, plus the cross-user DENY half of the pair via direct BFF calls.
//
// The unread-count oracle is a BEFORE/AFTER DELTA (captured, then asserted to
// have moved by exactly ±1), never an absolute value — a persistent live stack
// may already carry notifications from earlier runs for the same seed persona,
// and an absolute "count == 1" assertion would be dishonest (it would only pass
// by accident on a freshly-reset stack).
//
// Markup under test (notifications.component.html):
//   - unread-badge (heading count; ONLY rendered while count > 0);
//   - data-notification-id="<id>" on each <li>;
//   - data-mark-read="<id>" on the mark-as-read <button> (rendered only while
//     the row is unread — its disappearance IS the "now read" oracle);
//   - notifications-status (role=status, "Notification marked as read." on a
//     successful mark-read).

import { Page, expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, responseState, scenarioState, scenarioNonce } from './_registry';

function pageOf(username: string): Page {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

function notificationOf(featureName: string, realUsername: string) {
  const n = scenarioState.notifications.get(realUsername);
  if (!n) {
    throw new Error(
      `No seeded notification for "${featureName}" in this scenario — seed one first ` +
        `("... seeds a notification for themselves via the test-seed endpoint").`,
    );
  }
  return n;
}

/** The heading badge only exists in the DOM while unreadCount > 0 — absence
 *  means zero, not "unknown". */
async function unreadCountFor(page: Page): Promise<number> {
  const badge = page.locator('[data-testid="unread-badge"]');
  if ((await badge.count()) === 0) return 0;
  const text = (await badge.innerText()).trim();
  const n = Number.parseInt(text, 10);
  return Number.isNaN(n) ? 0 : n;
}

// ── Seed (victim-creates-first, self-only) ──────────────────────────────────

/** Fire ONE real self-only test-seed for `realUsername` in `category`, capturing
 *  the server's {id, delivered} outcome into scenarioState.notifications. Shared
 *  by the generic and the category-parameterised seed steps. Does NOT assert the
 *  `delivered` flag — the caller decides whether delivery is expected (a muted
 *  category legitimately reports delivered=false), so this helper only asserts
 *  the seed request itself succeeded (200) and returned a row id. */
async function seedFor(realUsername: string, category: string): Promise<{ id: string; delivered: boolean }> {
  const page = pageOf(realUsername);
  // Unique per call so repeated seeds in one scenario (or repeat live runs)
  // never collide on the deterministic sourceTable+sourceId hash — each call
  // must mint a genuinely NEW row, not a deduped retry of a prior one.
  const sourceId = `e2e-seed-${scenarioNonce()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await page.evaluate(
    async ([sid, cat]) => {
      const r = await fetch('/bff/user/notifications/test-seed', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: cat,
          title: 'E2E seeded notification',
          body: 'seed-e2e fixture',
          sourceId: sid,
        }),
      });
      let json: unknown = null;
      try {
        json = await r.json();
      } catch {
        json = null;
      }
      return { status: r.status, json };
    },
    [sourceId, category] as const,
  );
  // Honest ALLOW: the seed REQUEST must really have succeeded — a misconfigured
  // stack (app.test-seed.enabled=false) must fail this scenario LOUDLY (503),
  // never let a later step silently pass against a fabricated/absent id.
  expect(
    result.status,
    'victim notification seed must succeed (200) — is app.test-seed.enabled=true on this stack?',
  ).toBe(200);
  const body = result.json as { id?: string; delivered?: boolean } | null;
  if (!body?.id) {
    throw new Error('test-seed response carried no id — cannot run the victim-creates-first oracle');
  }
  const delivered = body.delivered === true;
  scenarioState.notifications.set(realUsername, { id: body.id, sourceId, category, delivered });
  return { id: body.id, delivered };
}

When(
  '{string} seeds a notification for themselves via the test-seed endpoint',
  async ({ user }, username: string) => {
    // Uses 'account-restriction' — the forced-on category — so this generic seed
    // is delivered REGARDLESS of any category preference state on a persistent
    // stack. (Previously hardcoded 'role-change', which collided with
    // profile-preferences-notifications.feature leaving carol's 'role-change'
    // OFF: a rerun on a persistent stack would suppress the seed and this step's
    // delivered=true assertion would flap. account-restriction cannot be muted,
    // so delivered=true is a real, coupling-free invariant here.)
    const { delivered } = await seedFor(user(username).username, 'account-restriction');
    expect(delivered, 'a forced-on account-restriction seed must be delivered, not suppressed').toBe(true);
  },
);

When(
  '{string} seeds a {string} notification for themselves via the test-seed endpoint',
  async ({ user }, username: string, category: string) => {
    // Category-parameterised seed — delivery is NOT asserted here; the delivery
    // scenario asserts delivered/suppressed explicitly via the steps below, so a
    // muted category (delivered=false) is a valid, expected outcome.
    await seedFor(user(username).username, category);
  },
);

Then("{string}'s last seeded notification was delivered", async ({ user }, username: string) => {
  const n = scenarioState.notifications.get(user(username).username);
  if (!n) throw new Error(`No seeded notification for "${username}" in this scenario.`);
  expect(n.delivered, `the "${n.category}" seed must be delivered (not suppressed)`).toBe(true);
});

Then("{string}'s last seeded notification was suppressed", async ({ user }, username: string) => {
  const n = scenarioState.notifications.get(user(username).username);
  if (!n) throw new Error(`No seeded notification for "${username}" in this scenario.`);
  // The consequence of muting a category: the delivery service reports the seed
  // as NOT delivered (delivered=false) — the real suppression path, not a UI
  // round-trip of a stored toggle.
  expect(n.delivered, `the muted "${n.category}" seed must be suppressed (delivered=false)`).toBe(false);
});

Then(
  "{string}'s inbox does not contain their last seeded notification",
  async ({ user }, username: string) => {
    const real = user(username).username;
    const n = scenarioState.notifications.get(real);
    if (!n) throw new Error(`No seeded notification for "${username}" in this scenario.`);
    // A suppressed notification was never written, so the owner's own inbox
    // re-read must not carry its (deterministic) id — the database is the witness.
    const ids = await pageOf(real).evaluate(async () => {
      const r = await fetch('/bff/user/notifications', { credentials: 'include' });
      if (!r.ok) throw new Error(`GET /bff/user/notifications -> ${r.status}`);
      return ((await r.json()) as Array<{ id?: string }>).map((x) => x.id ?? '');
    });
    expect(ids).not.toContain(n.id);
  },
);

// ── ALLOW — the owner sees, counts, and marks read their OWN seeded row ──────

Then('{string} sees their seeded notification in the inbox', async ({ user }, username: string) => {
  const real = user(username).username;
  const n = notificationOf(username, real);
  await expect(pageOf(real).locator(`[data-notification-id="${n.id}"]`)).toBeVisible({ timeout: 15_000 });
});

Then('{string} captures their current unread count', async ({ user }, username: string) => {
  const real = user(username).username;
  scenarioState.unreadCounts.set(real, await unreadCountFor(pageOf(real)));
});

Then("{string}'s unread count increased by 1", async ({ user }, username: string) => {
  const real = user(username).username;
  const before = scenarioState.unreadCounts.get(real);
  if (before === undefined) {
    throw new Error(`No captured baseline unread count for "${username}" — add the "captures their current unread count" step first.`);
  }
  const page = pageOf(real);
  await expect
    .poll(async () => unreadCountFor(page), { timeout: 15_000 })
    .toBe(before + 1);
});

Then("{string}'s unread count decreased by 1", async ({ user }, username: string) => {
  const real = user(username).username;
  const before = scenarioState.unreadCounts.get(real);
  if (before === undefined) {
    throw new Error(`No captured baseline unread count for "${username}" — add the "captures their current unread count" step first.`);
  }
  const page = pageOf(real);
  await expect
    .poll(async () => unreadCountFor(page), { timeout: 15_000 })
    .toBe(before - 1);
});

When('{string} marks their seeded notification as read', async ({ user }, username: string) => {
  const real = user(username).username;
  const n = notificationOf(username, real);
  await pageOf(real).locator(`[data-mark-read="${n.id}"]`).click();
});

Then(
  "{string} sees the notification marked as read confirmation",
  async ({ user }, username: string) => {
    const real = user(username).username;
    await expect(pageOf(real).locator('[data-testid="notifications-status"]')).toHaveText(
      'Notification marked as read.',
      { timeout: 15_000 },
    );
  },
);

Then(
  "{string}'s seeded notification no longer shows a mark-as-read control",
  async ({ user }, username: string) => {
    const real = user(username).username;
    const n = notificationOf(username, real);
    await expect(pageOf(real).locator(`[data-mark-read="${n.id}"]`)).toHaveCount(0);
  },
);

// ── Cross-user DENY — victim-creates-first, attacker blocked, victim untouched ─

Then(
  "{string}'s inbox does not contain {string}'s seeded notification",
  async ({ user }, observer: string, victim: string) => {
    const victimReal = user(victim).username;
    const n = notificationOf(victim, victimReal);
    const observerReal = user(observer).username;
    const page = pageOf(observerReal);
    const ids = await page.evaluate(async () => {
      const r = await fetch('/bff/user/notifications', { credentials: 'include' });
      if (!r.ok) throw new Error(`GET /bff/user/notifications -> ${r.status}`);
      return ((await r.json()) as Array<{ id?: string }>).map((x) => x.id ?? '');
    });
    expect(ids).not.toContain(n.id);
  },
);

When(
  "{string} attempts to mark {string}'s seeded notification as read via the BFF",
  async ({ user }, attacker: string, victim: string) => {
    const victimReal = user(victim).username;
    const n = notificationOf(victim, victimReal);
    const attackerReal = user(attacker).username;
    const page = pageOf(attackerReal);
    responseState.lastStatus = await page.evaluate(
      async ([id]) => {
        const r = await fetch(`/bff/user/notifications/${encodeURIComponent(id)}/read`, {
          method: 'POST',
          credentials: 'include',
        });
        return r.status;
      },
      [n.id] as const,
    );
  },
);

Then("{string}'s seeded notification is still unread", async ({ user }, victim: string) => {
  const victimReal = user(victim).username;
  const n = notificationOf(victim, victimReal);
  const page = pageOf(victimReal);
  // RE-READ via the owner's own BFF call — the database is the witness, not
  // just the attacker's HTTP status.
  const rows = await page.evaluate(async () => {
    const r = await fetch('/bff/user/notifications', { credentials: 'include' });
    if (!r.ok) throw new Error(`GET /bff/user/notifications -> ${r.status}`);
    return (await r.json()) as Array<{ id?: string; readAt?: string | null }>;
  });
  const row = rows.find((x) => x.id === n.id);
  if (!row) throw new Error(`victim's seeded notification ${n.id} was not found in their own inbox re-read`);
  expect(
    row.readAt ?? null,
    "victim's notification must remain unread after the denied cross-user mark-as-read",
  ).toBeNull();
});

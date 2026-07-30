// PLATFORM-ROLE DENY-FLOOR step definitions.
//
// Three user-bff-api surfaces are gated on a HOMESERVER PLATFORM role
// (`hasAnyRole('MATRIX','MASTODON')`) rather than on the ROLE_USER floor:
//   - POST /bff/user/blocks with platform matrix|mastodon
//   - POST /bff/user/recommend-instance-block
//   - GET  /bff/user/connected-clients      (external-client role)
// mutation-steps.ts deliberately uses platform 'internal' BECAUSE of that gate,
// but nothing ever asserted the gate itself — so the fail-closed floor the UI
// mirrors claims to defend in depth was unproven.
//
// Honesty rules applied here:
//   - A DENY is only meaningful next to a matching ALLOW. Each API floor is
//     asserted for a role-LACKING user AND (where a seed persona exists) for the
//     role-HOLDING user, so a blanket 403 — a broken endpoint denying everyone —
//     cannot pass as "the gate works".
//   - The recommend DENY additionally proves the SIDE EFFECT did not happen: no
//     moderation-request id is minted. A bare status assertion cannot tell a
//     rejected write from an accepted-but-unacknowledged one.
//   - The self-block DENY re-reads the victim's own list afterwards, so the
//     database is the witness that the refused row was never created.

import { expect } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, responseState, scenarioState, scenarioNonce } from './_registry';
import { blockRowsFor } from '../../tests/helpers/poll';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

// The attempted target and the recommend echo live in scenarioState (reset by
// the Before/After hooks in support/fixtures.ts) rather than in module-level
// `let`s: step files load ONCE per worker, so a module-level value would carry
// a previous scenario's result into the next one — and a no-side-effect oracle
// that can read a stale body is not an oracle.

// ── Self-block create on a platform-gated platform ──────────────────────────

When(
  '{string} attempts to create a {string}-platform self-block via the BFF',
  async ({ user }, username: string, platform: string) => {
    const page = pageOf(user(username).username);
    scenarioState.attemptedBlockTarget = `@gated-${scenarioNonce()}:bad.example.org`;
    responseState.lastStatus = await page.evaluate(
      async ([p, target]) => {
        const r = await fetch('/bff/user/blocks', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: p, target }),
        });
        return r.status;
      },
      [platform, scenarioState.attemptedBlockTarget] as const,
    );
  },
);

Then(
  '{string} has no self-block for the attempted target',
  async ({ user }, username: string) => {
    // The refused write must leave NO row. Asserted against the specific
    // uniquified target rather than "the list is empty" — the seed user may
    // legitimately hold blocks from other scenarios.
    const attemptedBlockTarget = scenarioState.attemptedBlockTarget;
    if (!attemptedBlockTarget) {
      throw new Error('No platform-gated self-block was attempted in this scenario.');
    }
    const rows = await blockRowsFor(pageOf(user(username).username));
    expect(rows.map((b) => b.target)).not.toContain(attemptedBlockTarget);
  },
);

// ── recommend-instance-block ────────────────────────────────────────────────

When(
  '{string} attempts to recommend an instance block via the BFF',
  async ({ user }, username: string) => {
    const page = pageOf(user(username).username);
    const instance = `gated-${scenarioNonce()}.bad.example.org`;
    const echo = await page.evaluate(async (inst) => {
      const r = await fetch('/bff/user/recommend-instance-block', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance: inst, reason: 'e2e platform-role floor probe' }),
      });
      let parsed: unknown = null;
      try {
        parsed = await r.json();
      } catch {
        parsed = null;
      }
      return { status: r.status, json: parsed };
    }, instance);
    scenarioState.recommendEcho = echo;
    responseState.lastStatus = echo.status;
  },
);

Then('no moderation request id was minted', async ({}) => {
  // The side-effect oracle. On the ALLOW path the BFF echoes a server-issued
  // id (see "the recommendation for X is acknowledged with a moderation request
  // id" in mutation-steps.ts); a refused call must carry none, so a 403 that
  // still queued work cannot pass.
  const body = scenarioState.recommendEcho.json as Record<string, unknown> | null;
  const id = body?.['id'] ?? body?.['requestId'] ?? body?.['moderationRequestId'];
  expect(id, 'a DENIED recommendation must not mint a moderation-request id').toBeFalsy();
});

Then('a moderation request id was minted', async ({}) => {
  // The ALLOW contrast — proves the 403 above is the ROLE gate and not a
  // uniformly broken endpoint.
  const body = scenarioState.recommendEcho.json as Record<string, unknown> | null;
  expect(body, 'expected a JSON body on the accepted recommendation').toBeTruthy();
  const id = body?.['id'] ?? body?.['requestId'] ?? body?.['moderationRequestId'];
  expect(String(id ?? ''), 'expected a server-issued moderation-request id').not.toHaveLength(0);
});

// ── CLIENT-SIDE mirror of the same gate (offline-safe) ──────────────────────
// These back features/self-service/recommend-gate-client-side.feature. They
// touch no network: the gate is a pure computed signal over the roles already
// in `hug.session`, and submit() early-returns before any BlockService call.

Then(
  '{string} sees the {string} control described by the {string} helptext',
  async ({ user }, username: string, testid: string, helpTestid: string) => {
    // Precise association assertion. The generic a11y step
    // ("the {string} field is described by help text") only proves that the
    // FIRST id in aria-describedby resolves — and the submit button always
    // lists recommend-submit-help first, so it would pass even with the gate
    // helptext missing. This asserts the SPECIFIC id is referenced AND that it
    // resolves to the element carrying the given testid, so a dangling or
    // renamed id fails.
    const page = pageOf(user(username).username);
    const control = page.locator(`[data-testid="${testid}"]`);
    await expect(control).toBeVisible();

    const help = page.locator(`[data-testid="${helpTestid}"]`);
    await expect(help).toHaveCount(1);
    const helpId = await help.getAttribute('id');
    expect(helpId, `[data-testid="${helpTestid}"] must carry an id to be referenced`).toBeTruthy();

    const describedby = (await control.getAttribute('aria-describedby')) ?? '';
    expect(
      describedby.split(/\s+/).filter(Boolean),
      `${testid} must reference ${helpTestid} (id="${helpId}") in aria-describedby`,
    ).toContain(helpId!);
  },
);

Then('{string} sees no recommendation confirmation', async ({ user }, username: string) => {
  // The no-side-effect half of the client-side gate. submit() early-returns
  // when the platform role is absent, so the status live region must still be
  // EMPTY — neither the success text nor the "Could not submit" failure text.
  // (Asserting only the absence of the success text would also pass when the
  // request WAS sent and failed, which is exactly the behaviour being fixed.)
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="recommend-status"]')).toHaveText('');
});

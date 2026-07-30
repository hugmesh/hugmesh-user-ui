// Shared per-scenario state. playwright-bdd recreates the test instance for
// each scenario so we reset these maps in the After() hook in
// features/support/fixtures.ts. Keys are usernames so steps can reference a user
// by name without threading a token/page through.

import { BrowserContext, Page } from '@playwright/test';

export const pageRegistry = new Map<string, Page>();
export const ctxRegistry = new Map<string, BrowserContext>();

/** Last HTTP status code captured by an API-style step (the cross-user DENY
 *  assertions read this). Module-global instead of test-info attached so the
 *  assertion step doesn't need to thread the World through. Cleared on
 *  scenario teardown. */
export const responseState = { lastStatus: 0, lastBodyText: '' };

/** Per-scenario state for the REAL-WRITE (mutation) scenarios. `nonce` makes
 *  every created resource name unique per run (repeat runs against a live
 *  stack must not collide); the maps translate the declarative names used in
 *  .feature lines to the real, server-issued ids / uniquified values — the
 *  victim-creates-first oracle (a DENY is only meaningful against a REAL
 *  resource id the victim captured; a 404 on a fabricated id proves nothing).
 *  Cleared on scenario teardown. */
export const scenarioState = {
  nonce: '',
  /** Victim-created self-blocks: feature-file target → { id (server UUID), fullTarget }. */
  blocks: new Map<string, { id: string; fullTarget: string }>(),
  /** Victim-published cards: feature-file slug → { slug (uniquified),
   *  contentHash, bodyText (the exact source the victim published — the
   *  no-content-leak oracle for cross-owner body reads) }. */
  cards: new Map<string, { slug: string; contentHash: string; bodyText: string }>(),
  /** Captured login-session ids: username → their own current bff_ session id. */
  sessionIds: new Map<string, string>(),
  /** Connected-client ids captured from a user's own list: username → client id. */
  clientIds: new Map<string, string>(),
  /** Uniquified values typed into UI forms: feature-file value → real value. */
  uniqueNames: new Map<string, string>(),
  /** Victim-created (test-seed) in-app notifications: REAL username → { id
   *  (server-issued deterministic id), sourceId (the seed request's sourceId),
   *  category (the seeded category) and delivered (the seed result's delivered
   *  flag — false when a category-preference suppressed it) }.
   *  The victim-creates-first oracle for the notifications inbox — a DENY
   *  against a fabricated id proves nothing, so every cross-user notification
   *  scenario attacks an id captured here from a REAL seed call. The category +
   *  delivered fields back the notification-preference DELIVERY assertions
   *  (a muted category reports delivered=false and never reaches the inbox). */
  notifications: new Map<
    string,
    { id: string; sourceId: string; category?: string; delivered?: boolean }
  >(),
  /** Baseline unread-badge counts captured before a seed/mark-read mutation:
   *  REAL username → count. The unread-count oracle is a BEFORE/AFTER delta
   *  (not an absolute value), so repeated live runs against a persistent stack
   *  never collide with notifications left over from earlier runs. */
  unreadCounts: new Map<string, number>(),
  /** EXACT text authored into the card editor, keyed `<baseSlug>#<index>` for
   *  section bodies, `title:<baseSlug>#<index>` for section titles and
   *  `css:<baseSlug>` for the scoped style block. The edit-prefill oracle
   *  compares the reopened editor against these strings verbatim: readBody →
   *  decodeDocument must be a LOSSLESS round-trip of encodeDocument, and a
   *  "field is non-empty" check would not catch a codec that dropped a section
   *  or the CSS. */
  cardAuthoring: new Map<string, string>(),
  /** versionDir read off a card's row BEFORE a republish: baseSlug → version.
   *  The republish oracle is a delta from this, never a hardcoded version, so
   *  it holds on a persistent stack with pre-existing version history. */
  cardVersions: new Map<string, string>(),
  /** The uniquified target the last platform-gated self-block attempt used, so
   *  the follow-up owner-scoped list re-read can prove THAT row is absent
   *  (asserting an empty list would fail for a user holding unrelated blocks). */
  attemptedBlockTarget: '',
  /** Status + parsed body of the last recommend-instance-block attempt. The
   *  DENY oracle checks no moderation-request id was minted — a 403 that still
   *  queued work must not pass on the status code alone. */
  recommendEcho: { status: 0, json: null as unknown },
};

/** Lazily mint the per-scenario uniquifier (lowercase alnum, DNS-label safe). */
export function scenarioNonce(): string {
  if (!scenarioState.nonce) {
    scenarioState.nonce =
      Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  return scenarioState.nonce;
}

export function resetRegistry(): void {
  pageRegistry.clear();
  ctxRegistry.clear();
  responseState.lastStatus = 0;
  responseState.lastBodyText = '';
  scenarioState.nonce = '';
  scenarioState.blocks.clear();
  scenarioState.cards.clear();
  scenarioState.sessionIds.clear();
  scenarioState.clientIds.clear();
  scenarioState.uniqueNames.clear();
  scenarioState.notifications.clear();
  scenarioState.unreadCounts.clear();
  scenarioState.cardAuthoring.clear();
  scenarioState.cardVersions.clear();
  scenarioState.attemptedBlockTarget = '';
  scenarioState.recommendEcho = { status: 0, json: null };
}

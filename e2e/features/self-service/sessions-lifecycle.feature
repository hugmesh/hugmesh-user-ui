# ACTIVE LOGIN SESSIONS — the /sessions surface had ZERO UI e2e: nothing
# navigated to it, asserted the "This device" marker, revoked through the UI, or
# proved the security-critical consequence — that revoking your OTHER device's
# session actually SIGNS THAT DEVICE OUT (its next /bff call 401s). The
# elevated-role suite only covers the BFF-level revoke DENY for admin/superadmin;
# a PLAIN user (bob) attacking alice's captured session id was untested. This
# file closes all of it.
#
# Honest oracles:
#   - The cross-device kill is proven end-to-end: device B captures its OWN
#     current session id, device A clicks the REAL revoke button for that row,
#     and device B's next authenticated call is REJECTED (401) — the consequence
#     that makes revocation real, not just a row disappearing from a list.
#   - The cross-user DENY is victim-creates-first: alice captures her REAL
#     current session id, bob (own context) is DENIED revoking it (404), and
#     alice still lists it — the database is the witness.
#
# Verified against source before writing this file:
#   - sessions.component.html: data-testid="sessions-view", "sessions-rows"
#     table, per-row data-session-id, revoke button data-testid="session-revoke"
#     + data-revoke="<id>"; label() renders "This device (<id>)" for the current
#     session.
#   - SessionsService: GET /bff/user/sessions (rows carry current:boolean),
#     DELETE /bff/user/sessions/{id}; the BFF derives the owner from the JWT and
#     validates the target belongs to the caller before deleting.
#   - mutation-steps.ts already provides the capture + cross-user attack + owner
#     re-read steps for the plain-user DENY half.
#
# @cluster — needs the host shell + a live session + user-bff-api.
@cluster @user-ui @user-situational
Feature: Active login sessions — render, own cross-device revoke, and cross-user DENY
  As a user with more than one signed-in device
  I must see my sessions, sign a device out from another, and never touch anyone else's
  So a stolen or stale device can be killed and only its owner can kill it

  # ── Render: the surface lists my sessions and marks THIS device ────────────
  Scenario: a user reaches their active sessions and sees the this-device marker (ALLOW)
    Given "alice" is logged in in their own context
    When "alice" navigates to "/sessions"
    Then "alice" sees the "sessions-view" view
    And "alice" sees a row for "This device"

  # ── Cross-device kill: revoke device B from device A and B is signed out ───
  Scenario: revoking another of my own devices signs that device out end-to-end
    Given "alice" is logged in on device "A"
    And "alice" is logged in on device "B"
    When "alice" on device "B" captures their current session id
    And "alice" on device "A" navigates to "/sessions"
    Then "alice" on device "A" sees at least 2 session rows
    And "alice" on device "A" sees the this-device marker
    When "alice" on device "A" revokes device "B" via the sessions UI
    Then "alice" on device "B" can no longer make an authenticated call

  # ── Cross-user DENY: a plain user cannot revoke another user's session ─────
  Scenario: a plain user is denied revoking another user's login session and the victim still holds it
    Given "alice" is logged in in their own context
    And "bob" is logged in in their own context
    When "alice" captures their current login session id
    And "bob" attempts to revoke "alice"'s login session via the BFF
    Then the response status is 404
    And "alice" still lists their login session

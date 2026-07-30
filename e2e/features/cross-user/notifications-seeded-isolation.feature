# NOTIFICATIONS — cross-user isolation over REAL seeded rows. The existing
# preferences-notifications-isolation.feature proves the empty-inbox case
# (parallel owner-scoped 200s with nothing to leak); this file extends that
# proof to an inbox that actually HAS a row in it, using the new
# TestSeedNotificationController (POST /bff/user/notifications/test-seed,
# TEST/SEED-ONLY, ships dark behind app.test-seed.enabled).
#
# Every scenario here is victim-creates-first (the attacked notification id is
# a REAL row the victim seeded in this scenario — never a fabricated id, which
# would only prove "no such row exists", not that owner-scoping holds) and each
# DENY is paired with an ALLOW/re-read half: the victim's own copy of the row
# is unaffected by the attacker's denied attempt — the database is the witness,
# not just the attacker's HTTP status.
#
# @cluster — needs a live stack with app.test-seed.enabled=true.
@cluster @user-ui @cross-user
Feature: Notifications inbox — cross-user isolation over a real seeded row
  As the self-service user platform
  I must scope the notification inbox to the JWT subject even when a row exists
  So another user's notification can never be read or marked read by anyone but its owner

  Scenario: a user's inbox never contains another user's seeded notification
    Given "alice" is logged in in their own context
    And "bob" is logged in in their own context
    When "alice" seeds a notification for themselves via the test-seed endpoint
    Then "bob"'s inbox does not contain "alice"'s seeded notification

  Scenario: a user cannot mark another user's seeded notification as read (DENY), and it stays unread for its owner (ALLOW re-read)
    Given "alice" is logged in in their own context
    And "bob" is logged in in their own context
    When "alice" seeds a notification for themselves via the test-seed endpoint
    When "bob" attempts to mark "alice"'s seeded notification as read via the BFF
    Then the response status is 404
    And "alice"'s seeded notification is still unread

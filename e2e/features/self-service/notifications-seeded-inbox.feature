# NOTIFICATIONS INBOX — mark-as-read + unread-count, now that a deterministic
# seed path exists. profile-preferences-notifications.feature's header records
# the prior gap: there was no user-reachable way to create a REAL notification
# row (the only production writer is the ROLE_SERVICE-gated
# InternalNotificationController, called by the hugmesh-actions reconciler —
# unreachable from a human/browser session), so that file could only prove the
# inbox ALLOW-renders and the DENY floor holds, leaving mark-as-read /
# unread-count as a recorded gap. This file closes it using the new
# user-bff-api TEST/SEED-ONLY endpoint (POST /bff/user/notifications/test-seed,
# ships dark behind app.test-seed.enabled) — every scenario is
# victim-creates-first: the notification row is REAL, created through the
# SAME InternalNotificationDeliveryService the production deliver path uses.
#
# The unread-count assertions are a BEFORE/AFTER DELTA (captured, then proven
# to move by exactly ±1) rather than an absolute count, so a persistent live
# stack carrying notifications from earlier runs never produces a false
# pass/fail.
#
# Verified against source before writing this file:
#   - notifications.component.html: data-testid="unread-badge" (only rendered
#     while count > 0), data-notification-id="<id>" per row,
#     data-mark-read="<id>" (mark-as-read button, rendered only while unread),
#     data-testid="notifications-status" ("Notification marked as read." on
#     success).
#   - TestSeedNotificationController (user-bff-api): POST
#     /bff/user/notifications/test-seed — ROLE_USER floor, self-only (target is
#     always the caller's own JWT subject/domain, never a request field),
#     returns {id, delivered, deduped, reason}.
#
# @cluster — needs a live stack with app.test-seed.enabled=true.
@cluster @user-ui @user-situational
Feature: Notifications inbox — mark-as-read and unread count (seeded fixtures)
  As a user with a real notification
  I must be able to see it, see the unread count reflect it, and mark it read
  So the inbox is not just an empty-state screenshot

  Scenario: a user sees their freshly-seeded notification in the inbox (ALLOW)
    Given "alice" is logged in in their own context
    When "alice" seeds a notification for themselves via the test-seed endpoint
    And "alice" navigates to "/notifications"
    Then "alice" sees their seeded notification in the inbox

  Scenario: seeding a notification increases the unread count by exactly one
    Given "carol" is logged in in their own context
    When "carol" navigates to "/notifications"
    Then "carol" captures their current unread count
    When "carol" seeds a notification for themselves via the test-seed endpoint
    And "carol" navigates to "/notifications"
    Then "carol" sees their seeded notification in the inbox
    And "carol"'s unread count increased by 1

  Scenario: a user marks their seeded notification as read and it persists after reload
    Given "bob" is logged in in their own context
    When "bob" seeds a notification for themselves via the test-seed endpoint
    And "bob" navigates to "/notifications"
    Then "bob" sees their seeded notification in the inbox
    And "bob" captures their current unread count
    When "bob" marks their seeded notification as read
    Then "bob" sees the notification marked as read confirmation
    And "bob"'s unread count decreased by 1
    When "bob" navigates to "/notifications"
    Then "bob"'s seeded notification no longer shows a mark-as-read control

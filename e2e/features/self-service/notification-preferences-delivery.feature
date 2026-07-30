# NOTIFICATION-PREFERENCE DELIVERY CONSEQUENCE — the gap the round-trip suites
# leave open. profile-preferences-notifications.feature only proves a toggle's
# STORED value survives a reload; it never proves the CONSEQUENCE: that muting a
# category actually stops a notification in that category from being delivered,
# and that the forced-on account-restriction category is delivered EVEN AFTER an
# attempted opt-out. This file closes both, honestly, through the real delivery
# service.
#
# How it stays honest (not a UI round-trip):
#   - The seed goes through the SAME InternalNotificationDeliveryService the
#     production reconciler uses (TestSeedNotificationController — self-only,
#     ships dark behind app.test-seed.enabled), which applies category-preference
#     suppression and the account-restriction forced-on rule. Its response's
#     `delivered` flag is the server's own verdict, not a client guess.
#   - Suppression is proven two ways: the seed reports delivered=false AND the
#     owner's own inbox re-read never carries the (deterministic) row id — the
#     database is the witness, not just the toggle's stored value.
#   - Each scenario restores the state it changed (leave-no-trace) so a
#     persistent stack does not drift across reruns.
#
# Verified against source before writing this file:
#   - TestSeedNotificationController.SeedResult carries {id, delivered, deduped,
#     reason}; category must be a real NotificationCategory or the deliver path
#     400s (fail-closed).
#   - notification-preferences.component.html: notif-pref-toggle-<category>
#     checkbox, notif-prefs-status "Preference saved." on success; the
#     account-restriction toggle is forced-on (disabled) and the BFF coerces an
#     enabled=false PUT back to true.
#
# @cluster — needs a live stack with app.test-seed.enabled=true.
@cluster @user-ui @user-situational
Feature: Notification-preference delivery — muting suppresses, forced-on cannot be silenced
  As a user who muted a notification category
  I must stop receiving that category, while still always receiving account restrictions
  So my preferences actually change what is delivered, not just what is stored

  # ── Muting a category actually suppresses its delivery ─────────────────────
  Scenario: turning off a category stops a notification in that category from being delivered
    Given "dave" is logged in in their own context
    When "dave" navigates to "/notification-preferences"
    Then "dave" sees the "notification-preferences-view" view
    When "dave" turns off the "feature-availability" notification category
    Then "dave" sees the notification preference saved confirmation
    When "dave" seeds a "feature-availability" notification for themselves via the test-seed endpoint
    Then "dave"'s last seeded notification was suppressed
    When "dave" navigates to "/notifications"
    Then "dave" sees the "notifications-view" view
    And "dave"'s inbox does not contain their last seeded notification
    # Restore the toggle so a persistent stack is left as it was found.
    When "dave" navigates to "/notification-preferences"
    And "dave" turns on the "feature-availability" notification category
    Then "dave" sees the notification preference saved confirmation

  # ── The forced-on category is delivered despite an attempted opt-out ───────
  Scenario: account-restriction is still delivered after an attempt to silence it
    Given "erin" is logged in in their own context
    When "erin" PUTs "/bff/user/notification-preferences" with body "{\"category\":\"account-restriction\",\"enabled\":false}"
    Then the response status is 200
    And the notification-preference response confirms account-restriction is forced on
    When "erin" seeds a "account-restriction" notification for themselves via the test-seed endpoint
    Then "erin"'s last seeded notification was delivered
    When "erin" navigates to "/notifications"
    Then "erin" sees the "notifications-view" view
    And "erin" sees their seeded notification in the inbox

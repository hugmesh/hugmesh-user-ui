# PROFILE EDIT / PREFERENCES / NOTIFICATION-PREFERENCES coverage — the missing
# self-service surfaces from self-service-surfaces.feature's header inventory:
# that file lists /preferences, /notifications and /notification-preferences as
# routes the remote exposes (user.routes.ts) but never actually drives a
# scenario against any of the three, and profile.feature's existing "reaches
# their profile editor" scenario only proves the view renders — never that an
# edit actually SAVES. This file closes both gaps with REAL persist assertions
# (reload from the server and read the saved value back), not just "the form
# submitted" — per the wave's honest-test standard for a preferences save.
#
# Verified against source before writing this file:
#   - profile.component.ts/.html: PUT /bff/user/profile via UserProfileService;
#     data-testid="profile-displayName" / "profile-save" / "profile-status".
#   - preferences.component.ts/.html: GET/PUT /bff/user/preferences via
#     PreferencesService; data-testid="prefs-poison-select" / "prefs-status".
#     The select is disabled until the first load resolves and reflects
#     whatever the server just returned — a real round-trip, not a local echo.
#     NOTE: unlike the other three components here, the root <section> carries
#     NO data-testid of its own (only its inner fieldset/select/status do), so
#     the ALLOW-render oracle below is the "sees element" form against
#     prefs-media-poison-fieldset, not a "sees view" testid.
#   - notification-preferences.component.ts/.html: GET/PUT
#     /bff/user/notification-preferences via NotificationPreferencesService;
#     data-testid="notif-pref-toggle-<category>" / "notif-prefs-status". The
#     'account-restriction' category is FORCED ON — isEnabled() always returns
#     true for it and the checkbox is natively disabled — the un-silenceable
#     invariant the BFF's PreferenceUpsert coercion enforces server-side.
#   - notifications.component.ts/.html: GET /bff/user/notifications (inbox,
#     read/mark-read only). HONEST SCOPE: UserNotificationController itself is
#     read/mark-read only, and the ONLY PRODUCTION writer is the ROLE_SERVICE-
#     gated InternalNotificationController (called by the hugmesh-actions
#     reconciler — unreachable from a human session). This file therefore only
#     proves the ALLOW surface renders and the DENY floor holds against an
#     EMPTY/unseeded inbox. mark-as-read + unread-count + cross-user isolation
#     OVER A REAL ROW are now covered in
#     self-service/notifications-seeded-inbox.feature and
#     cross-user/notifications-seeded-isolation.feature, via the new
#     TEST/SEED-ONLY TestSeedNotificationController (POST
#     /bff/user/notifications/test-seed, self-only, ships dark behind
#     app.test-seed.enabled) — a narrowly-scoped seed mechanism that calls the
#     SAME delivery service the production path uses, not a parallel write.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is
# needed. Compiles + discovers offline (a no-filter bddgen + `playwright test
# --list` proves it).
@cluster @user-ui @user-situational
Feature: Profile edit, preferences and notification-preferences — real persist, not just submit
  As a user of the self-service surfaces
  I must be able to edit my profile and preferences and trust the change stuck
  So a "saved" message is never shown for a change the server did not keep

  # ── Profile edit — a REAL save that survives a reload ──────────────────────
  Scenario: a user edits their display name and it persists across a reload
    Given "alice" is logged in in their own context
    When "alice" navigates to "/profile"
    Then "alice" sees the "profile-view" view
    When "alice" sets their display name to "Alice E2E Profile"
    And "alice" saves their profile
    Then "alice" sees the profile saved confirmation
    When "alice" navigates to "/profile"
    Then "alice" sees their display name "Alice E2E Profile" persisted after reload

  # ── Preferences — the media.poison.default round-trip ──────────────────────
  Scenario: a user reaches their preferences and changes the AI-cloak default (ALLOW)
    Given "bob" is logged in in their own context
    When "bob" navigates to "/preferences"
    Then "bob" sees the "prefs-media-poison-fieldset" element
    When "bob" sets their default AI-cloak mode to "high"
    Then "bob" sees the preference saved confirmation
    When "bob" navigates to "/preferences"
    Then "bob" sees the AI-cloak mode "high" after reload

  # ── Notification preferences — a category toggle that survives a reload ────
  Scenario: a user turns off the role-change notification category and it persists
    Given "carol" is logged in in their own context
    When "carol" navigates to "/notification-preferences"
    Then "carol" sees the "notification-preferences-view" view
    When "carol" turns off the "role-change" notification category
    Then "carol" sees the notification preference saved confirmation
    When "carol" navigates to "/notification-preferences"
    Then "carol" sees the "role-change" notification category off after reload

  # ── The un-silenceable invariant: account-restriction cannot be turned off ──
  # A real write attempt against the BFF, not a UI-only assertion: the server
  # COERCES enabled=false back to true for this one category (mirrors the
  # forced-on checkbox in the UI), so this proves the guard is enforced at the
  # source of truth, not merely hidden behind a disabled control.
  Scenario: the BFF coerces an attempt to silence account-restriction back to enabled
    Given "dave" is logged in in their own context
    When "dave" PUTs "/bff/user/notification-preferences" with body "{\"category\":\"account-restriction\",\"enabled\":false}"
    Then the response status is 200
    And the notification-preference response confirms account-restriction is forced on

  # ── Notifications inbox — ALLOW surface + DENY floor (honest scope: no
  #    reachable seed path for a real notification — see header) ─────────────
  Scenario: a user reaches their notification inbox (ALLOW)
    Given "erin" is logged in in their own context
    When "erin" navigates to "/notifications"
    Then "erin" sees the "notifications-view" view

  Scenario: an unauthenticated visit to preferences is bounced to login (DENY floor)
    Given "alice" has a signed-out context
    When "alice" navigates to "/preferences"
    Then "alice" is redirected to the login page

  Scenario: an unauthenticated visit to notifications is bounced to login (DENY floor)
    Given "bob" has a signed-out context
    When "bob" navigates to "/notifications"
    Then "bob" is redirected to the login page

  Scenario: an unauthenticated visit to notification-preferences is bounced to login (DENY floor)
    Given "carol" has a signed-out context
    When "carol" navigates to "/notification-preferences"
    Then "carol" is redirected to the login page

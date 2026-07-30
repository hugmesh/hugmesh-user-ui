# PROFILE + PREFERENCE FIELDS THE PERSIST SUITES SKIPPED. The two existing
# profile/preference features cover displayName, pronouns, timezone, visibility,
# the vanity toggle, media.poison.default and the role-change category — leaving
# a short list genuinely untested, which this file closes:
#
#   - `gender` — the ONE profile field absent from BOTH persist suites (a grep
#     for "gender" over e2e/features returned nothing before this file).
#   - `screenReaderName` — its client-side behaviour (auto-fill, ASCII
#     validation, live preview) is covered offline, but an EXPLICIT screen-reader
#     name was never round-tripped through the server.
#   - the `infra-impacting` and `feature-availability` notification categories —
#     the same control as role-change, but neither was ever driven by any
#     scenario, so a per-category write bug would have shipped green.
#   - `account-restriction` rendered forced-on AND locked (the UI mirror of the
#     server's coercion, which is asserted separately by a real PUT in
#     profile-preferences-notifications.feature).
#
# Honest oracles:
#   - Every text value is uniquified per scenario (scenarioNonce). Against a
#     persistent stack a FIXED literal would already be stored from an earlier
#     run, so the readback would pass even if the PUT silently did nothing.
#   - Persistence is asserted after a real reload, so ngOnInit re-fetches from
#     the server and the assertion reads what was STORED, not in-memory state.
#   - Each category toggle is driven OFF and back ON, each half proven across a
#     reload. An off-only assertion would also pass against a surface that could
#     never re-enable anything, and the on-again half leaves a persistent stack
#     as it was found (categories default to on).
#
# Verified against source before writing this file:
#   - profile.component.html: profile-gender, profile-screenReaderName,
#     profile-save; PUT /bff/user/profile sends the whole model.
#   - notification-preferences.component.ts: categories are account-restriction
#     (first, forced-on), role-change, infra-impacting, feature-availability;
#     each toggle is notif-pref-toggle-<category>, and account-restriction
#     renders checked+disabled.
#
# @cluster — needs the host shell + a live session + user-bff-api.
@cluster @user-ui @user-situational
Feature: Profile and preference fields the persist suites skipped
  As a user
  I must have every field on these forms actually save
  So a field nobody wrote a test for is not quietly dropped on the way to the server

  # ── gender: the one profile field no suite ever persisted ──────────────────
  Scenario: the gender field round-trips through the server
    Given "alice" is logged in in their own context
    When "alice" navigates to "/profile"
    Then "alice" sees the "profile-view" view
    When "alice" sets their "profile-gender" profile field to "nonbinary"
    And "alice" saves their profile
    Then "alice" sees the profile saved confirmation
    When "alice" navigates to "/profile"
    Then "alice" sees their "profile-gender" profile field "nonbinary" persisted after reload

  # ── an EXPLICIT screen-reader name reaches the server ──────────────────────
  Scenario: an explicitly typed screen-reader name round-trips through the server
    Given "alice" is logged in in their own context
    When "alice" navigates to "/profile"
    And "alice" sets their "profile-screenReaderName" profile field to "alice ex ee two ee"
    And "alice" saves their profile
    Then "alice" sees the profile saved confirmation
    When "alice" navigates to "/profile"
    Then "alice" sees their "profile-screenReaderName" profile field "alice ex ee two ee" persisted after reload

  # ── the two never-driven notification categories ───────────────────────────
  Scenario: the infra-impacting category toggles off and back on across reloads
    Given "carol" is logged in in their own context
    When "carol" navigates to "/notification-preferences"
    Then "carol" sees the "notification-preferences-view" view
    When "carol" turns off the "infra-impacting" notification category
    Then "carol" sees the notification preference saved confirmation
    When "carol" navigates to "/notification-preferences"
    Then "carol" sees the "infra-impacting" notification category off after reload
    When "carol" turns on the "infra-impacting" notification category
    Then "carol" sees the notification preference saved confirmation
    When "carol" navigates to "/notification-preferences"
    Then "carol" sees the "infra-impacting" notification category on after reload

  Scenario: the feature-availability category toggles off and back on across reloads
    Given "carol" is logged in in their own context
    When "carol" navigates to "/notification-preferences"
    And "carol" turns off the "feature-availability" notification category
    Then "carol" sees the notification preference saved confirmation
    When "carol" navigates to "/notification-preferences"
    Then "carol" sees the "feature-availability" notification category off after reload
    When "carol" turns on the "feature-availability" notification category
    Then "carol" sees the notification preference saved confirmation
    When "carol" navigates to "/notification-preferences"
    Then "carol" sees the "feature-availability" notification category on after reload

  # ── account-restriction: the un-silenceable category's UI mirror ───────────
  Scenario: the account-restriction category renders forced on and cannot be driven
    Given "alice" is logged in in their own context
    When "alice" navigates to "/notification-preferences"
    Then "alice" sees the "account-restriction" notification category forced on and locked

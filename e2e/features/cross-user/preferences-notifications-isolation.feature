# CROSS-USER ISOLATION coverage for preferences / notification-preferences /
# notifications — the same owner==subject keystone owner-subject-isolation.feature
# proves for profile/blocks/cards, extended to the three BFF surfaces that file
# never touches. All three endpoints derive the owner EXCLUSIVELY from the JWT
# subject server-side (UserPreferencesController / NotificationPreferenceController
# / UserNotificationController all call `jwt.getSubject()` — never a path or body
# field), so there is no cross-owner id to attack (unlike blocks/cards, which
# expose a caller-addressable row id). The honest isolation oracle here is
# therefore the SAME shape owner-subject-isolation.feature already uses for
# profile: two REAL, independently-authenticated sessions each reading their
# OWN resource in parallel (never the other's), plus the unauthenticated floor.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is
# needed. Compiles + discovers offline.
@cluster @user-ui @cross-user
Feature: Preferences / notification-preferences / notifications — subject-only channels
  As the self-service user platform
  I must scope preferences, notification-preferences and notifications to the JWT subject
  So a compromised or misrouted request can never read another user's settings or inbox

  Scenario: each user reads only their OWN preferences via the BFF (parallel owner-scoped 200)
    Given "alice" is logged in in their own context
    And "bob" is logged in in their own context
    When "alice" GETs "/bff/user/preferences"
    Then the response status is 200
    When "bob" GETs "/bff/user/preferences"
    Then the response status is 200

  Scenario: each user reads only their OWN notification preferences via the BFF (parallel owner-scoped 200)
    Given "alice" is logged in in their own context
    And "bob" is logged in in their own context
    When "alice" GETs "/bff/user/notification-preferences"
    Then the response status is 200
    When "bob" GETs "/bff/user/notification-preferences"
    Then the response status is 200

  Scenario: each user reads only their OWN notification inbox via the BFF (parallel owner-scoped 200)
    Given "alice" is logged in in their own context
    And "bob" is logged in in their own context
    When "alice" GETs "/bff/user/notifications"
    Then the response status is 200
    When "bob" GETs "/bff/user/notifications"
    Then the response status is 200

  Scenario: an unauthenticated client cannot read preferences (401)
    Given a clean session
    When the unauthenticated client GETs "/bff/user/preferences"
    Then the response status is 401

  Scenario: an unauthenticated client cannot read notification preferences (401)
    Given a clean session
    When the unauthenticated client GETs "/bff/user/notification-preferences"
    Then the response status is 401

  Scenario: an unauthenticated client cannot read the notification inbox (401)
    Given a clean session
    When the unauthenticated client GETs "/bff/user/notifications"
    Then the response status is 401

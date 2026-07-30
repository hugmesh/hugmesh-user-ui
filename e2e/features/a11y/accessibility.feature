# A11Y coverage — the org accessibility standard on the self-service surface:
# skip-link + focusable main region (shell), accessibly-named view landmarks,
# polite status live regions, programmatically-associated field helptext, and
# focus restoration after a route change.
#
# The shell markup (app.component.html) renders:
#   <a class="skip" href="#main">Skip to main content</a>
#   <main id="main" tabindex="-1"><router-outlet /></main>
# and every view roots an aria-labelledby section with a role="status"
# aria-live="polite" line and field-help spans wired via aria-describedby.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @user-ui @a11y
Feature: Self-service accessibility — skip-link, landmarks, live regions, focus
  As a keyboard / screen-reader user
  I must be able to skip to content, name every region, and follow focus
  So the self-service surface is operable without a mouse

  Scenario: the skip link is the first tab stop and moves focus to main
    Given "alice" has a seeded session
    When "alice" navigates to "/"
    Then "alice" can tab to the skip link
    And activating the skip link moves focus to the main region

  Scenario: the home view is an accessibly-named landmark with a polite status region
    Given "alice" has a seeded session
    When "alice" navigates to "/"
    Then the "home-view" view has an accessible name
    And the "home-status" live region announces politely

  Scenario: the self-block view names its region and its status line
    Given "alice" has a seeded session
    When "alice" navigates to "/blocks"
    Then the "self-block-view" view has an accessible name
    And the "self-block-status" live region announces politely

  Scenario: the self-block target field is programmatically described by helptext
    Given "alice" has a seeded session
    When "alice" navigates to "/blocks"
    Then the "self-block-target" field is described by help text

  Scenario: tabbing flows from the self-block target field to the platform select
    Given "alice" has a seeded session
    When "alice" navigates to "/blocks"
    And "alice" focuses the "self-block-target" field
    Then tabbing advances focus to the "self-block-platform" field

  Scenario: the gated connected-apps helptext is associated with the disabled control
    Given "alice" has a seeded session
    When "alice" navigates to "/connected-apps"
    Then "alice" sees the "connected-apps-disabled" control disabled
    And the "connected-apps-disabled" field is described by help text

  Scenario: the recommend-instance-block view names its region
    Given "alice" has a seeded session
    When "alice" navigates to "/recommend-instance-block"
    Then the "recommend-instance-block-view" view has an accessible name
    And the "recommend-status" live region announces politely

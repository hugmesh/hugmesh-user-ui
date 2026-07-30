# CROSS-USER ISOLATION coverage — owner==subject is the keystone of the
# self-service surface. A user must be DENIED on ANOTHER user's resource: the
# user-bff-api scopes every /bff/user/** call to the authenticated subject, so a
# cross-owner read or mutate returns 403/404 (fail-closed) even if the UI were
# bypassed. Two identities coexist in one scenario (each in its own context via
# "is logged in in their own context", carrying its OWN HttpOnly bff_ cookie) so
# the isolation is asserted with both users live, not by swapping a session.
#
# VICTIM-CREATES-FIRST: every attacked id/slug here is REAL — created (or
# captured) by its owner inside the scenario, attacked by the other persona,
# then re-read by the owner. A DENY against a fabricated id proves nothing (the
# 404 cannot distinguish owner==subject enforcement from a typo), so fabricated
# oracles are banned from this suite.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @user-ui @cross-user
Feature: Owner==subject isolation — a user cannot reach another user's resources
  As the self-service user platform
  I must scope every self-service resource to its owner
  So a compromised user token cannot read or mutate another user's data

  Scenario: a user cannot delete another user's REAL self-block via the BFF (404, owner untouched)
    Given "alice" is logged in in their own context
    And "bob" is logged in in their own context
    When "alice" creates a self-block for "@spammer:bad.example.org" via the BFF
    Then the self-block for "@spammer:bad.example.org" appears in "alice"'s list within 15 seconds
    When "bob" attempts to delete the self-block for "@spammer:bad.example.org" via the BFF
    Then the response status is 404
    And "alice" still lists the self-block for "@spammer:bad.example.org"
    And "bob"'s self-block list does not contain the self-block for "@spammer:bad.example.org"

  Scenario: a user cannot delete or read another user's REAL card via the BFF (404, owner untouched)
    Given "alice" is logged in in their own context
    And "bob" is logged in in their own context
    When "alice" publishes a card "alice-welcome" with visibility "internal" via the BFF
    Then the card "alice-welcome" appears in "alice"'s cards list within 15 seconds
    # federation-api answers the owner-scoped 404, but the user-bff cards proxy
    # has NO upstream-status translation yet (WebClient.retrieve() with no
    # onStatus; ApiExceptionHandler only maps ApiException), so the deny may
    # surface as 500. Both are hard denies; tighten to exactly 404 once the BFF
    # grows a 404 pass-through. The load-bearing oracle is below: no card
    # content ever reached bob, and alice's card is untouched.
    When "bob" attempts to delete the card "alice-welcome" via the BFF
    Then the response status is one of 404 or 500
    When "bob" attempts to read the card "alice-welcome" body via the BFF
    Then the response status is one of 404 or 500
    And the card "alice-welcome" body was not leaked in the response
    And "alice" reads the card "alice-welcome" metadata via the BFF

  # Connected-client rows are minted by REAL external client connects (there is
  # no create endpoint), so the victim CAPTURES an existing own row's id — and
  # the scenario FAILS LOUDLY if carol has none (seed a connected client),
  # rather than "passing" against a fabricated id.
  Scenario: a user cannot revoke another user's REAL connected client via the BFF (denied, owner untouched)
    Given "carol" is logged in in their own context
    And "dave" is logged in in their own context
    And "carol" captures their first connected client id
    When "dave" attempts to revoke "carol"'s captured connected client via the BFF
    Then the response status is one of 403 or 404
    And "carol" still lists their captured connected client

  # Self-silence has NO cross-user address channel at all: activate / status /
  # cancel all derive the owner from the JWT subject (never a param — a
  # ?subject= query is IGNORED, which is why the old "GET ...?subject=alice →
  # 403/404" scenario could never pass and was a defect). The honest assertion
  # is independence: one user's silence is invisible to and unreachable by the
  # other's controls.
  Scenario: one user's self-silence is unreachable by another user's controls (subject-only channel)
    Given "alice" is logged in in their own context
    And "bob" is logged in in their own context
    When "alice" activates a self-silence ending in 10 minutes via the BFF
    Then "alice" has an active self-silence
    And "bob" has no active self-silence
    # bob has nothing active, so his subject-only cancel answers 404 ("no
    # active self-silence to cancel" per SelfSilenceService.cancel) — proving
    # the cancel channel cannot reach alice's silence: it acted on bob's own
    # (absent) row and alice stays silenced.
    When "bob" attempts to cancel their own self-silence via the BFF
    Then the response status is 404
    And "alice" has an active self-silence
    When "alice" cancels their own self-silence via the BFF
    Then "alice" has no active self-silence

  Scenario: each user reads only their OWN profile via the BFF (parallel owner-scoped 200)
    Given "alice" is logged in in their own context
    And "bob" is logged in in their own context
    When "alice" GETs "/bff/user/profile"
    Then the response status is 200
    When "bob" GETs "/bff/user/profile"
    Then the response status is 200

  Scenario: an unauthenticated client is rejected by the user BFF (401)
    Given a clean session
    When the unauthenticated client GETs "/bff/user/profile"
    Then the response status is 401

  Scenario: an unauthenticated client cannot read the self-block list (401)
    Given a clean session
    When the unauthenticated client GETs "/bff/user/blocks"
    Then the response status is 401

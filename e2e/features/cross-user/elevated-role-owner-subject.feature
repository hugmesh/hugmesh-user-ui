# ELEVATED-ROLE owner==subject completion (P4) — on the SELF-SERVICE surface an
# elevated role changes NOTHING for strictly-personal resources. The user-bff
# derives the owner of /bff/user/blocks, /bff/user/sessions and
# /bff/user/self-silence from the JWT SUBJECT ONLY (never a path/body field and
# with no admin override), so a mod, admin or superadmin addressing another
# user's REAL resource id gets the SAME generic 404 a plain user gets — role
# does not widen the self-service write surface.
#
# (Deliberate contrast: card METADATA reads via federation-api DO have a
# designed admin reader — see cards-lifecycle.feature. The DENYs here target
# only the endpoints whose contract is strictly subject-scoped, so every
# scenario asserts real, intended behaviour.)
#
# VICTIM-CREATES-FIRST throughout: alice creates/captures the REAL row in her
# own context, the elevated persona attacks it, alice re-reads it untouched.
# Each elevated persona also exercises an OWN-resource ALLOW so the DENY is
# provably owner-scoping, not a blanket block on the role.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @user-ui @cross-user @elevated-roles
Feature: Elevated roles are bound by owner==subject on personal resources
  As the self-service user platform
  I must scope strictly-personal resources to their owner regardless of role
  So a mod, admin or superadmin cannot touch another user's personal data

  Scenario: a mod cannot delete another user's REAL self-block (404, owner untouched)
    Given "alice" is logged in in their own context
    And "mod-user" is logged in in their own context
    When "alice" creates a self-block for "@stalker:bad.example.org" via the BFF
    Then the self-block for "@stalker:bad.example.org" appears in "alice"'s list within 15 seconds
    When "mod-user" attempts to delete the self-block for "@stalker:bad.example.org" via the BFF
    Then the response status is 404
    And "alice" still lists the self-block for "@stalker:bad.example.org"
    And "mod-user"'s self-block list does not contain the self-block for "@stalker:bad.example.org"

  Scenario: an admin cannot delete another user's REAL self-block (404, owner untouched)
    Given "alice" is logged in in their own context
    And "admin-user" is logged in in their own context
    When "alice" creates a self-block for "@stalker:bad.example.org" via the BFF
    Then the self-block for "@stalker:bad.example.org" appears in "alice"'s list within 15 seconds
    When "admin-user" attempts to delete the self-block for "@stalker:bad.example.org" via the BFF
    Then the response status is 404
    And "alice" still lists the self-block for "@stalker:bad.example.org"
    And "admin-user"'s self-block list does not contain the self-block for "@stalker:bad.example.org"

  Scenario: a superadmin cannot delete another user's REAL self-block (404, owner untouched)
    Given "alice" is logged in in their own context
    And "superadmin-user" is logged in in their own context
    When "alice" creates a self-block for "@stalker:bad.example.org" via the BFF
    Then the self-block for "@stalker:bad.example.org" appears in "alice"'s list within 15 seconds
    When "superadmin-user" attempts to delete the self-block for "@stalker:bad.example.org" via the BFF
    Then the response status is 404
    And "alice" still lists the self-block for "@stalker:bad.example.org"
    And "superadmin-user"'s self-block list does not contain the self-block for "@stalker:bad.example.org"

  # The ALLOW half that makes the DENYs meaningful: the elevated persona is a
  # perfectly normal self-service user over their OWN rows — the 404 above is
  # owner-scoping, not a role block.
  Scenario: an admin still manages their OWN self-blocks like any user (ALLOW)
    Given "admin-user" is logged in in their own context
    When "admin-user" creates a self-block for "@noise:loud.example.org" via the BFF
    Then the self-block for "@noise:loud.example.org" appears in "admin-user"'s list within 15 seconds
    When "admin-user" deletes their own self-block for "@noise:loud.example.org" via the BFF
    Then "admin-user" no longer lists the self-block for "@noise:loud.example.org"

  # Login sessions: the attacked id is REAL (minted by alice's own login in this
  # scenario); a foreign id answers a GENERIC 404 (anti-enumeration) even to an
  # admin, and alice's session row survives.
  Scenario: an admin cannot revoke another user's REAL login session (404, owner untouched)
    Given "alice" is logged in in their own context
    And "admin-user" is logged in in their own context
    And "alice" captures their current login session id
    When "admin-user" attempts to revoke "alice"'s login session via the BFF
    Then the response status is 404
    And "alice" still lists their login session

  Scenario: a superadmin cannot revoke another user's REAL login session (404, owner untouched)
    Given "alice" is logged in in their own context
    And "superadmin-user" is logged in in their own context
    And "alice" captures their current login session id
    When "superadmin-user" attempts to revoke "alice"'s login session via the BFF
    Then the response status is 404
    And "alice" still lists their login session

  # Self-silence is subject-only for elevated roles too: an admin's cancel acts
  # on the ADMIN's own (absent) silence — the BFF answers 404 ("no active
  # self-silence to cancel"), because there is nothing of the admin's to cancel
  # and no channel by which the cancel could address alice's row.
  Scenario: an admin's self-silence controls act only on themselves (subject-only channel)
    Given "alice" is logged in in their own context
    And "admin-user" is logged in in their own context
    When "alice" activates a self-silence ending in 10 minutes via the BFF
    Then "alice" has an active self-silence
    And "admin-user" has no active self-silence
    When "admin-user" attempts to cancel their own self-silence via the BFF
    Then the response status is 404
    And "alice" has an active self-silence
    When "alice" cancels their own self-silence via the BFF
    Then "alice" has no active self-silence

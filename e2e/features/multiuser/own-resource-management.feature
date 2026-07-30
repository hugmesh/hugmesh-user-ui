# MULTIUSER-SITUATIONAL coverage — two users each manage their OWN resources
# concurrently, in their own contexts, and each sees only their own list.
#
# Every /bff/user/** read is owner-scoped server-side, so alice's self-block
# list never carries bob's entries and vice-versa even when both are live in the
# same scenario. The display layer mirrors that: the table is fed by an
# owner-scoped fetch, so a row added by one user never leaks into the other's
# table. This is the "no collision" half of multi-user — distinct from the
# cross-user DENY (which is the BFF refusing a cross-owner read).
#
# The write scenarios use REAL logins ("is logged in in their own context") —
# each context holds its own HttpOnly bff_ cookie, so the UI writes actually
# reach the BFF (a seeded localStorage session carries no cookie and would 401).
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @user-ui @multiuser
Feature: Concurrent own-resource management — two users, two owner-scoped lists
  As the user-ui platform
  I must scope every self-service list to its owner
  So two users managing their resources at the same time never see each other's

  Scenario: two users add their own self-block and each sees only their own entry
    Given "alice" is logged in in their own context
    And "bob" is logged in in their own context
    When "alice" navigates to "/blocks"
    And "bob" navigates to "/blocks"
    And "alice" fills "self-block-target" with "@spammer-a:bad.example.org"
    And "alice" clicks the "self-block-add" control
    And "bob" fills "self-block-target" with "@spammer-b:other.example.org"
    And "bob" clicks the "self-block-add" control
    Then "alice" sees a row for "@spammer-a:bad.example.org"
    And "bob" sees a row for "@spammer-b:other.example.org"
    And "alice" does not see a row for "@spammer-b:other.example.org"
    And "bob" does not see a row for "@spammer-a:bad.example.org"

  # The finished cards multiuser proof: BOTH users REALLY publish (server-issued
  # contentHash captured), each list gains its owner's slug, and NEITHER list
  # ever shows the other's — the owner-scoped "mine" read at the display layer's
  # source of truth. (The earlier version only typed a slug into the form and
  # asserted the view rendered, which proved nothing.)
  Scenario: two users publish their own card and each lists only their own slug
    Given "alice" is logged in in their own context
    And "bob" is logged in in their own context
    When "alice" publishes a card "alice-welcome" with visibility "internal" via the BFF
    And "bob" publishes a card "bob-notes" with visibility "internal" via the BFF
    Then the card "alice-welcome" appears in "alice"'s cards list within 15 seconds
    And the card "bob-notes" appears in "bob"'s cards list within 15 seconds
    And the card "bob-notes" does not appear in "alice"'s cards list
    And the card "alice-welcome" does not appear in "bob"'s cards list

  # Self-silence INDEPENDENCE (P4): one user hiding themselves changes NOTHING
  # for the other — bob's status stays clear, his activate control stays enabled
  # (no aria-disabled "already hidden" gate), and his view shows no active
  # readback. Alice un-hides at the end (own ALLOW + state cleanup).
  Scenario: one user's self-silence does not affect another user's state or controls
    Given "alice" is logged in in their own context
    And "bob" is logged in in their own context
    When "alice" activates a self-silence ending in 10 minutes via the BFF
    Then "alice" has an active self-silence
    And "bob" has no active self-silence
    When "bob" navigates to "/self-silence"
    Then "bob" sees the "self-silence-view" view
    And "bob" sees the "self-silence-activate" control enabled
    And "bob" does not see the "self-silence-active" element
    When "alice" cancels their own self-silence via the BFF
    Then "alice" has no active self-silence

  Scenario: two users each read their own connected-apps list via the BFF (owner-scoped 200)
    Given "carol" is logged in in their own context
    And "dave" is logged in in their own context
    When "carol" GETs "/bff/user/connected-clients"
    Then the response status is 200
    When "dave" GETs "/bff/user/connected-clients"
    Then the response status is 200

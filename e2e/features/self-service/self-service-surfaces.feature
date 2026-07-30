# USER-SITUATIONAL coverage — each self-service surface, ALLOW + the
# disabled+helptext DENY surface.
#
# The user-ui exposes one remote per self-service surface (user.routes.ts):
#   ''                         -> home guide          (home-view)
#   /profile                   -> profile editor      (profile-view)
#   /cards                     -> federation cards     (cards-view)
#   /blocks                    -> self-block list      (self-block-view)
#   /recommend-instance-block  -> instance-block form  (recommend-instance-block-view)
#   /self-silence              -> self-silence         (self-silence-view)
#   /connected-apps            -> connected apps        (connected-apps-view, GATED)
#   /preferences               -> durable preferences   (prefs)
# There are NO in-remote role guards (the host enforces ROLE_USER); each
# resource is owner==subject. The ONE display-layer DENY surface is
# connected-apps: without an external-client role the manage button is
# aria-disabled + carries the gate helptext (defence-in-depth mirror of the
# user-bff-api ConnectedClientsController gate).
#
# @cluster — wave 2b ships DARK. These need the host shell serving the federated
# remote + a live session, so they're tagged @cluster and the config filters them
# out (`tags: 'not @cluster'`) so the default run requires no live stack. They still
# COMPILE + DISCOVER (a no-filter bddgen + `playwright test --list` proves it) — unlike
# playwright-bdd's reserved @skip, which drops a scenario from generation entirely.
@cluster @user-ui @user-situational
Feature: User self-service surfaces — each owner==subject view renders for its owner
  As the user-ui remote
  I must render every self-service surface for the signed-in user
  And surface a clear disabled+helptext gate where a role is missing
  So a user can manage their OWN resources and understands what they cannot

  Scenario: a user reaches the home getting-started guide (ALLOW)
    Given "alice" has a seeded session
    When "alice" navigates to "/"
    Then "alice" sees the "home-view" view
    And "alice" sees the "home-guide" element

  Scenario: a user reaches their profile editor (ALLOW)
    Given "alice" has a seeded session
    When "alice" navigates to "/profile"
    Then "alice" sees the "profile-view" view

  Scenario: a user reaches their federation cards (ALLOW)
    Given "alice" has a seeded session
    When "alice" navigates to "/cards"
    Then "alice" sees the "cards-view" view
    And "alice" sees the "cards-publish-help" element

  Scenario: a user reaches their self-block list (ALLOW)
    Given "alice" has a seeded session
    When "alice" navigates to "/blocks"
    Then "alice" sees the "self-block-view" view
    And "alice" sees the "self-block-intro" element

  Scenario: a user reaches the recommend-instance-block form (ALLOW)
    Given "alice" has a seeded session
    When "alice" navigates to "/recommend-instance-block"
    Then "alice" sees the "recommend-instance-block-view" view

  Scenario: a user reaches the self-silence surface (ALLOW)
    Given "alice" has a seeded session
    When "alice" navigates to "/self-silence"
    Then "alice" sees the "self-silence-view" view
    And "alice" sees help text "self-silence-until-help"

  Scenario: a user WITHOUT an external-client role sees connected-apps disabled + helptext (DENY surface)
    Given "alice" has a seeded session
    When "alice" navigates to "/connected-apps"
    Then "alice" sees the "connected-apps-view" view
    And "alice" sees the "connected-apps-disabled" control disabled
    And "alice" sees help text "connected-apps-gate-help"

  # The granted branch REPLACES the gated button with the live management
  # surface (ConnectedAppsComponent #granted template) — so the honest ALLOW
  # oracle is "granted surface rendered + gated control absent from the DOM",
  # not an "enabled" state on the gate control (it does not exist here).
  Scenario: a Matrix external-client user sees the connected-apps management surface (ALLOW)
    Given "carol" has a seeded session
    When "carol" navigates to "/connected-apps"
    Then "carol" sees the "connected-apps-view" view
    And "carol" sees the "connected-apps-granted" element
    And "carol" does not see the "connected-apps-disabled" element

  Scenario: a Mastodon external-client user also sees the connected-apps management surface (ALLOW)
    Given "dave" has a seeded session
    When "dave" navigates to "/connected-apps"
    Then "dave" sees the "connected-apps-view" view
    And "dave" sees the "connected-apps-granted" element
    And "dave" does not see the "connected-apps-disabled" element

  # A truly signed-out visitor: FRESH context, NO seeded session, NO cookies —
  # the host's ROLE_USER guard must bounce the visit to /login. (The previous
  # version of this scenario seeded a session first, so it actually tested a
  # logged-in render — a defect, fixed by the signed-out-context step.)
  Scenario: an unauthenticated visit to a self-service route is bounced to login (DENY floor)
    Given "alice" has a signed-out context
    When "alice" navigates to "/profile"
    Then "alice" is redirected to the login page

  # Recommend-instance-block is a REAL write: the form POSTs to the BFF, which
  # opens a federation moderation request (status=recommended — the start of the
  # USER→MOD→ADMIN chain; the mod-queue side lives in mod-ui's suite). The BFF
  # gates it on a homeserver platform role (hasAnyRole('MATRIX','MASTODON')), so
  # the ALLOW half is driven by `erin` (ROLE_MATRIX). The submission's
  # retrievability is proven from the API echo captured off the real submit:
  # recommended:true + the created request's server-issued id + status.
  Scenario: a platform user submits an instance-block recommendation and the created request is echoed back (ALLOW)
    Given "erin" is logged in in their own context
    When "erin" navigates to "/recommend-instance-block"
    Then "erin" sees the "recommend-instance-block-view" view
    When "erin" recommends a block on instance "bad.example.org" via the form
    Then "erin" sees the recommendation confirmation for "bad.example.org"
    And the recommendation for "bad.example.org" is acknowledged with a moderation request id

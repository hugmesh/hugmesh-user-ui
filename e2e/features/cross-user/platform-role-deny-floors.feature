# PLATFORM-ROLE DENY FLOORS — three user-bff-api surfaces are gated on a
# HOMESERVER PLATFORM role (`hasAnyRole('MATRIX','MASTODON')`) rather than on the
# ROLE_USER floor, and NONE of those gates was ever asserted:
#   - POST /bff/user/blocks with platform matrix|mastodon
#   - POST /bff/user/recommend-instance-block
#   - GET  /bff/user/connected-clients            (external-client role)
# mutation-steps.ts deliberately creates self-blocks on platform 'internal'
# BECAUSE of the first gate, and connected-apps only ever had its UI-mirror
# (disabled button) checked — so the fail-closed API floors that the UI mirrors
# claim to defend in depth were taken on trust. This file proves them.
#
# Honest oracles:
#   - Every DENY is paired with the matching ALLOW by a role-HOLDING seed
#     persona (erin = ROLE_MATRIX, carol = matrix_external_client). A blanket
#     403 from a broken endpoint would fail the ALLOW half, so "denied" here
#     really means "denied BECAUSE of the role".
#   - The refused writes are proven to have had NO side effect, not merely a
#     status code: the self-block attempt is re-read out of the victim's own
#     owner-scoped list (the database is the witness), and the recommendation
#     attempt is checked for a minted moderation-request id (a 403 that still
#     queued work would fail).
#   - Targets are uniquified per scenario (scenarioNonce), so a repeat run
#     against a persistent stack can never pass on a stale row or fail on one.
#
# The UI half of the recommend gate — a plain user seeing the disabled form and
# the explanation instead of a submit that just 403s — is asserted OFFLINE in
# features/self-service/recommend-gate-client-side.feature.
#
# Verified against source before writing this file:
#   - user-bff-api BlockController: recommend-instance-block and the
#     matrix/mastodon block platforms are @PreAuthorize hasAnyRole('MATRIX',
#     'MASTODON'); connected-clients requires an external-client role.
#   - roles.ts seed catalogue: alice/bob = ['user'] (no platform role), erin =
#     ['user','matrix'], carol = ['user','matrix_external_client'].
#
# @cluster — needs the host shell + live Casdoor logins + user-bff-api.
@cluster @user-ui @cross-user
Feature: Platform-role DENY floors — the API refuses what the UI gates
  As the platform
  I must refuse platform-gated writes from users without a homeserver platform role
  So the UI's disable+explain mirrors a real server-side gate, not a decoration

  # ── Self-block create on a platform-gated platform ─────────────────────────
  Scenario: a user without a platform role cannot create a matrix-platform self-block
    Given "alice" is logged in in their own context
    When "alice" attempts to create a "matrix"-platform self-block via the BFF
    Then the response status is 403
    And "alice" has no self-block for the attempted target

  Scenario: a user without a platform role cannot create a mastodon-platform self-block
    Given "alice" is logged in in their own context
    When "alice" attempts to create a "mastodon"-platform self-block via the BFF
    Then the response status is 403
    And "alice" has no self-block for the attempted target

  # ── recommend-instance-block: DENY and the ALLOW that gives it meaning ─────
  Scenario: a user without a platform role cannot start the moderation chain
    Given "alice" is logged in in their own context
    When "alice" attempts to recommend an instance block via the BFF
    Then the response status is 403
    And no moderation request id was minted

  Scenario: a platform-role holder CAN start the moderation chain (the ALLOW contrast)
    Given "erin" is logged in in their own context
    When "erin" attempts to recommend an instance block via the BFF
    Then the response status is 200
    And a moderation request id was minted

  # ── connected-clients: DENY and the ALLOW that gives it meaning ────────────
  Scenario: a user without an external-client role is refused the connected-clients list
    Given "alice" is logged in in their own context
    When "alice" GETs "/bff/user/connected-clients"
    Then the response status is 403

  Scenario: an external-client role holder CAN read their connected clients (the ALLOW contrast)
    Given "carol" is logged in in their own context
    When "carol" GETs "/bff/user/connected-clients"
    Then the response status is 200

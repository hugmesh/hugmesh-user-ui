# RECOMMEND-INSTANCE-BLOCK GATE — CLIENT-SIDE behaviour. The BFF gates
# POST /bff/user/recommend-instance-block on a homeserver platform role
# (hasAnyRole MATRIX/MASTODON), but the form used to render fully enabled for
# everyone: a plain user could fill it in, submit, and get only the generic
# "Could not submit your recommendation." — violating the repo's own
# disabled+helptext convention that connected-apps implements correctly.
#
# Like profile-edit-client-side.feature this ships UNTAGGED (no @cluster) and
# runs against a plain `ng serve` with NO backend, because every behaviour
# asserted here short-circuits BEFORE any HTTP call:
#   - hasPlatformRole() is a pure computed signal over the roles already in
#     `hug.session` (SessionService.hasRole), so the gate notice, the gate
#     helptext and the aria-disabled attributes are rendered from localStorage
#     alone.
#   - RecommendInstanceBlockComponent.submit() early-returns when
#     hasPlatformRole() is false, so the "and nothing is sent" half is real
#     offline: there is no request to make, not merely no server to answer it.
# The API floor this mirrors (the actual 403) is asserted against a live stack in
# features/cross-user/platform-role-deny-floors.feature.
#
# Honest oracles:
#   - The gate is asserted as the a11y contract the component implements —
#     aria-disabled plus an aria-describedby-associated helptext — NOT native
#     `disabled`. The control stays focusable on purpose so a screen-reader user
#     tabbing the form hears WHY it is unavailable; asserting `disabled` would
#     assert the opposite of the intended behaviour.
#   - Both branches are covered by DIFFERENT seed personas (alice = ['user'],
#     erin = ['user','matrix']), so "gated" is proven to follow the role and not
#     to be an unconditional render.
#
# Verified against source before writing this file:
#   - session.service.ts hasPlatformRole = hasRole('matrix') || hasRole('mastodon').
#   - recommend-instance-block.component.ts submit(): `if (!this.hasPlatformRole())
#     return;` ahead of every other branch — no BlockService call.
#   - recommend-instance-block.component.html: recommend-gate-notice (*ngIf
#     !hasPlatformRole), recommend-gate-help (the associated helptext),
#     recommend-submit / recommend-instance carrying aria-disabled="true" and an
#     aria-describedby that includes recommend-gate-help while gated.
#   - roles.ts: alice roles ['user']; erin roles ['user','matrix'].
@user-ui @user-situational @client-side
Feature: Recommend-instance-block gate — the UI mirrors the platform-role rule
  As a user without a homeserver platform role
  I must see that the recommendation form is unavailable and why
  So I am never invited to fill in a form whose submit can only be refused

  # ── GATED branch: a plain user ─────────────────────────────────────────────
  Scenario: a plain user sees the gate explanation and a disabled submit
    Given "alice" has a seeded session
    When "alice" navigates to "/recommend-instance-block"
    Then "alice" sees the "recommend-instance-block-view" view
    And "alice" sees the "recommend-gate-notice" element
    And "alice" sees the "recommend-submit" control disabled
    And "alice" sees help text "recommend-gate-help"

  # Asserted precisely: the generic a11y step only proves the FIRST referenced id
  # resolves, and the submit button always carries recommend-submit-help first —
  # so it would pass even if the gate helptext were never associated. This
  # asserts the gate id specifically, and that it resolves to a real element.
  Scenario: the gated submit control is associated with the gate helptext specifically
    Given "alice" has a seeded session
    When "alice" navigates to "/recommend-instance-block"
    Then "alice" sees the "recommend-submit" control described by the "recommend-gate-help" helptext
    And "alice" sees the "recommend-instance" control described by the "recommend-gate-help" helptext

  Scenario: a gated submit sends nothing and shows no confirmation
    Given "alice" has a seeded session
    When "alice" navigates to "/recommend-instance-block"
    And "alice" fills "recommend-instance" with "bad.example.org"
    And "alice" clicks the "recommend-submit" control
    Then "alice" sees no recommendation confirmation

  # ── UNGATED branch: a platform-role holder ─────────────────────────────────
  Scenario: a platform-role holder sees no gate and a usable submit
    Given "erin" has a seeded session
    When "erin" navigates to "/recommend-instance-block"
    Then "erin" sees the "recommend-instance-block-view" view
    And "erin" does not see the "recommend-gate-notice" element
    And "erin" does not see the "recommend-gate-help" element
    And "erin" sees the "recommend-submit" control enabled

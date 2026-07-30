# SELF-SILENCE THROUGH THE REAL FORM — every other scenario in the suite
# activates a self-silence with a BFF fetch ("activates a self-silence ... via
# the BFF"), so the actual form path had ZERO coverage: the datetime-local
# local->ISO conversion, the future-time validation, the active readback with
# its wake time, the aria-disabled activate gate + "already hidden" helptext,
# and the cancel button. This file drives all of it through the UI.
#
# Honest oracles:
#   - Activation is confirmed by the SERVER, not the UI: every activate/cancel
#     scenario re-reads GET /bff/user/self-silence/status through the user's own
#     cookie ("has an active self-silence" / "has no active self-silence", the
#     same helper SelfSilenceComponent.active() uses). The status line and the
#     readback are asserted IN ADDITION, never instead.
#   - The future-time rejection asserts BOTH halves: the error message appears
#     AND self-silence-status is still empty — proving activate() early-returned
#     before the POST rather than posting and failing.
#   - The gate is asserted as the a11y contract the component actually
#     implements (aria-disabled + an associated helptext), not native `disabled`
#     — the button stays focusable on purpose so AT users hear WHY.
#   - Every scenario ends with the silence cancelled, so a persistent stack is
#     left exactly as it was found (self-silence is a durable server row).
#
# KNOWN GAP — deliberately NOT faked here: the audit asks for "a silenced user
# becomes invisible to a second user". This remote consumes no surface that
# renders another user's visibility (its every route is owner==subject), and the
# one permitAll federation read (the vanity profile resolve) is served by a
# different service. Asserting invisibility from here would mean inventing an
# endpoint, so this file proves the full OWNER-side lifecycle and the
# cross-subject independence, and the visible-to-others consequence stays
# recorded as an open cross-service gap rather than a green vacuous assertion.
#
# Verified against source before writing this file:
#   - self-silence.component.html: self-silence-until (datetime-local),
#     self-silence-reason, self-silence-activate (aria-disabled while active),
#     self-silence-active / self-silence-wake readback, self-silence-cancel,
#     self-silence-already helptext, self-silence-error (role=alert).
#   - self-silence.component.ts activate(): refuses a non-future time with
#     "The end time must be in the future." BEFORE any POST; on success writes
#     "You are now hidden from others."; cancel() writes "Your self-silence was
#     cancelled — you are visible again."
#
# @cluster — needs the host shell + a live session + user-bff-api.
@cluster @user-ui @user-situational
Feature: Self-silence through the real form — activate, readback, gate, cancel
  As a user who wants to disappear for a while
  I must be able to set an end time in the form, see when I come back, and un-hide
  So the feature works as a form and not only as a BFF call

  # The precondition is made TRUE, not merely asserted: self-silence is a durable
  # server row, so on a persistent stack a leftover from an earlier run would
  # otherwise fail every scenario here for the wrong reason. The tolerant
  # "attempts to cancel" step 204s if something was active and 404s if nothing
  # was — either way the assertion that follows is the real gate.
  Background:
    Given "alice" is logged in in their own context
    When "alice" attempts to cancel their own self-silence via the BFF
    Then "alice" has no active self-silence

  # ── Activate through the form; the SERVER confirms it stuck ────────────────
  Scenario: activating a self-silence through the form hides the user and shows the wake time
    When "alice" navigates to "/self-silence"
    Then "alice" sees the "self-silence-view" view
    When "alice" sets the self-silence end time to 60 minutes from now
    And "alice" gives the self-silence reason "e2e form lifecycle"
    And "alice" submits the self-silence form
    Then "alice" sees the self-silence activated confirmation
    And "alice" has an active self-silence
    And "alice" sees the "self-silence-active" element
    And "alice" sees the self-silence wake time readback
    When "alice" cancels their own self-silence via the BFF
    Then "alice" has no active self-silence

  # ── The disable+explain gate while already hidden ──────────────────────────
  Scenario: while hidden the activate control is gated and explains why
    When "alice" navigates to "/self-silence"
    And "alice" sets the self-silence end time to 90 minutes from now
    And "alice" submits the self-silence form
    Then "alice" has an active self-silence
    And "alice" sees the "self-silence-activate" control disabled
    And "alice" sees help text "self-silence-already"
    And "alice" sees the "self-silence-cancel" control enabled
    When "alice" cancels their own self-silence via the BFF
    Then "alice" has no active self-silence

  # ── Cancel through the UI button (not the BFF) ─────────────────────────────
  Scenario: cancelling through the UI button un-hides the user for real
    When "alice" navigates to "/self-silence"
    And "alice" sets the self-silence end time to 45 minutes from now
    And "alice" submits the self-silence form
    Then "alice" has an active self-silence
    When "alice" clicks the "self-silence-cancel" control
    Then "alice" sees the self-silence cancelled confirmation
    And "alice" has no active self-silence
    And "alice" does not see the "self-silence-active" element

  # ── Client-side guard: a past end time never reaches the BFF ───────────────
  Scenario: a past end time is refused client-side and nothing is activated
    When "alice" navigates to "/self-silence"
    And "alice" sets the self-silence end time to 30 minutes in the past
    And "alice" submits the self-silence form
    Then "alice" sees the self-silence future-time validation error
    And "alice" sees no self-silence activated confirmation
    And "alice" has no active self-silence

  # ── Subject-only: one user's silence never touches another's ───────────────
  Scenario: one user's self-silence leaves a second user unsilenced and their form usable
    Given "bob" is logged in in their own context
    When "bob" attempts to cancel their own self-silence via the BFF
    Then "bob" has no active self-silence
    When "alice" navigates to "/self-silence"
    And "alice" sets the self-silence end time to 60 minutes from now
    And "alice" submits the self-silence form
    Then "alice" has an active self-silence
    And "bob" has no active self-silence
    When "bob" navigates to "/self-silence"
    Then "bob" sees the "self-silence-activate" control enabled
    And "bob" does not see the "self-silence-active" element
    When "alice" cancels their own self-silence via the BFF
    Then "alice" has no active self-silence

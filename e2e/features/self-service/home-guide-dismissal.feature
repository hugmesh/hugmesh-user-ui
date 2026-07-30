# HOME-GUIDE DISMISSAL — a durable per-user preference (POST/DELETE
# /bff/user/home-guide/dismiss) whose helptext promises the guide stays hidden
# "across all your devices". self-service-surfaces.feature only asserts the guide
# is VISIBLE; the dismiss write, the reload persistence, the show-again
# un-dismiss, and the cross-device propagation were all untested. This file
# drives the real write path and proves each consequence.
#
# Each scenario ends with the guide RESTORED (show-again) so a persistent stack
# is left as it was found — the same leave-no-trace discipline the preference
# suites use. (The offline self-service-surfaces guide check is unaffected either
# way: it uses a seeded session with no cookie, so its BFF load 401s and the
# component fails open to "guide shown" regardless of server state.)
#
# Verified against source before writing this file:
#   - home.component.html: data-testid="home-guide" (shown while dismissed===
#     false), "home-dismiss" button, "home-dismissed-note" (shown while
#     dismissed===true), "home-show-again" button.
#   - home.component.ts: dismiss() POSTs, showAgain() DELETEs, ngOnInit loads the
#     dismissal via GET /bff/user/home-guide and fails OPEN (shows the guide) on
#     error — so a real login is required to exercise the true stored value.
#
# @cluster — needs the host shell + a live session + user-bff-api.
@cluster @user-ui @user-situational
Feature: Home getting-started guide dismissal — persists and propagates across devices
  As a returning user who dismissed the getting-started guide
  I must have it stay dismissed on reload and on my other devices, and be able to bring it back
  So "don't show this again" is a durable choice, not a per-page one

  # ── Dismiss → persists across reload → show again → persists across reload ──
  Scenario: dismissing the guide persists across a reload and can be reopened
    Given "alice" is logged in in their own context
    When "alice" navigates to "/"
    Then "alice" sees the "home-guide" element
    When "alice" clicks the "home-dismiss" control
    Then "alice" sees the "home-dismissed-note" element
    And "alice" does not see the "home-guide" element
    When "alice" navigates to "/"
    Then "alice" sees the "home-dismissed-note" element
    And "alice" does not see the "home-guide" element
    When "alice" clicks the "home-show-again" control
    Then "alice" sees the "home-guide" element
    When "alice" navigates to "/"
    Then "alice" sees the "home-guide" element

  # ── Cross-device: a dismissal on one device is visible on another ──────────
  Scenario: a dismissal made on one device shows dismissed on another device
    Given "bob" is logged in on device "A"
    And "bob" is logged in on device "B"
    When "bob" on device "A" navigates to "/"
    Then "bob" on device "A" sees the "home-guide" element
    When "bob" on device "A" clicks the "home-dismiss" control
    Then "bob" on device "A" sees the "home-dismissed-note" element
    When "bob" on device "B" navigates to "/"
    Then "bob" on device "B" sees the "home-dismissed-note" element
    And "bob" on device "B" does not see the "home-guide" element
    # Restore across devices so the stack is left clean.
    When "bob" on device "B" clicks the "home-show-again" control
    Then "bob" on device "B" sees the "home-guide" element

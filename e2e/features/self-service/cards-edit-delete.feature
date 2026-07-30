# FEDERATION CARDS — EDIT AND DELETE THROUGH THE UI. cards-lifecycle.feature
# proves PUBLISH only; the edit and delete buttons on each row were never
# clicked by any scenario. Those are the two riskiest client-side card paths:
#
#   EDIT   — readBody(slug) -> decodeDocument() must restore the EXACT prior
#            sections and scoped CSS. It is a lossless codec round-trip across
#            the server (encodeDocument on publish, decodeDocument on edit); if
#            either half drops a field the author silently loses content the
#            next time they republish, and nothing would have caught it.
#   DELETE — the row must go server-side, and when the deleted card is the one
#            currently loaded the editor must be cleared (cards.component.ts
#            remove() resets slug/entryFile and the document).
#
# Honest oracles:
#   - The prefill assertion compares each field against the EXACT uniquified
#     string this scenario published (toHaveValue, not a substring or a
#     non-empty check) — a codec that dropped section 1 or the CSS block would
#     pass "not empty" and fail here.
#   - The republish oracle is a versionDir DELTA from the value captured before,
#     never a hardcoded version, so it holds on a persistent stack that already
#     has version history for the slug.
#   - "Deleted" is proven from the SERVER: the owner-scoped GET /bff/user/cards
#     list is re-read under a bounded poll after a full reload, so a row merely
#     dropped from the in-memory signal cannot pass.
#   - Slugs and section text are uniquified per scenario (scenarioNonce), so a
#     repeat live run can neither pass on a stale card nor collide with one.
#
# Verified against source before writing this file:
#   - cards.component.html: each row is tr[data-card-slug] with button[data-edit]
#     and button[data-delete]; columns are slug, visibility, version, created.
#   - cards.component.ts edit(): readBody -> editor.setDocument(decodeDocument(body)).
#     remove(): DELETE, re-list, and IF the deleted slug is the loaded one, clear
#     slug/entryFile and reset the editor to a single empty section; status
#     'Card "<slug>" deleted.' on success.
#   - card-editor.component.html: add-section, section-title-<i>, section-body-<i>,
#     card-css-body.
#
# @cluster — needs the host shell + a live session + user-bff-api + federation-api.
@cluster @user-ui @user-situational @cards
Feature: Federation cards — edit with prefill and delete through the UI
  As a card author
  I must be able to reopen a published card and get my exact content back, and delete it
  So editing never silently loses a section and deleting really removes the card

  Background:
    Given "alice" is logged in in their own context
    When "alice" navigates to "/cards"
    Then "alice" sees the "cards-view" view

  # ── Edit: the codec round-trip restores EXACTLY what was published ─────────
  Scenario: reopening a published card restores every section and the scoped CSS
    When "alice" slugs the card "edit-roundtrip"
    And "alice" titles card section 0 of "edit-roundtrip" as "First"
    And "alice" writes card section 0 of "edit-roundtrip" as "section zero body"
    And "alice" adds another card section
    And "alice" writes card section 1 of "edit-roundtrip" as "section one body"
    And "alice" writes the card CSS for "edit-roundtrip" as ".card-root h1 { color: rebeccapurple; }"
    And "alice" sets the card visibility to "internal"
    And "alice" submits the card editor
    Then "alice" sees the card published confirmation for "edit-roundtrip"
    And "alice" sees a card row for "edit-roundtrip"
    When "alice" clicks edit on the card row for "edit-roundtrip"
    Then "alice" sees card section 0 of "edit-roundtrip" titled with the published title
    And "alice" sees card section 0 of "edit-roundtrip" prefilled with the published text
    And "alice" sees card section 1 of "edit-roundtrip" prefilled with the published text
    And "alice" sees the card CSS for "edit-roundtrip" prefilled with the published style
    When "alice" clicks delete on the card row for "edit-roundtrip"
    Then "alice" no longer has the card "edit-roundtrip" on the server

  # ── Republish from the editor mints a new version ──────────────────────────
  Scenario: editing and republishing a card bumps its version
    When "alice" slugs the card "edit-version"
    And "alice" writes card section 0 of "edit-version" as "first publish body"
    And "alice" sets the card visibility to "internal"
    And "alice" submits the card editor
    Then "alice" sees the card published confirmation for "edit-version"
    And "alice" sees a card row for "edit-version"
    And "alice" captures the version of the card "edit-version"
    When "alice" clicks edit on the card row for "edit-version"
    Then "alice" sees card section 0 of "edit-version" prefilled with the published text
    When "alice" writes card section 0 of "edit-version" as "second publish body"
    And "alice" submits the card editor
    Then "alice" sees the card published confirmation for "edit-version"
    And "alice" sees the version of the card "edit-version" changed
    When "alice" clicks delete on the card row for "edit-version"
    Then "alice" no longer has the card "edit-version" on the server

  # ── Delete: gone from the server AND the editor cleared ────────────────────
  Scenario: deleting the card currently loaded in the editor clears the form and removes it
    When "alice" slugs the card "delete-loaded"
    And "alice" writes card section 0 of "delete-loaded" as "body to be deleted"
    And "alice" sets the card visibility to "internal"
    And "alice" submits the card editor
    Then "alice" sees the card published confirmation for "delete-loaded"
    And "alice" sees a card row for "delete-loaded"
    When "alice" clicks edit on the card row for "delete-loaded"
    Then "alice" sees card section 0 of "delete-loaded" prefilled with the published text
    When "alice" clicks delete on the card row for "delete-loaded"
    Then "alice" sees the card deleted confirmation for "delete-loaded"
    And "alice" sees the card editor cleared
    And "alice" sees no card row for "delete-loaded"
    And "alice" no longer has the card "delete-loaded" on the server

  # ── The delete survives a reload (not just an in-memory list refresh) ──────
  Scenario: a deleted card is still gone after a full reload
    When "alice" slugs the card "delete-durable"
    And "alice" writes card section 0 of "delete-durable" as "body that must not survive"
    And "alice" sets the card visibility to "internal"
    And "alice" submits the card editor
    Then "alice" sees a card row for "delete-durable"
    When "alice" clicks delete on the card row for "delete-durable"
    Then "alice" sees the card deleted confirmation for "delete-durable"
    When "alice" navigates to "/cards"
    Then "alice" sees the "cards-view" view
    And "alice" sees no card row for "delete-durable"
    And "alice" no longer has the card "delete-durable" on the server

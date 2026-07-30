# CARDS LIFECYCLE (P4 completion) — publish for real, prove draft privacy, and
# pin down exactly which readers a user card can honestly reach on this
# platform (owner, the designed admin reader, and no one anonymous).
#
# Visibility semantics (verified against federation-api BundleService /
# BundleController + the gateway SecurityConfig):
#   - 'internal' (the DRAFT tier): the card exists only for its owner on the
#     peer-read surfaces — GET /bff/user/cards is the owner-scoped "mine" list,
#     GET /bff/user/cards/{slug} answers a PEER with an EMPTY version list, and
#     the body read is a hard 404 for any non-owner.
#   - cross-owner metadata: the only DESIGNED cross-owner reader is an
#     ADMIN-tier caller (own brand) via the slug metadata view — and that
#     reader is VISIBILITY-INDEPENDENT (BundleService.listForSlug applies no
#     visibility filter for admins), so it reads internal and public cards
#     alike. Peers stay empty-scoped; owner keeps full access. There is NO
#     read surface on this platform whose outcome differs between 'internal'
#     and 'public' today, so no scenario here claims to distinguish them.
#   - signed-out: there is NO anonymous card-serving surface AT ALL. The
#     gateway's auth floor is anyExchange().authenticated() (PUBLIC_PATHS is a
#     login/registration allowlist), and the only permitAll federation read —
#     the vanity profile resolve — serves REGISTRY profile fragments, not user
#     cards. So the honest signed-out assertion for a PUBLIC card is the 401
#     refusal on its REAL slug: "public" means public to authenticated readers
#     of the designed surfaces, and the platform fails CLOSED for the anonymous
#     internet. (Asserting a signed-out 200 would be a step that can never
#     pass — the defect class this wave removes.)
#
# VICTIM-CREATES-FIRST: every slug asserted below was REALLY published in the
# scenario (server-issued contentHash captured and used as the read oracle).
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @user-ui @user-situational @cards
Feature: Federation cards — real publish, draft privacy, honest public visibility
  As a user of the self-service cards surface
  I must be able to publish a card and trust its visibility tier
  So my drafts stay mine and public cards reach exactly the designed readers

  # The REAL editor flow end-to-end: slug + WYSIWYG section content + visibility
  # through the actual form, then the success confirmation (only written after
  # the BFF PUT resolves), the owner's list row, and the owner-scoped API
  # readback within a bounded poll — no fabricated state anywhere.
  Scenario: a user publishes a card through the real editor and sees it in their list (ALLOW)
    Given "alice" is logged in in their own context
    When "alice" navigates to "/cards"
    Then "alice" sees the "cards-view" view
    When "alice" slugs the card "my-first-card"
    And "alice" writes the card section "Hello from the e2e harness — this section makes the card publishable."
    And "alice" sets the card visibility to "internal"
    And "alice" submits the card editor
    Then "alice" sees the card published confirmation for "my-first-card"
    And "alice" sees a card row for "my-first-card"
    And the card "my-first-card" appears in "alice"'s cards list within 15 seconds

  Scenario: an internal (draft) card is invisible to another user on every read channel
    Given "alice" is logged in in their own context
    And "bob" is logged in in their own context
    When "alice" publishes a card "draft-notes" with visibility "internal" via the BFF
    Then the card "draft-notes" appears in "alice"'s cards list within 15 seconds
    And the card "draft-notes" does not appear in "bob"'s cards list
    And "bob" reads no versions for the card "draft-notes" via the BFF
    # federation-api answers the non-owner 404, but the user-bff cards proxy
    # has no upstream-status translation yet (untranslated
    # WebClientResponseException → default 500), so the deny may surface as
    # 500. Both are hard denies; tighten to exactly 404 once the BFF grows a
    # 404 pass-through. The load-bearing draft-privacy oracle: the draft's
    # source never reached bob, on any status.
    When "bob" attempts to read the card "draft-notes" body via the BFF
    Then the response status is one of 404 or 500
    And the card "draft-notes" body was not leaked in the response
    And "alice" reads the card "draft-notes" metadata via the BFF

  # HONEST SCOPE: this proves (a) the DESIGNED admin cross-owner metadata
  # reader and (b) the signed-out fail-closed floor — NOT public-vs-internal
  # semantics. The admin reader is visibility-independent (see header), so
  # this scenario would pass identically for an 'internal' card; no
  # visibility-discriminating read surface exists to assert against today.
  Scenario: a published card reaches its designed admin cross-owner reader and no one anonymous
    Given "alice" is logged in in their own context
    And "admin-user" is logged in in their own context
    When "alice" publishes a card "town-square" with visibility "public" via the BFF
    Then the card "town-square" appears in "alice"'s cards list within 15 seconds
    # The designed cross-owner reader: an admin (own brand) resolves the REAL
    # slug to the metadata view carrying the exact contentHash the publish
    # returned (visibility-independent by design).
    And "admin-user" reads the card "town-square" metadata via the BFF
    # The signed-out floor: the anonymous internet gets 401 on the same REAL
    # slug — fail-closed, no anonymous card serving exists on this platform.
    When the unauthenticated client attempts to read the card "town-square" via the BFF
    Then the response status is 401
    And "alice" reads the card "town-square" metadata via the BFF

# PROFILE EDITOR — the remaining BACKEND-dependent sub-functions the persist
# suite (profile-preferences-notifications.feature, #36) did not reach: it
# proved only the displayName round-trip. This file extends that to the OTHER
# editable profile fields (visibility / pronouns / timezone / vanity subdomain)
# as a real reload-readback round-trip, and covers the avatar upload
# (POST /bff/user/profile/avatar → the returned profile's avatarUrl replaces the
# local preview). Both need a live BFF, so they ship @cluster (config filters
# `not @cluster`); they COMPILE + DISCOVER offline like the rest of the suite.
#
# Verified against source before writing this file:
#   - profile.component.ts save() PUTs the WHOLE model via UserProfileService,
#     then re-adopts the server's response; ngOnInit re-loads on reload — so a
#     value read back after a reload is the server's, not in-memory form state.
#     Fields + testids: profile-visibility (select internal|public),
#     profile-pronouns / profile-timezone (text inputs), profile-vanity
#     (checkbox), profile-save, profile-status ("Profile saved.").
#   - profile-avatar.component.ts upload(): on a successful uploadAvatar() it
#     sets currentProfile (with the new avatarUrl) and CLEARS previewUrl; the
#     template then renders profile-avatar-image (server url) and drops
#     profile-avatar-preview. testids: profile-avatar-file, profile-avatar-image,
#     profile-avatar-preview.
#
# HONEST @cluster GAP (recorded here + in the PR): the change-password and
# change-email HAPPY paths (POST /bff/user/profile/password|email → Casdoor
# relay) are NOT driven here because they MUTATE the shared seed user's
# credentials — running them against the live seed stack would break every
# subsequent login in the suite. Their CLIENT-SIDE required-field validation IS
# covered offline in profile-edit-client-side.feature; the relay happy path
# needs a throwaway user fixture a later wave can add.
@cluster @user-ui @user-situational
Feature: Profile editor — field persistence and avatar upload (live BFF)
  As a user editing my own profile
  I must have every editable field and my avatar actually persist server-side
  So a reload shows exactly what I saved, not a local echo

  # ── The non-displayName fields persist across a reload ─────────────────────
  Scenario: visibility, pronouns, timezone and the vanity toggle persist across a reload
    Given "alice" is logged in in their own context
    When "alice" navigates to "/profile"
    Then "alice" sees the "profile-view" view
    When "alice" fills "profile-displayName" with "Alice E2E Fields"
    And "alice" sets the "profile-visibility" select to "public"
    And "alice" fills "profile-pronouns" with "they/them"
    And "alice" fills "profile-timezone" with "Europe/London"
    And "alice" checks the "profile-vanity" toggle
    And "alice" saves their profile
    Then "alice" sees the profile saved confirmation
    When "alice" navigates to "/profile"
    Then "alice" sees the "profile-visibility" field value "public"
    And "alice" sees the "profile-pronouns" field value "they/them"
    And "alice" sees the "profile-timezone" field value "Europe/London"
    And "alice" sees the "profile-vanity" toggle checked

  # ── Avatar upload replaces the local preview with the server-stored image ───
  Scenario: uploading a valid PNG avatar stores it and replaces the local preview
    Given "bob" is logged in in their own context
    When "bob" navigates to "/profile"
    Then "bob" sees the "profile-view" view
    When "bob" uploads a valid PNG avatar
    Then "bob" sees their stored avatar image
    And "bob" does not see the "profile-avatar-preview" element

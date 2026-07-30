# PROFILE EDIT — CLIENT-SIDE behaviour (form validation, computed a11y preview,
# optimistic default-fill, avatar file gate). These are the profile-editor
# functions that run ENTIRELY in the browser and NEVER touch the BFF, so unlike
# every other feature in this suite they ship UNTAGGED (no @cluster) and run
# against a plain `ng serve` with NO backend — the config's default
# `tags: 'not @cluster'` filter includes them. This is the rule-3 half of the
# suite: offline-renderable UI behaviour (validation, client-side state,
# optimistic UI) stays untagged; anything needing a live stack stays @cluster.
#
# Why these are truly offline-safe: each behaviour asserted here short-circuits
# BEFORE any HTTP call. ProfileComponent.save() sets formError and RETURNS on an
# empty display name / non-ASCII screen-reader name; changePassword()/
# changeEmail() set their message and RETURN when a required field is blank;
# ProfileAvatarComponent.onFileSelected() sets uploadError and RETURNS (never
# calls uploadAvatar) when the chosen file fails the client-side type/size gate.
# needsScreenReaderName() and previewName() are pure computed signals. On
# `ng serve` the profile's ngOnInit load() rejects (no BFF) and the component
# catches it and renders from defaults, so the form is present and empty — every
# scenario below drives from that clean state. Priming uses a seeded session so
# the SAME feature also renders when pointed at a live host (the host ROLE_USER
# guard reads hug.session; the BFF calls 401 but ngOnInit swallows them).
#
# Verified against source before writing this file:
#   - profile.component.ts save(): "A display name is required." (empty name);
#     "A screen-reader name must use only printable ASCII characters (letters,
#     digits, basic punctuation)." (non-ASCII SRN); both set formError and
#     return WITHOUT calling profiles.save(). needsScreenReaderName() /
#     previewName() computed from the model only.
#   - profile.component.ts setDisplayName(): an ASCII display name default-FILLS
#     the screen-reader name field (mirrors ScreenReaderNames.defaultFor); a
#     non-ASCII display name clears it so the inline prompt fires.
#   - profile.component.ts changePassword()/changeEmail(): "Both the current and
#     new password are required." / "A new email address is required." set on a
#     blank required field, returned before any relay call.
#   - profile.component.html testids: profile-view, profile-displayName,
#     profile-screenReaderName, profile-save, profile-error, profile-status,
#     profile-srn-prompt, profile-srn-preview, profile-oldPassword,
#     profile-newPassword, profile-change-password, profile-password-message,
#     profile-newEmail, profile-change-email, profile-email-message.
#   - profile-avatar.component.ts validate(): "Please choose an image file (JPEG
#     or PNG)." (wrong type) / "That image is larger than 5 MB. Please choose a
#     smaller one." (> 5 MB); both return the error BEFORE showPreview/upload.
#     testids: profile-avatar-file, profile-avatar-error, profile-avatar-preview.
#
# NO @cluster tag on purpose — this feature is the offline default run.
@user-ui @user-situational @client-side
Feature: Profile editor — client-side validation and live a11y preview (offline, no backend)
  As a user editing my own profile
  I must see validation and the screen-reader preview react in the browser
  So I never submit a change the server would reject and I trust what a screen reader will say

  # ── Display-name required: save is blocked client-side, nothing is "saved" ──
  Scenario: saving with an empty display name shows a validation error and does not confirm a save
    Given "alice" has a seeded session
    When "alice" navigates to "/profile"
    Then "alice" sees the "profile-view" view
    When "alice" fills "profile-displayName" with ""
    And "alice" clicks the "profile-save" control
    Then "alice" sees "A display name is required." in the "profile-error"
    And "alice" sees no profile saved confirmation

  # ── Non-ASCII display name → inline prompt + live preview; ASCII SRN clears it ─
  Scenario: a non-ASCII display name prompts for a screen-reader name and the preview announces it
    Given "alice" has a seeded session
    When "alice" navigates to "/profile"
    Then "alice" sees the "profile-view" view
    When "alice" fills "profile-displayName" with "こんにちは"
    Then "alice" sees "a screen reader cannot announce" in the "profile-srn-prompt"
    And "alice" sees "こんにちは" in the "profile-srn-preview"
    When "alice" fills "profile-screenReaderName" with "Konnichiwa"
    Then "alice" does not see the "profile-srn-prompt" element
    And "alice" sees "Konnichiwa" in the "profile-srn-preview"

  # ── A non-ASCII screen-reader name is rejected on save (client-side) ────────
  Scenario: a non-ASCII screen-reader name is rejected before any save
    Given "alice" has a seeded session
    When "alice" navigates to "/profile"
    Then "alice" sees the "profile-view" view
    When "alice" fills "profile-displayName" with "Ada"
    And "alice" fills "profile-screenReaderName" with "Adá"
    And "alice" clicks the "profile-save" control
    Then "alice" sees "printable ASCII" in the "profile-error"
    And "alice" sees no profile saved confirmation

  # ── ASCII display name auto-fills the screen-reader name (default-fill) ─────
  Scenario: typing an ASCII display name default-fills the screen-reader name field
    Given "alice" has a seeded session
    When "alice" navigates to "/profile"
    Then "alice" sees the "profile-view" view
    When "alice" fills "profile-displayName" with "Ada Lovelace"
    Then "alice" sees the "profile-screenReaderName" field value "Ada Lovelace"
    And "alice" does not see the "profile-srn-prompt" element

  # ── Change-password required fields (client-side, no relay call) ────────────
  Scenario: changing password with blank fields shows the required-fields message
    Given "alice" has a seeded session
    When "alice" navigates to "/profile"
    Then "alice" sees the "profile-view" view
    When "alice" clicks the "profile-change-password" control
    Then "alice" sees "Both the current and new password are required." in the "profile-password-message"

  # ── Change-email required field (client-side, no relay call) ────────────────
  Scenario: changing email with a blank address shows the required message
    Given "alice" has a seeded session
    When "alice" navigates to "/profile"
    Then "alice" sees the "profile-view" view
    When "alice" clicks the "profile-change-email" control
    Then "alice" sees "A new email address is required." in the "profile-email-message"

  # ── Avatar file gate — wrong type rejected client-side (no upload) ──────────
  Scenario: choosing a non-image file for the avatar is rejected client-side
    Given "alice" has a seeded session
    When "alice" navigates to "/profile"
    Then "alice" sees the "profile-view" view
    When "alice" chooses a non-image file for their avatar
    Then "alice" sees "Please choose an image file (JPEG or PNG)." in the "profile-avatar-error"
    And "alice" does not see the "profile-avatar-preview" element

  # ── Avatar file gate — oversized image rejected client-side (no upload) ─────
  Scenario: choosing an image larger than 5 MB for the avatar is rejected client-side
    Given "alice" has a seeded session
    When "alice" navigates to "/profile"
    Then "alice" sees the "profile-view" view
    When "alice" chooses an avatar image larger than 5 MB
    Then "alice" sees "larger than 5" in the "profile-avatar-error"
    And "alice" does not see the "profile-avatar-preview" element

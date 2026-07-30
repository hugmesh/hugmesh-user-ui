import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { UserProfile, UserProfileService } from './user-profile.service';
import { ProfileAvatarComponent } from './profile-avatar.component';
import { accessibleName, defaultScreenReaderName, isPrintableAscii } from './accessible-name';

/**
 * Profile editor for the caller's OWN profile. ROLE_USER only — `owner = JWT
 * subject` is enforced server-side so a user can only edit their own profile.
 *
 * Editable fields: `gender`, `pronouns`, `timezone`, `displayName`,
 * `screenReaderName`, `visibility` (`'public'` | `'internal'`), and the
 * `vanitySubdomainEnabled` toggle. Saved via `PUT /bff/user/profile`. The
 * component also exposes password and email change actions that are relayed by
 * the BFF to Casdoor (`POST /bff/user/profile/password` and `.../email`).
 *
 * **Screen-reader name logic (changeset 008)**:
 * `screenReaderName` is the printable-ASCII name a screen reader announces for
 * this user. When `displayName` is pure printable-ASCII (U+0020..U+007E) the
 * editor auto-fills `screenReaderName` to match it and keeps them in sync as the
 * user types. When `displayName` is non-ASCII, the editor PROMPTS for an explicit
 * ASCII screen-reader name via an inline alert (mirrors the server's
 * `requiresScreenReaderName` check so the UI never surfaces a save that would
 * return 422). A live preview shows what a screen reader will actually announce.
 *
 * This component is self-contained and is also exposed as the federated `./profile`
 * module so the host can show it as a modal without loading the full user-ui shell.
 *
 * @see {@link UserProfileService}   — HTTP layer: `GET/PUT /bff/user/profile`.
 * @see {@link accessibleName}        — computes the preview announced name.
 * @see {@link isPrintableAscii}      — validates the screen-reader name field.
 * @see {@link defaultScreenReaderName} — auto-fill logic for ASCII display names.
 */
@Component({
  selector: 'hug-user-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, ProfileAvatarComponent],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent implements OnInit {
  private readonly profiles = inject(UserProfileService);

  /**
   * Editable in-memory copy of the caller's profile. Initialised with safe
   * defaults (visibility = `'internal'` — the least-public floor) and overwritten
   * once the BFF response arrives.
   */
  readonly model = signal<UserProfile>({
    gender: null,
    pronouns: null,
    timezone: null,
    displayName: null,
    visibility: 'internal',
    vanitySubdomainEnabled: false,
    screenReaderName: null,
  });

  /** Status announced to screen readers in a polite live region after save. */
  readonly statusMessage = signal('');
  /**
   * Whether {@link statusMessage} currently holds a FAILURE message, so the
   * template can tone the visible status line with `.hug-error` instead of the
   * shared success colour. Written only via {@link setStatus} /
   * {@link setStatusError}, which keeps it from going stale.
   */
  readonly statusIsError = signal(false);
  /** Inline validation error surfaced in a `role=alert` region. Empty = valid. */
  readonly formError = signal('');
  /** `true` while the PUT `/bff/user/profile` is in-flight (disables the Save button). */
  readonly saving = signal(false);

  /**
   * Whether the editor must prompt the user to enter an explicit screen-reader
   * name. `true` when:
   * - `displayName` is non-ASCII (contains characters outside U+0020..U+007E), AND
   * - `screenReaderName` is blank or also non-ASCII.
   *
   * Mirrors the server's `requiresScreenReaderName` check so the inline alert
   * appears exactly when a save attempt would return HTTP 422.
   */
  readonly needsScreenReaderName = computed(() => {
    const m = this.model();
    // ASCII (or absent) display name always has a safe default — no prompt needed.
    if (!m.displayName || isPrintableAscii(m.displayName)) {
      return false;
    }
    // Non-ASCII display name: a usable (non-blank, printable-ASCII) screen-reader
    // name must have been entered.
    const srn = m.screenReaderName;
    return !srn || !srn.trim() || !isPrintableAscii(srn);
  });

  /**
   * The aria-label / screen-reader name that assistive technology will announce
   * for this profile — the ASCII `screenReaderName` when set, else `displayName`.
   * Rendered as a live preview so the user sees exactly what a screen reader will
   * say before they save.
   */
  readonly previewName = computed(() =>
    accessibleName(this.model().displayName, this.model().screenReaderName),
  );

  // ── Password change fields ────────────────────────────────────────────────
  /** Bound to the current-password input in the change-password section. */
  oldPassword = '';
  /** Bound to the new-password input in the change-password section. */
  newPassword = '';
  /** Status/error for the change-password section (separate from the main form). */
  readonly passwordMessage = signal('');

  // ── Email change fields ───────────────────────────────────────────────────
  /** Bound to the new-email input in the change-email section. */
  newEmail = '';
  /** Status/error for the change-email section (separate from the main form). */
  readonly emailMessage = signal('');

  /** Load the caller's profile on component init and seed the editable model. */
  async ngOnInit(): Promise<void> {
    try {
      const p = await firstValueFrom(this.profiles.load());
      // Normalise visibility: treat anything other than 'public' as 'internal'
      // (the server's minimum floor; unknown future values degrade safely).
      this.model.set({
        ...p,
        visibility: p.visibility === 'public' ? 'public' : 'internal',
        // Coerce undefined (older BFF that doesn't send the field) to null so
        // downstream computed signals don't have to handle undefined.
        screenReaderName: p.screenReaderName ?? null,
      });
    } catch {
      this.setStatusError('Could not load your profile; starting from defaults.');
    }
  }

  /**
   * Generic field setter that merges a single key into the immutable signal model.
   * Used by template bindings for all fields EXCEPT `displayName`, which has
   * special auto-fill logic (see {@link setDisplayName}).
   *
   * @param key   The profile field to update.
   * @param value The new value for that field.
   */
  set<K extends keyof UserProfile>(key: K, value: UserProfile[K]): void {
    this.model.set({ ...this.model(), [key]: value });
  }

  /**
   * Display-name change handler with screen-reader-name auto-fill. Mirrors the
   * server's default-fill logic:
   * - When the new display name is pure ASCII AND the screen-reader name is blank
   *   or was previously tracking the old display name, `screenReaderName` is
   *   auto-filled with the new display name for free.
   * - When the new display name is non-ASCII, the auto-fill produces `null`,
   *   which clears any stale tracked value and triggers the inline prompt.
   *
   * @param value The new display name typed by the user.
   */
  setDisplayName(value: string): void {
    const m = this.model();
    const next: UserProfile = { ...m, displayName: value };
    // Compute what the server's default-fill would produce for this display name.
    const defaulted = defaultScreenReaderName(value);
    // Was the screen-reader name just tracking the old display name (default-fill
    // case)? If so it must follow the new display name rather than go stale.
    const srnTrackedOldDisplay = (m.screenReaderName ?? '') === (m.displayName ?? '');
    const srnBlank = !m.screenReaderName || !m.screenReaderName.trim();
    if (srnBlank || srnTrackedOldDisplay) {
      // ASCII display name → auto-fill; non-ASCII → null clears stale tracking
      // and lets needsScreenReaderName fire the inline prompt.
      next.screenReaderName = defaulted;
    }
    this.model.set(next);
  }

  /**
   * Save the profile to the BFF (`PUT /bff/user/profile`). Validates client-side
   * before submitting to avoid a confusing post-submit 422:
   * - `displayName` must be non-blank.
   * - `screenReaderName` (if entered) must be printable ASCII.
   * - When `displayName` is non-ASCII, a valid `screenReaderName` is required.
   */
  async save(): Promise<void> {
    const m = this.model();
    if (!m.displayName || !m.displayName.trim()) {
      this.formError.set('A display name is required.');
      return;
    }
    const srn = m.screenReaderName;
    if (srn && srn.trim() && !isPrintableAscii(srn)) {
      this.formError.set(
        'A screen-reader name must use only printable ASCII characters (letters, digits, basic punctuation).',
      );
      return;
    }
    if (this.needsScreenReaderName()) {
      this.formError.set(
        'Your display name contains characters a screen reader cannot announce cleanly; enter an ASCII screen-reader name.',
      );
      return;
    }
    this.formError.set('');
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(
        this.profiles.save({
          ...m,
          // Trim the display name to avoid leading/trailing whitespace being persisted.
          displayName: m.displayName.trim(),
          // Submit null for a blank screen-reader name (the server's default-fill
          // applies; we never persist an empty string).
          screenReaderName: srn && srn.trim() ? srn.trim() : null,
        }),
      );
      // Update the model with the server-confirmed response so any server-side
      // normalisation (e.g. default-filled screenReaderName) is reflected.
      this.model.set({
        ...saved,
        visibility: saved.visibility === 'public' ? 'public' : 'internal',
        screenReaderName: saved.screenReaderName ?? null,
      });
      this.setStatus('Profile saved.');
    } catch {
      this.setStatusError('Could not save your profile. Please try again.');
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Change the caller's Casdoor password. Relays the request to the BFF, which
   * forwards it to the Casdoor IdP. Clears the form fields on success.
   */
  async changePassword(): Promise<void> {
    if (!this.oldPassword || !this.newPassword) {
      this.passwordMessage.set('Both the current and new password are required.');
      return;
    }
    try {
      const ack = await this.profiles.changePassword(this.oldPassword, this.newPassword);
      this.passwordMessage.set(`Password change ${ack.status} (Casdoor: ${ack.casdoor}).`);
      // Clear inputs so the fields do not retain the password in memory.
      this.oldPassword = '';
      this.newPassword = '';
    } catch {
      this.passwordMessage.set('Could not change your password. Please try again.');
    }
  }

  /**
   * Change the caller's Casdoor account email. Relays the request to the BFF.
   * Clears the form field on success.
   */
  async changeEmail(): Promise<void> {
    if (!this.newEmail || !this.newEmail.trim()) {
      this.emailMessage.set('A new email address is required.');
      return;
    }
    try {
      const ack = await this.profiles.changeEmail(this.newEmail.trim());
      this.emailMessage.set(`Email change ${ack.status} (Casdoor: ${ack.casdoor}).`);
      this.newEmail = '';
    } catch {
      this.emailMessage.set('Could not change your email. Please try again.');
    }
  }

  /**
   * Show a neutral or SUCCESS status message.
   *
   * The status line is rendered visibly, so its tone has to be driven by the
   * code rather than assumed by the stylesheet — see {@link setStatusError}.
   *
   * @param message Text for the polite live region.
   */
  private setStatus(message: string): void {
    this.statusMessage.set(message);
    this.statusIsError.set(false);
  }

  /**
   * Show a FAILURE status message.
   *
   * `statusMessage` carries both outcomes, so without this the shared
   * `.hug-status` rule would paint every "Could not …" line in success green.
   * Setting the flag adds `.hug-error` in the template instead.
   *
   * @param message Text for the polite live region.
   */
  private setStatusError(message: string): void {
    this.statusMessage.set(message);
    this.statusIsError.set(true);
  }
}

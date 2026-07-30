import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { SelfSilence, SelfSilenceService } from './self-silence.service';

/**
 * Self-silence view: self-service visibility hide (NOT a ban). ROLE_USER only —
 * the BFF forces `owner = JWT subject` so a user can only ever silence THEMSELVES.
 *
 * The user sets a future `expiresAt` time; the BFF's `@Scheduled
 * SelfSilenceExpiryAction` auto-clears the hide at that instant with no manual
 * action. This view reads the scheduled wake window back and exposes it as the
 * auto-restore time. A "request early restore" control (email-mod) writes a
 * `self-silence-appeal` into the federation mod queue; the hide still auto-clears
 * at `expiresAt` regardless.
 *
 * While a silence is already active the activate control is DISABLED with helptext
 * to prevent double-activation; cancel and email-mod remain available.
 *
 * @see {@link SelfSilenceService} — HTTP layer: `/bff/user/self-silence/**`.
 */
@Component({
  selector: 'hug-user-self-silence',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './self-silence.component.html',
  styleUrl: './self-silence.component.scss',
})
export class SelfSilenceComponent implements OnInit {
  private readonly silenceService = inject(SelfSilenceService);

  /** The caller's current self-silence (`null` = none active). */
  readonly silence = signal<SelfSilence | null>(null);

  /** `<input type="datetime-local">` value (local wall-clock) for the new silence's expiry. */
  until = '';
  /** Optional free-text reason shown in the mod queue for any appeal. */
  reason = '';

  /** Inline validation error surfaced in a `role=alert` live region. Empty = valid. */
  readonly formError = signal('');
  /** Status announced to screen readers in a polite live region. */
  readonly statusMessage = signal('');
  /**
   * Whether {@link statusMessage} currently holds a FAILURE message, so the
   * template can tone the visible status line with `.hug-error` instead of the
   * shared success colour. Written only via {@link setStatus} /
   * {@link setStatusError}, which keeps it from going stale.
   */
  readonly statusIsError = signal(false);
  /** True while any BFF call is in-flight (disables all submit buttons). */
  readonly busy = signal(false);

  /**
   * Whether a self-silence is currently in effect. Derived from the loaded
   * silence: `true` when the silence exists, has not been manually cleared, and
   * `expiresAt` is still in the future.
   */
  readonly active = computed(() => {
    const s = this.silence();
    // No silence row, or the row was cleared — not active.
    if (!s || s.clearedAt || !s.expiresAt) {
      return false;
    }
    // Still active when the expiry is strictly in the future.
    return new Date(s.expiresAt).getTime() > Date.now();
  });

  /**
   * The ISO timestamp when the silence auto-expires (the BFF's scheduled wake
   * time). `null` when no silence is active.
   */
  readonly wakeAt = computed(() => this.silence()?.expiresAt ?? null);

  /** Load the caller's current self-silence status on component init. */
  async ngOnInit(): Promise<void> {
    try {
      this.silence.set(await firstValueFrom(this.silenceService.status()));
    } catch {
      this.setStatusError('Could not load your self-silence status.');
    }
  }

  /**
   * Activate a self-silence until the date/time the user entered. Converts the
   * `<input type="datetime-local">` wall-clock value to an ISO string for the BFF.
   * Validates that the chosen time is in the future before submitting.
   */
  async activate(): Promise<void> {
    if (this.active()) {
      // Guard: the template disables the button when active, but defend in code too.
      return;
    }
    if (!this.until) {
      this.formError.set('Choose when your hide should end.');
      return;
    }
    // Parse the datetime-local value (local time) to a Date for validation.
    const expires = new Date(this.until);
    if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) {
      this.formError.set('The end time must be in the future.');
      return;
    }
    this.formError.set('');
    this.busy.set(true);
    try {
      // Convert to ISO 8601 (UTC) for the BFF; the server stores and uses this
      // as the @Scheduled SelfSilenceExpiryAction trigger time.
      const s = await firstValueFrom(
        this.silenceService.activate(expires.toISOString(), this.reason.trim() || undefined),
      );
      this.silence.set(s);
      this.reason = '';
      this.setStatus('You are now hidden from others.');
    } catch {
      this.setStatusError('Could not activate your self-silence. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Cancel the active self-silence immediately (un-hide + clear). The BFF clears
   * the scheduled expiry; the silence is removed.
   */
  async cancel(): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.silenceService.cancel());
      // Reflect the cancellation locally without waiting for a status reload.
      this.silence.set(null);
      this.setStatus('Your self-silence was cancelled — you are visible again.');
    } catch {
      this.setStatusError('Could not cancel your self-silence. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Submit a self-silence-appeal to the mod queue, asking a moderator to restore
   * the caller sooner than the scheduled auto-expiry. The hide itself is NOT
   * changed — it still auto-clears at `expiresAt`.
   */
  async emailMod(): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.silenceService.emailMod(this.reason.trim() || undefined));
      this.setStatus(
        'A moderator has been asked to restore you sooner; your hide still auto-clears at the time above.',
      );
    } catch {
      this.setStatusError('Could not contact a moderator. Please try again.');
    } finally {
      this.busy.set(false);
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

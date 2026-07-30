import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { BlockService } from './block.service';
import { SessionService } from './session.service';

/**
 * Instance-block recommendation form: posts a recommendation to the BFF
 * (`POST /bff/user/recommend-instance-block`), which creates a federation
 * moderation queue row with `kind='instance-block'` and `status='recommended'`.
 * This starts the USER → MOD → ADMIN chain — the user is flagging a problem
 * instance for moderator review, NOT applying a block directly.
 *
 * The moderator queue in the mod console will surface this row; a mod can then
 * refer it to an admin, who decides approve/deny. The user's own self-block list
 * (see {@link SelfBlockComponent}) is a separate, user-scoped concept.
 *
 * @see {@link BlockService.recommendInstanceBlock} — the single BFF call made here.
 * @see {@link SelfBlockComponent}                  — for per-identity self-blocks.
 */
@Component({
  selector: 'hug-user-recommend-instance-block',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './recommend-instance-block.component.html',
  styleUrl: './recommend-instance-block.component.scss',
})
export class RecommendInstanceBlockComponent {
  private readonly blockService = inject(BlockService);
  private readonly session = inject(SessionService);

  /**
   * Whether the caller holds a homeserver platform role (`ROLE_MATRIX` /
   * `ROLE_MASTODON`). The BFF gates `recommend-instance-block` on
   * `hasAnyRole('MATRIX','MASTODON')`, so without it the form's submit would just
   * 403. This signal drives the UI's disable + helptext mirror of that gate
   * (defence-in-depth — the API remains the authoritative gate), matching the
   * connected-apps surface convention.
   */
  readonly hasPlatformRole = this.session.hasPlatformRole;

  /** The instance domain the user wants to recommend blocking (bound to the form input). */
  instance = '';
  /** Optional free-text reason for the moderator (bound to the form textarea). */
  reason = '';

  /** Inline validation error shown near the instance field. Empty = valid. */
  readonly formError = signal('');
  /** Status announced to screen readers after a submission attempt. */
  readonly statusMessage = signal('');
  /**
   * Whether {@link statusMessage} currently holds a FAILURE message, so the
   * template can tone the visible status line with `.hug-error` instead of the
   * shared success colour. Written only via {@link setStatus} /
   * {@link setStatusError}, which keeps it from going stale.
   */
  readonly statusIsError = signal(false);
  /** `true` while the POST is in-flight (disables the submit button). */
  readonly submitting = signal(false);

  /**
   * Submit the recommendation. Validates that an instance domain was entered,
   * posts to the BFF, and on success clears the form fields.
   */
  async submit(): Promise<void> {
    if (!this.hasPlatformRole()) {
      // Defence-in-depth: the template disables submit + explains the gate, but
      // guard the write in code too so an aria-disabled (still-clickable) submit
      // never fires a request the BFF will only 403.
      return;
    }
    if (!this.instance.trim()) {
      this.formError.set('An instance (homeserver / domain) is required.');
      return;
    }
    this.formError.set('');
    this.submitting.set(true);
    try {
      await firstValueFrom(
        this.blockService.recommendInstanceBlock(this.instance.trim(), this.reason.trim()),
      );
      this.setStatus(`Recommended a block on "${this.instance.trim()}" for moderator review.`);
      // Clear the form so the user can submit another recommendation without
      // re-typing over a previous entry.
      this.instance = '';
      this.reason = '';
    } catch {
      this.setStatusError('Could not submit your recommendation. Please try again.');
    } finally {
      this.submitting.set(false);
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

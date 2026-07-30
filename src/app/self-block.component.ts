import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { BLOCK_PLATFORMS, BlockPlatform, BlockService, UserBlock } from './block.service';

/**
 * Self-block list: list, add, and remove the caller's OWN self-blocks. ROLE_USER
 * only — the BFF forces `owner = JWT subject` so a user can only ever see and
 * edit their own block list.
 *
 * `platform` is one of `matrix | mastodon | internal` (see {@link BlockPlatform});
 * `target` is the blocked identity on that platform (MXID, Mastodon acct, or
 * internal username). Adding a block persists a row on the BFF and performs a
 * best-effort push to the external homeserver.
 *
 * @see {@link BlockService}    — HTTP layer: `GET/POST/DELETE /bff/user/blocks`.
 * @see {@link RecommendInstanceBlockComponent} — separate form for recommending
 *   an instance-level block to the moderator queue.
 */
@Component({
  selector: 'hug-user-self-block',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './self-block.component.html',
  styleUrl: './self-block.component.scss',
})
export class SelfBlockComponent implements OnInit {
  private readonly blockService = inject(BlockService);

  /** The caller's current self-block list. */
  readonly blocks = signal<UserBlock[]>([]);
  /** All available platforms, surfaced to the template's platform selector. */
  readonly platforms = BLOCK_PLATFORMS;

  /** The target identity to block (bound to the form input). */
  target = '';
  /** The selected platform for a new block (defaults to `'internal'`). */
  platform: BlockPlatform = 'internal';

  /** Inline validation error shown near the form fields (empty = valid). */
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

  /** Load the caller's self-block list on component init. */
  async ngOnInit(): Promise<void> {
    try {
      this.blocks.set(await firstValueFrom(this.blockService.list()));
    } catch {
      this.setStatusError('Could not load your self-blocks.');
    }
  }

  /**
   * Submit the new-block form. Validates that a target is present, posts the
   * block to the BFF, refreshes the list on success, and clears the form.
   */
  async add(): Promise<void> {
    if (!this.target.trim()) {
      this.formError.set('A target to block is required.');
      return;
    }
    this.formError.set('');
    try {
      // BlockService.block() already refreshes the list subject internally;
      // we also sync the local signal here so the template updates immediately.
      await firstValueFrom(this.blockService.block(this.target.trim(), this.platform));
      this.blocks.set(await firstValueFrom(this.blockService.list()));
      this.setStatus(`Blocked "${this.target.trim()}".`);
      this.target = '';
    } catch {
      this.setStatusError('Could not add the self-block. Please try again.');
    }
  }

  /**
   * Remove an existing self-block by its server-assigned id. Refreshes the list
   * on success.
   *
   * @param block The {@link UserBlock} row to delete.
   */
  async remove(block: UserBlock): Promise<void> {
    try {
      await firstValueFrom(this.blockService.unblock(block.id));
      this.blocks.set(await firstValueFrom(this.blockService.list()));
      this.setStatus(`Removed block on "${block.target}".`);
    } catch {
      this.setStatusError('Could not remove the self-block. Please try again.');
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

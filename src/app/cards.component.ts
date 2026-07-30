import { Component, OnInit, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { catchError, of } from 'rxjs';
import { CardsService, UserModuleCard } from './cards.service';
import { CardEditorComponent } from './card-editor.component';
import { emptySection, encodeDocument, decodeDocument } from './card-sections';
import { OwncastService, MyStreamStatus } from './owncast.service';

/**
 * Cards manager: list / create / update the caller's OWN federation bundle
 * cards. A user only ever sees their own cards (the BFF forwards the JWT and
 * scopes /mine + ownership to the same subject). The editor is the sandboxed,
 * DRAGGABLE SECTION builder {@link CardEditorComponent}: the author arranges
 * ordered sections (each with its own orientation), writes content using the
 * provided `sd-*` tags + MathTeX, and sees a live, sandboxed preview. On publish,
 * the section DOCUMENT is serialised (v2 body: section JSON + fenced CSS) and
 * sent as the entry-file octet-stream body via the unchanged
 * {@link CardsService.put} contract, so re-opening a card restores the exact
 * section structure losslessly.
 */
@Component({
  selector: 'hug-user-cards',
  standalone: true,
  imports: [CommonModule, FormsModule, CardEditorComponent],
  templateUrl: './cards.component.html',
  styleUrl: './cards.component.scss',
})
export class CardsComponent implements OnInit {
  private readonly cardsService = inject(CardsService);
  private readonly owncastService = inject(OwncastService);
  private readonly editor = viewChild(CardEditorComponent);

  readonly cards = signal<UserModuleCard[]>([]);

  // Card metadata (the body now comes from the WYSIWYG editor).
  slug = '';
  entryFile = '';
  visibility = 'internal';

  readonly formError = signal('');
  readonly statusMessage = signal('');
  /**
   * Whether {@link statusMessage} currently holds a FAILURE message, so the
   * template can tone the visible status line with `.hug-error` instead of the
   * shared success colour. Written only via {@link setStatus} /
   * {@link setStatusError}, which keeps it from going stale.
   */
  readonly statusIsError = signal(false);
  readonly saving = signal(false);

  /**
   * When the card content contains `<sd-owncast-player>` this signal tracks the
   * broadcast-grant check result:
   *   - `'unchecked'` — not yet verified (default; no sd-owncast-player in card)
   *   - `'checking'`  — grant check in flight
   *   - `'granted'`   — BFF confirmed an active broadcast grant
   *   - `'denied'`    — no active grant (user needs admin to grant one)
   */
  readonly owncastGrantState = signal<'unchecked' | 'checking' | 'granted' | 'denied'>('unchecked');

  /** The platform-supplied HLS stream URL, populated when grant is active. */
  private owncastStreamUrl: string | undefined = undefined;

  async ngOnInit(): Promise<void> {
    try {
      this.cards.set(await firstValueFrom(this.cardsService.listMine()));
    } catch {
      this.setStatusError('Could not load your cards.');
    }
  }

  /**
   * Detect whether the current editor content contains `<sd-owncast-player>`,
   * and if so check the broadcast grant via the BFF. Populates
   * {@link owncastGrantState} and {@link owncastStreamUrl}. Called when the
   * section content changes (via `(ngModelChange)` on the section body) and
   * again just-in-time before publish.
   */
  async checkOwncastGrant(): Promise<void> {
    const doc = this.editor()?.document() ?? { sections: [], css: '' };
    const hasPlayer = doc.sections.some((s) => (s.content ?? '').includes('<sd-owncast-player'));
    if (!hasPlayer) {
      this.owncastGrantState.set('unchecked');
      this.owncastStreamUrl = undefined;
      return;
    }
    this.owncastGrantState.set('checking');
    try {
      const status: MyStreamStatus | null = await firstValueFrom(
        this.owncastService.myStream().pipe(catchError(() => of(null))),
      );
      if (status?.streamUrl && status.visibility) {
        this.owncastStreamUrl = status.streamUrl;
        this.owncastGrantState.set('granted');
      } else {
        this.owncastStreamUrl = undefined;
        this.owncastGrantState.set('denied');
      }
    } catch {
      this.owncastStreamUrl = undefined;
      this.owncastGrantState.set('denied');
    }
  }

  /** Create/update the card bundle for the entered slug from the section document. */
  async publish(): Promise<void> {
    const doc = this.editor()?.document() ?? { sections: [], css: '' };
    const hasContent = doc.sections.some((s) => (s.content ?? '').trim() || (s.title ?? '').trim());
    if (!this.slug.trim() || !hasContent) {
      this.formError.set('A slug and at least one section with content are required.');
      return;
    }

    // If the card contains an <sd-owncast-player>, verify the broadcast grant
    // before sending. The grant check also resolves the platform-supplied stream
    // URL so it can be threaded into renderSafeCardHtml (never from card markup).
    const hasPlayer = doc.sections.some((s) => (s.content ?? '').includes('<sd-owncast-player'));
    if (hasPlayer) {
      await this.checkOwncastGrant();
      if (this.owncastGrantState() !== 'granted') {
        this.formError.set(
          'You need a broadcast grant from an admin to publish a live stream card.',
        );
        return;
      }
    }

    this.formError.set('');
    this.saving.set(true);
    const body = encodeDocument(doc);
    try {
      await firstValueFrom(
        this.cardsService.put(this.slug.trim(), body, {
          entryFile: this.entryFile.trim() || undefined,
          visibility: this.visibility || undefined,
        }),
      );
      this.cards.set(await firstValueFrom(this.cardsService.listMine()));
      this.setStatus(`Card "${this.slug.trim()}" published.`);
      this.slug = '';
      this.entryFile = '';
      this.owncastGrantState.set('unchecked');
      this.owncastStreamUrl = undefined;
      this.editor()?.setDocument({ sections: [emptySection()], css: '' });
    } catch {
      this.setStatusError('Could not publish your card. Please try again.');
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Load one card's slug/visibility into the editor for an update AND pre-fill the
   * editor with its CURRENT content by reading the card's body from the BFF
   * (owner-scoped read-my-card-body) and decoding it back into the section
   * DOCUMENT with {@link decodeDocument}, so the author edits the real prior
   * sections instead of re-authoring from scratch. If the body read fails the
   * editor opens empty (a non-fatal fallback) and the status message explains it.
   *
   * @param card The {@link UserModuleCard} row to load into the editor.
   */
  async edit(card: UserModuleCard): Promise<void> {
    this.slug = card.slug;
    this.visibility = card.visibility ?? 'internal';
    this.entryFile = '';
    this.editor()?.setDocument({ sections: [emptySection()], css: '' });
    this.setStatus(`Loading "${card.slug}" for editing…`);
    try {
      const body = await firstValueFrom(this.cardsService.readBody(card.slug));
      this.editor()?.setDocument(decodeDocument(body ?? ''));
      this.setStatus(`Editing "${card.slug}" — publishing creates a new version.`);
    } catch {
      this.setStatusError(`Editing "${card.slug}" — could not load the prior body; re-author it.`);
    }
  }

  /**
   * Delete one of the caller's OWN cards by slug (owner-scoped upstream). Refreshes
   * the list on success; if the deleted card was currently loaded in the editor,
   * clears the editor and resets the slug/entry-file fields.
   *
   * @param card The {@link UserModuleCard} row to delete.
   */
  async remove(card: UserModuleCard): Promise<void> {
    this.setStatus(`Deleting "${card.slug}"…`);
    try {
      await firstValueFrom(this.cardsService.delete(card.slug));
      this.cards.set(await firstValueFrom(this.cardsService.listMine()));
      if (this.slug === card.slug) {
        this.slug = '';
        this.entryFile = '';
        this.editor()?.setDocument({ sections: [emptySection()], css: '' });
      }
      this.setStatus(`Card "${card.slug}" deleted.`);
    } catch {
      this.setStatusError(`Could not delete "${card.slug}". Please try again.`);
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

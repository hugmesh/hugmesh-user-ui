import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, from } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { CardsService as GenCardsService } from './api/services/cards.service';

/**
 * One of the caller's own federation-bundle card versions, matched field-for-field
 * to the user-bff-api `UserModuleCard` record (which binds the
 * hugmesh-federation-api `UserModule` JSON directly).
 */
export interface UserModuleCard {
  /** Server-assigned numeric id for this card version. */
  id: number | null;
  /** Casdoor subject of the owning user (server-set). */
  ownerUserId: string | null;
  /** URL-safe slug that identifies this card across versions. */
  slug: string;
  /** Storage path for this version's entry file in the federation storage bucket. */
  versionDir: string | null;
  /** SHA-256 hash of the entry file body (content-addressed version key). */
  contentHash: string | null;
  /** JSON manifest for this card (optional; used by the module federation loader). */
  manifestJson: string | null;
  /** Visibility scope: `'public'` | `'internal'` | `'private'`. */
  visibility: string | null;
  /** ISO timestamp when this version was first published. */
  createdAt: string | null;
  /** ISO timestamp when this version was superseded by a newer publish; null for current. */
  supersededAt: string | null;
}

/**
 * Datastore service for the caller's OWN federation bundle cards. ROLE_USER only
 * — the BFF forwards the caller's JWT so the federation-api scopes `/mine` and
 * card ownership on PUT/DELETE to the same JWT subject. A user can only ever see
 * and edit their own cards.
 *
 * Backed by a {@link BehaviorSubject} so {@link CardsComponent} can subscribe to
 * {@link cards$} and receive updated lists after each publish or deletion.
 *
 * <p><b>ng-openapi-gen migration:</b> this service now DELEGATES to the generated,
 * typed {@link GenCardsService} (under {@code src/app/api}, generated from the
 * user-bff-api OpenAPI spec) instead of hand-rolling {@code HttpClient} URLs —
 * following the {@link UserProfileService} reference migration. The generated
 * client calls the SAME same-origin {@code /bff/user/**} paths (its
 * {@code rootUrl} defaults to '') through {@code HttpClient}, so the wire
 * behaviour — and the auth interceptor that attaches the HttpOnly `bff_` session
 * cookie — are unchanged. This service keeps its OWN public
 * {@link UserModuleCard} type so {@link CardsComponent} needs no change; the
 * generated model is bridged at the delegation boundary.
 *
 * Endpoints (user-bff-api `CardsController`):
 * - `GET    /bff/user/cards`             → {@link listMine}  → `GenCardsService.mine2()`
 * - `GET    /bff/user/cards/{slug}`      → {@link listBySlug} (version history) → `bySlug({slug})`
 * - `GET    /bff/user/cards/{slug}/body` → {@link readBody} (source for Edit pre-fill; hand-rolled, see below)
 * - `PUT    /bff/user/cards/{slug}`      → {@link put} (octet-stream publish) → `put2({slug, body, …})`
 * - `DELETE /bff/user/cards/{slug}`      → {@link delete} → `delete1({slug})`
 *
 * @see {@link CardsComponent} — the primary consumer of this service.
 */
@Injectable({ providedIn: 'root' })
export class CardsService {
  private readonly cardsApi = inject(GenCardsService);
  // Direct HttpClient for the card-body READ only — see readBody() for why the
  // generated fn cannot be used there. Every other call delegates to cardsApi.
  private readonly http = inject(HttpClient);
  private readonly base = '/bff/user/cards';

  private readonly cardsSubject = new BehaviorSubject<UserModuleCard[]>([]);

  /**
   * Observable stream of the caller's own cards (current-version rows). Emits
   * the latest list after each {@link listMine}, {@link put}, or {@link delete}.
   */
  readonly cards$: Observable<UserModuleCard[]> = this.cardsSubject.asObservable();

  /**
   * Fetch the caller's own cards (one row per slug, the current version) and
   * push the result onto {@link cards$}.
   *
   * @returns An Observable that emits the list of {@link UserModuleCard}s.
   */
  listMine(): Observable<UserModuleCard[]> {
    return from(this.cardsApi.mine2()).pipe(
      map((cards) => cards as unknown as UserModuleCard[]),
      // Coerce null to [] and push so any open subscriber on cards$ updates.
      tap((cards) => this.cardsSubject.next(cards ?? [])),
    );
  }

  /**
   * Fetch all persisted versions of one of the caller's cards by slug. Does NOT
   * update {@link cards$} (use {@link listMine} for that). Owner-scoped upstream.
   *
   * @param slug The card slug to query versions for.
   * @returns An Observable that emits the version history list.
   */
  listBySlug(slug: string): Observable<UserModuleCard[]> {
    return from(this.cardsApi.bySlug({ slug })).pipe(
      map((cards) => cards as unknown as UserModuleCard[]),
    );
  }

  /**
   * Fetch the raw source body of the caller's CURRENT card version by slug. The
   * body is the serialised `CardDocument` (v2 section JSON + optional fenced CSS)
   * or a legacy markdown body for older cards. Owner-scoped upstream (federation-
   * api returns only the caller's own card body). Used by the Edit flow to
   * pre-fill the section editor via {@link decodeDocument}.
   *
   * NOT delegated to the generated client. The BFF declares this response as
   * `application/octet-stream` / `format: byte`, so ng-openapi-gen emits
   * `src/app/api/fn/cards/body.ts` with `responseType: 'blob'` while TYPING the
   * result as `string`: at runtime `CardsService.body()` hands back a `Blob`,
   * which the Edit pre-fill would then try to parse as text. Hand-rolled here
   * (same precedent as the multipart avatar upload in {@link UserProfileService})
   * until the BFF describes this response as text.
   *
   * @param slug The card slug whose body to read.
   * @returns An Observable that emits the raw text body.
   */
  readBody(slug: string): Observable<string> {
    // Request as plain text so Angular does not attempt JSON parsing; the body
    // is a mixed-format document (Markdown / JSON / CSS), not JSON.
    return this.http.get(`${this.base}/${encodeURIComponent(slug)}/body`, {
      responseType: 'text',
    });
  }

  /**
   * Delete one of the caller's own cards by slug. Owner-scoped upstream.
   * Automatically refreshes {@link cards$} on success so the manager list drops
   * the deleted slug.
   *
   * @param slug The card slug to delete.
   * @returns An Observable that completes when the BFF confirms deletion.
   */
  delete(slug: string): Observable<void> {
    return from(this.cardsApi.delete1({ slug })).pipe(
      // Refresh the cards list so the deleted card disappears immediately.
      tap(() => this.listMine().subscribe()),
    );
  }

  /**
   * Publish (create or supersede) a card bundle for the given slug. The `body`
   * is the single entry-file sent as `application/octet-stream`; the federation-api
   * content-hashes it, records a row under the caller's JWT subject, and supersedes
   * the previous version. Automatically refreshes {@link cards$} on success.
   *
   * @param slug The card slug to publish under.
   * @param body The serialised `CardDocument` body (v2 section JSON + CSS).
   * @param opts Optional query parameters forwarded to the federation-api.
   * @param opts.entryFile    Override the entry-file name (defaults to `index.html`).
   * @param opts.visibility   Visibility scope (`'public'` | `'internal'` | `'private'`).
   * @param opts.manifestJson Module-federation manifest JSON string.
   * @returns An Observable that emits the newly published {@link UserModuleCard}.
   */
  put(
    slug: string,
    body: string,
    opts: { entryFile?: string; visibility?: string; manifestJson?: string } = {},
  ): Observable<UserModuleCard> {
    return from(
      this.cardsApi.put2({
        slug,
        // Only forward the optional query params that were actually set; the
        // generated request builder drops any that are undefined.
        entryFile: opts.entryFile || undefined,
        visibility: opts.visibility || undefined,
        manifest: opts.manifestJson || undefined,
        // Sent as raw bytes (the generated fn sets application/octet-stream) so
        // the federation-api can content-hash it cleanly.
        body,
      }),
    ).pipe(
      map((card) => card as unknown as UserModuleCard),
      // Refresh the cards list so the new version appears immediately.
      tap(() => this.listMine().subscribe()),
    );
  }
}

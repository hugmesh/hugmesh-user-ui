import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

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
 * Endpoints (user-bff-api `CardsController`):
 * - `GET    /bff/user/cards`             → {@link listMine}
 * - `GET    /bff/user/cards/{slug}`      → {@link listBySlug} (version history)
 * - `GET    /bff/user/cards/{slug}/body` → {@link readBody} (source for Edit pre-fill)
 * - `PUT    /bff/user/cards/{slug}`      → {@link put} (octet-stream publish)
 * - `DELETE /bff/user/cards/{slug}`      → {@link delete}
 *
 * TODO: this service still hand-rolls `HttpClient` calls; the generated
 * ng-openapi-gen client (`src/app/api/services/cards.service.ts` +
 * `src/app/api/fn/cards/*`) already covers all five endpoints above and could
 * replace this by-hand version, matching the migration `UserProfileService`
 * already completed (see README Deferrals — one-of-nine typed-client gap).
 *
 * @see {@link CardsComponent} — the primary consumer of this service.
 */
@Injectable({ providedIn: 'root' })
export class CardsService {
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
    return this.http
      .get<UserModuleCard[]>(this.base)
      // Coerce null to [] and push so any open subscriber on cards$ updates.
      .pipe(tap((cards) => this.cardsSubject.next(cards ?? [])));
  }

  /**
   * Fetch all persisted versions of one of the caller's cards by slug. Does NOT
   * update {@link cards$} (use {@link listMine} for that). Owner-scoped upstream.
   *
   * @param slug The card slug to query versions for.
   * @returns An Observable that emits the version history list.
   */
  listBySlug(slug: string): Observable<UserModuleCard[]> {
    return this.http.get<UserModuleCard[]>(`${this.base}/${encodeURIComponent(slug)}`);
  }

  /**
   * Fetch the raw source body of the caller's CURRENT card version by slug. The
   * body is the serialised `CardDocument` (v2 section JSON + optional fenced CSS)
   * or a legacy markdown body for older cards. Owner-scoped upstream (federation-
   * api returns only the caller's own card body). Used by the Edit flow to
   * pre-fill the section editor via {@link decodeDocument}.
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
    return this.http
      .delete<void>(`${this.base}/${encodeURIComponent(slug)}`)
      // Refresh the cards list so the deleted card disappears immediately.
      .pipe(tap(() => this.listMine().subscribe()));
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
    // Build query params from the optional opts (only set non-empty ones).
    let params = new HttpParams();
    if (opts.entryFile) params = params.set('entryFile', opts.entryFile);
    if (opts.visibility) params = params.set('visibility', opts.visibility);
    if (opts.manifestJson) params = params.set('manifest', opts.manifestJson);
    // Send the body as raw bytes so the federation-api can content-hash it cleanly.
    const headers = new HttpHeaders({ 'Content-Type': 'application/octet-stream' });
    return this.http
      .put<UserModuleCard>(`${this.base}/${encodeURIComponent(slug)}`, body, { headers, params })
      // Refresh the cards list so the new version appears immediately.
      .pipe(tap(() => this.listMine().subscribe()));
  }
}

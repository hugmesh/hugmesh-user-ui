import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, from } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { ConnectedClientsService as GenConnectedClientsService } from './api/services/connected-clients.service';

/**
 * One connected app or device belonging to the caller, matched field-for-field to
 * the user-bff-api `ConnectedClient` record. Represents either a native OAuth app
 * (Element, Tusky, Ivory) or a device session on a homeserver. `owner` is
 * server-set (= JWT subject) and never sent from the client, so a user can only
 * ever see and revoke THEIR OWN clients.
 */
export interface ConnectedClient {
  /** Server-assigned identifier for this client row; used as the revocation key. */
  id: string;
  /** Owning user's Casdoor subject (server-set; never written from the client). */
  owner?: string;
  /** Which homeserver platform this client belongs to. */
  platform: 'matrix' | 'mastodon';
  /** Whether this is a registered OAuth app or a direct device session. */
  clientKind: 'oauth-app' | 'device';
  /** Homeserver-side reference ID (e.g. Matrix device id, Mastodon app id). */
  externalRef?: string;
  /** Human-readable name of the app or device (null when not provided by the homeserver). */
  label?: string | null;
  /** ISO timestamp when this client was first registered. */
  createdAt?: string | null;
  /** ISO timestamp when the client was revoked, or null when still active. */
  revokedAt?: string | null;
}

/**
 * Datastore service for the caller's OWN connected apps and device sessions.
 * ROLE_USER only — requires an external-client role
 * (`ROLE_MATRIX_EXTERNAL_CLIENT` or `ROLE_MASTODON_EXTERNAL_CLIENT`); the BFF
 * gates its entire surface on that role AND forces `owner = JWT subject`.
 *
 * The {@link ConnectedAppsComponent} mirrors the role gate with disable + helptext
 * (it checks {@link SessionService.hasExternalClientRole} and skips the fetch when
 * the role is absent) so the UI never calls and receives a 403.
 *
 * Backed by a {@link BehaviorSubject} so {@link ConnectedAppsComponent} can
 * subscribe to {@link clients$} and receive fresh data after each revocation.
 *
 * <p><b>ng-openapi-gen migration:</b> this service now DELEGATES to the generated,
 * typed {@link GenConnectedClientsService} (under {@code src/app/api}, generated
 * from the user-bff-api OpenAPI spec) instead of hand-rolling {@code HttpClient}
 * URLs — following the {@link UserProfileService} reference migration. The
 * generated client calls the SAME same-origin {@code /bff/user/**} paths (its
 * {@code rootUrl} defaults to '') through {@code HttpClient}, so the wire
 * behaviour — and the auth interceptor that attaches the HttpOnly `bff_` session
 * cookie — are unchanged. This service keeps its OWN public
 * {@link ConnectedClient} type so {@link ConnectedAppsComponent} needs no change;
 * the generated model is bridged at the delegation boundary.
 *
 * Endpoints (user-bff-api `ConnectedClientsController`):
 * - `GET    /bff/user/connected-clients`      → {@link list}   → `GenConnectedClientsService.mine1()`
 * - `DELETE /bff/user/connected-clients/{id}` → {@link revoke} → `revoke({id})`
 *
 * @see {@link ConnectedAppsComponent} — the primary consumer of this service.
 */
@Injectable({ providedIn: 'root' })
export class ConnectedClientsService {
  private readonly clientsApi = inject(GenConnectedClientsService);

  private readonly clientsSubject = new BehaviorSubject<ConnectedClient[]>([]);

  /**
   * Observable stream of the caller's own connected clients. Emits the latest
   * list whenever {@link list} is called.
   */
  readonly clients$: Observable<ConnectedClient[]> = this.clientsSubject.asObservable();

  /**
   * Fetch the caller's own connected apps and device sessions from the BFF and
   * push the result onto {@link clients$}. A `null` or absent response body
   * (empty 204) is coerced to `[]` so callers always receive an array.
   *
   * @returns An Observable that emits the client list (empty array when none exist).
   */
  list(): Observable<ConnectedClient[]> {
    return from(this.clientsApi.mine1()).pipe(
      // Coerce null (e.g. 204 no-content) to an empty array.
      map((clients) => (clients ?? []) as unknown as ConnectedClient[]),
      // Push the normalised list into the BehaviorSubject so any open subscriber
      // receives the update without needing to call list() themselves.
      tap((clients) => this.clientsSubject.next(clients)),
    );
  }

  /**
   * Revoke one of the caller's own connected clients by its server-assigned id.
   * The BFF performs: gateway revocation key deletion + best-effort homeserver
   * DELETE + an audit stamp. The caller must refresh the list after this resolves.
   *
   * @param id The `ConnectedClient.id` to revoke.
   * @returns An Observable that emits the BFF's revocation-result envelope.
   */
  revoke(id: string): Observable<Record<string, unknown>> {
    return from(this.clientsApi.revoke({ id })).pipe(
      map((result) => result as Record<string, unknown>),
    );
  }
}

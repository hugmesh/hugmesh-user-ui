import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, from } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { SessionsService as GenSessionsService } from './api/services/sessions.service';

/**
 * One ACTIVE LOGIN SESSION belonging to the caller, matched field-for-field to the
 * user-bff-api session DTO (itself a projection of the opaque {@code bff_session}
 * row owned by admin-bff: token id, account, created/expires timestamps). The
 * {@code id} is the opaque session token id; {@code account} is server-set
 * (= JWT subject) and never sent from the client, so a user only ever
 * sees/revokes THEIR OWN sessions.
 */
export interface UserSession {
  id: string;
  account?: string;
  createdAt?: string | null;
  expiresAt?: string | null;
  current?: boolean;
}

/**
 * Datastore service for the caller's OWN active login sessions. RxJS
 * {@link BehaviorSubject}-backed so the sessions view subscribes to
 * {@link sessions$}. Same-origin to {@code /bff/user/sessions}; the BFF derives the
 * owning account SERVER-SIDE from the validated JWT principal (never a request
 * param) and, on revoke, validates the target session belongs to the caller before
 * deleting — so a user can only ever list/revoke their own sessions.
 *
 * <p><b>ng-openapi-gen migration:</b> this service now DELEGATES to the generated,
 * typed {@link GenSessionsService} (under {@code src/app/api}, generated from the
 * user-bff-api OpenAPI spec) instead of hand-rolling {@code HttpClient} URLs —
 * following the {@link UserProfileService} reference migration. The generated
 * client calls the SAME same-origin {@code /bff/user/**} paths (its
 * {@code rootUrl} defaults to '') through {@code HttpClient}, so the wire
 * behaviour — and the auth interceptor that attaches the HttpOnly `bff_` session
 * cookie — are unchanged.
 *
 * Endpoints (user-bff-api SessionsController):
 *   GET    /bff/user/sessions       → list()      → GenSessionsService.listSessions()
 *   DELETE /bff/user/sessions/{id}  → revoke(id)  → revokeSession({id})
 */
@Injectable({ providedIn: 'root' })
export class SessionsService {
  private readonly sessionsApi = inject(GenSessionsService);

  private readonly sessionsSubject = new BehaviorSubject<UserSession[]>([]);
  /** The caller's own active login sessions (latest list loaded). */
  readonly sessions$: Observable<UserSession[]> = this.sessionsSubject.asObservable();

  /** List my active login sessions and push onto {@link sessions$}. A null/absent
   *  body is coerced to an empty array (both in the emitted value and the subject)
   *  so callers always get an array. */
  list(): Observable<UserSession[]> {
    return from(this.sessionsApi.listSessions()).pipe(
      map((sessions) => (sessions ?? []) as unknown as UserSession[]),
      tap((sessions) => this.sessionsSubject.next(sessions)),
    );
  }

  /** Revoke one of my login sessions by id. The BFF validates server-side that the
   *  target session belongs to the caller (JWT subject) before deleting the
   *  {@code bff_session} row. */
  revoke(id: string): Observable<Record<string, unknown>> {
    return from(this.sessionsApi.revokeSession({ id })).pipe(
      map((result) => result as Record<string, unknown>),
    );
  }
}

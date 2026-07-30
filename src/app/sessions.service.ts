import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';

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
 * Endpoints (user-bff-api SessionsController):
 *   GET    /bff/user/sessions       → list()
 *   DELETE /bff/user/sessions/{id}  → revoke(id)
 */
@Injectable({ providedIn: 'root' })
export class SessionsService {
  private readonly http = inject(HttpClient);
  private readonly base = '/bff/user/sessions';

  private readonly sessionsSubject = new BehaviorSubject<UserSession[]>([]);
  /** The caller's own active login sessions (latest list loaded). */
  readonly sessions$: Observable<UserSession[]> = this.sessionsSubject.asObservable();

  /** List my active login sessions and push onto {@link sessions$}. A null/absent
   *  body is coerced to an empty array (both in the emitted value and the subject)
   *  so callers always get an array. */
  list(): Observable<UserSession[]> {
    return this.http.get<UserSession[] | null>(this.base).pipe(
      map((sessions) => sessions ?? []),
      tap((sessions) => this.sessionsSubject.next(sessions)),
    );
  }

  /** Revoke one of my login sessions by id. The BFF validates server-side that the
   *  target session belongs to the caller (JWT subject) before deleting the
   *  {@code bff_session} row. */
  revoke(id: string): Observable<Record<string, unknown>> {
    return this.http.delete<Record<string, unknown>>(`${this.base}/${encodeURIComponent(id)}`);
  }
}

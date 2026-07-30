import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { NotificationCategory } from './notifications.service';

/**
 * One notification preference row from the BFF. The 'account-restriction' category
 * is always enabled (forced-on); the BFF ignores `enabled: false` for it. The other
 * three categories can be toggled by the user.
 */
export interface NotificationPreference {
  /** Which notification category this preference controls. */
  category: NotificationCategory;
  /** Whether the user has opted in to notifications for this category. */
  enabled: boolean;
}

/**
 * Datastore service for the caller's notification channel preferences.
 * ROLE_USER only — the BFF forces `owner = JWT subject`.
 *
 * Backed by a {@link BehaviorSubject} so {@link NotificationPreferencesComponent}
 * can subscribe to {@link prefs$} and receive the updated list after each write
 * without an additional fetch.
 *
 * Endpoints (user-bff-api `NotificationPreferencesController`):
 * - `GET /bff/user/notification-preferences` → all four category preferences
 * - `PUT /bff/user/notification-preferences` → `{ category, enabled }` upsert
 *
 * @see {@link NotificationPreferencesComponent} — primary consumer of this service.
 */
@Injectable({ providedIn: 'root' })
export class NotificationPreferencesService {
  private readonly http = inject(HttpClient);
  private readonly base = '/bff/user/notification-preferences';

  private readonly prefsSubject = new BehaviorSubject<NotificationPreference[] | null>(null);

  /**
   * Observable stream of the caller's notification preferences. Emits `null` until
   * {@link load} first succeeds; subsequently emits the latest list after each
   * {@link load} or {@link set} call.
   */
  readonly prefs$: Observable<NotificationPreference[] | null> =
    this.prefsSubject.asObservable();

  /**
   * Fetch all four notification category preferences from the BFF.
   *
   * @returns An Observable that emits the full {@link NotificationPreference} array.
   */
  load(): Observable<NotificationPreference[]> {
    return this.http
      .get<NotificationPreference[]>(this.base)
      // Push the loaded list so any open subscriber on prefs$ updates.
      .pipe(tap((prefs) => this.prefsSubject.next(prefs)));
  }

  /**
   * Upsert a single notification preference. Returns the updated preference row.
   * Note: 'account-restriction' is forced-on; the BFF ignores `enabled: false` for it.
   *
   * Updates the cached BehaviorSubject with the server's response once the PUT
   * resolves (this service does not itself write an optimistic value before the
   * request completes; see {@link NotificationPreferencesComponent.onToggle} for
   * the component-level optimistic update + revert-on-failure logic).
   *
   * @param category The notification category to update.
   * @param enabled  Whether to opt in to notifications for that category.
   * @returns An Observable that emits the updated {@link NotificationPreference}.
   */
  set(
    category: NotificationCategory,
    enabled: boolean,
  ): Observable<NotificationPreference> {
    return this.http
      .put<NotificationPreference>(this.base, { category, enabled })
      .pipe(
        // Replace the matching entry in the cached list with the server's response.
        tap((updated) => {
          const current = this.prefsSubject.value ?? [];
          this.prefsSubject.next(
            current.map((p) => (p.category === updated.category ? updated : p)),
          );
        }),
      );
  }
}

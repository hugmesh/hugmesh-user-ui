import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, from } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { NotificationPreferencesService as GeneratedNotificationPreferencesApi } from './api/services/notification-preferences.service';
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
 * Endpoints (user-bff-api `NotificationPreferenceController`):
 * - `GET /bff/user/notification-preferences` → `{ [category]: enabled }` map → generated `get1()`
 * - `PUT /bff/user/notification-preferences` → `{ category, enabled }` upsert (schema
 *   `NotificationPreferenceUpsert`) → returns the resolved map → generated `put1()`
 *
 * <p><b>ng-openapi-gen migration:</b> delegates to the generated, typed
 * {@link GeneratedNotificationPreferencesApi} (under `src/app/api`) instead of hand-rolling
 * `HttpClient`. This was blocked until user-bff-api gave its two nested `PreferenceUpsert`
 * records distinct schema names (before that the spec typed this PUT's body as `{key, value}`).
 *
 * <p>The BFF returns a `Map<String, Boolean>` for both calls, NOT a list of rows. This
 * service converts that map into the {@link NotificationPreference} rows its consumers use, so
 * {@link prefs$} keeps its shape.
 *
 * @see {@link NotificationPreferencesComponent} — primary consumer of this service.
 */
@Injectable({ providedIn: 'root' })
export class NotificationPreferencesService {
  private readonly api = inject(GeneratedNotificationPreferencesApi);

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
    return from(this.api.get1()).pipe(
      map(toRows),
      // Push the loaded list so any open subscriber on prefs$ updates.
      tap((prefs) => this.prefsSubject.next(prefs)),
    );
  }

  /**
   * Upsert a single notification preference. Returns the resolved row for `category`.
   * Note: 'account-restriction' is forced-on; the BFF ignores `enabled: false` for it.
   *
   * Updates the cached BehaviorSubject with the server's resolved view once the PUT
   * resolves (this service does not itself write an optimistic value before the
   * request completes; see {@link NotificationPreferencesComponent.onToggle} for
   * the component-level optimistic update + revert-on-failure logic).
   *
   * @param category The notification category to update.
   * @param enabled  Whether to opt in to notifications for that category.
   * @returns An Observable that emits the resolved {@link NotificationPreference}.
   */
  set(
    category: NotificationCategory,
    enabled: boolean,
  ): Observable<NotificationPreference> {
    return from(this.api.put1({ body: { category, enabled } })).pipe(
      map((view) => {
        const rows = toRows(view);
        this.prefsSubject.next(rows);
        // The BFF echoes the whole resolved view; a view missing the row we just wrote
        // would be a contract break, so fail rather than invent a value.
        const row = rows.find((r) => r.category === category);
        if (!row) {
          throw new Error(`notification-preferences PUT response has no '${category}' entry`);
        }
        return row;
      }),
    );
  }
}

/** Convert the BFF's `{ [category]: enabled }` view into rows. */
function toRows(view: { [key: string]: boolean }): NotificationPreference[] {
  return Object.entries(view).map(([category, enabled]) => ({
    category: category as NotificationCategory,
    enabled,
  }));
}

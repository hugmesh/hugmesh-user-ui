import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, from } from 'rxjs';
import { tap } from 'rxjs/operators';
import { UserPreferencesService } from './api/services/user-preferences.service';
import { MediaPoisonMode as GenMediaPoisonMode } from './api/models/media-poison-mode';
import { MEDIA_POISON_MODE } from './api/models/media-poison-mode-array';

/**
 * Preference key for the user's default AI-poison (media cloak) mode.
 * Corresponds to `media_poison_default` in the `user_preferences` table on the
 * BFF. The server merges a system default when this key is unset, so the GET
 * response always carries a value after the first load.
 */
export const PREF_MEDIA_POISON_DEFAULT = 'media.poison.default';

/**
 * Valid intensity levels for the AI-poison (media cloak) media pre-processing
 * pipeline.
 *
 * This is a RE-EXPORT of the generated {@link GenMediaPoisonMode}, which comes
 * from the user-bff-api `MediaPoisonMode` OpenAPI schema — the BFF owns this
 * vocabulary and is the source of truth for UI clients. It was previously a
 * second, hand-maintained copy of the same union, which could silently drift
 * from the server the moment the BFF added or renamed a level; re-exporting
 * makes any future vocabulary change arrive through `npm run gen:spec` and fail
 * the build here instead of shipping a select whose options the BFF rejects.
 *
 * The levels (per the schema description) are:
 * - `'off'`    — no AI-cloaking applied by default.
 * - `'low'`    — subtle adversarial noise (minimal visible change).
 * - `'medium'` — moderate noise (recommended default).
 * - `'high'`   — aggressive noise (may be perceptible on close inspection).
 *
 * Server-side these map onto the engine cloak modes `none|light|glaze|nightshade`.
 */
export type MediaPoisonMode = GenMediaPoisonMode;

/**
 * Every {@link MediaPoisonMode} value, in the schema's declared order — the list
 * the preferences `<select>` renders its options from.
 *
 * Also a re-export of generated code (`MEDIA_POISON_MODE`, which ng-openapi-gen
 * emits for any enum schema), NOT a hand-kept copy. Combined with
 * {@link PreferencesComponent}'s exhaustive `Record<MediaPoisonMode, string>`
 * label map, a level added on the BFF arrives through `npm run gen:spec` and
 * then FAILS THE BUILD here until a label is written for it — the option can
 * never be silently missing from the UI.
 */
export const MEDIA_POISON_MODES: readonly MediaPoisonMode[] = MEDIA_POISON_MODE;

/**
 * The full resolved preferences map returned by `GET /bff/user/preferences`.
 * Keys are dot-separated preference identifiers (e.g. `'media.poison.default'`);
 * values are their string representations. Server defaults are merged in for any
 * key the user has not explicitly set, so every known key is present.
 */
export type PreferencesMap = Record<string, string>;

/**
 * Datastore service for the caller's OWN durable UI preferences. ROLE_USER only;
 * the BFF enforces `owner = JWT subject` so a user can only read and write THEIR
 * OWN preferences.
 *
 * Backed by a {@link BehaviorSubject} so {@link PreferencesComponent} can
 * subscribe to {@link prefs$} and receive the updated map after each write
 * without an additional fetch.
 *
 * <p><b>ng-openapi-gen migration:</b> this service now DELEGATES to the generated,
 * typed {@link UserPreferencesService} (under {@code src/app/api}, generated from
 * the user-bff-api OpenAPI spec) instead of hand-rolling {@code HttpClient} URLs —
 * following the {@link UserProfileService} reference migration. The generated
 * client calls the SAME same-origin {@code /bff/user/**} paths (its
 * {@code rootUrl} defaults to '') through {@code HttpClient}, so the wire
 * behaviour is unchanged.
 *
 * Endpoints (user-bff-api `UserPreferencesController`):
 * - `GET /bff/user/preferences` → full resolved map (server defaults merged in) → `UserPreferencesService.get()`
 * - `PUT /bff/user/preferences` → `{ key, value }` upsert → returns updated map → `put({body})`
 *
 * The owner is ALWAYS the JWT subject (server-enforced); a user can only ever
 * read/write THEIR OWN preferences. The generated client is built on HttpClient,
 * so the auth interceptor still sends the HttpOnly `bff_` session cookie
 * automatically.
 *
 * @see {@link PreferencesComponent} — the primary consumer of this service.
 * @see {@link PREF_MEDIA_POISON_DEFAULT} — the only preference key currently surfaced in the UI.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly prefsApi = inject(UserPreferencesService);

  private readonly prefsSubject = new BehaviorSubject<PreferencesMap | null>(null);

  /**
   * Observable stream of the caller's resolved preferences. Emits `null` until
   * {@link load} first succeeds; subsequently emits the latest map after each
   * {@link load} or {@link set} call.
   */
  readonly prefs$: Observable<PreferencesMap | null> = this.prefsSubject.asObservable();

  /**
   * Fetch the caller's full resolved preferences from the BFF (server defaults
   * are merged in for any key the user has not explicitly set). Pushes the result
   * onto {@link prefs$}.
   *
   * @returns An Observable that emits the full {@link PreferencesMap}.
   */
  load(): Observable<PreferencesMap> {
    return from(this.prefsApi.get()).pipe(
      // Push the loaded map so any open subscriber on prefs$ updates.
      tap((p) => this.prefsSubject.next(p)),
    );
  }

  /**
   * Upsert a single preference key-value pair. The BFF writes the value to the
   * `user_preferences` table and returns the updated resolved map (with defaults
   * merged for all other keys). Pushes the result onto {@link prefs$}.
   *
   * @param key   The dot-separated preference key (e.g. `'media.poison.default'`).
   * @param value The string value to store.
   * @returns An Observable that emits the updated full {@link PreferencesMap}.
   */
  set(key: string, value: string): Observable<PreferencesMap> {
    return from(this.prefsApi.put({ body: { key, value } })).pipe(
      // Push the updated map so the component reflects any server-side normalisation.
      tap((p) => this.prefsSubject.next(p)),
    );
  }
}

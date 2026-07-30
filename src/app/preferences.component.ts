import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import {
  MEDIA_POISON_MODES,
  MediaPoisonMode,
  PREF_MEDIA_POISON_DEFAULT,
  PreferencesService,
} from './preferences.service';

/** Human-readable labels for each AI-poison mode, displayed in the select element.
 *
 *  `Record<MediaPoisonMode, …>` is deliberately exhaustive: `MediaPoisonMode` is
 *  re-exported from the generated BFF `MediaPoisonMode` schema, so if the BFF
 *  adds an intensity level this map stops compiling until a label is written for
 *  it — the vocabulary cannot drift out of the UI silently. */
const POISON_LABELS: Record<MediaPoisonMode, string> = {
  off: 'Off — never apply AI-cloak by default',
  low: 'Low — subtle noise, minimal visible change',
  medium: 'Medium — moderate noise (recommended)',
  high: 'High — aggressive noise, perceptible on close inspection',
};

/**
 * User preferences page — exposes durable per-user settings backed by
 * `GET/PUT /bff/user/preferences`. ROLE_USER only.
 *
 * Currently surfaces the `media.poison.default` preference: the user's personal
 * default AI-poison (media cloak) intensity that compose surfaces pre-select
 * when uploading media. The server merges a system default when the preference is
 * unset, so the select always reflects an explicit value after the first load.
 *
 * Changes are saved IMMEDIATELY on `<select>` change (`(change)` binding) so
 * there is no separate Save button — the `busy` flag disables the select during
 * the in-flight PUT to prevent double-writes.
 *
 * a11y:
 * - A `<fieldset>/<legend>` groups the AI-poison section so a screen reader
 *   announces the group heading before the select option.
 * - The `<select>` has an associated `<label>` and `aria-describedby` pointing
 *   at a persistent helptext paragraph explaining the modes.
 * - Status messages (saved / error) are surfaced via `role="status"` so they are
 *   announced in a polite live region without moving focus.
 * - The select is `[disabled]` while a save is in-flight (`busy`).
 *
 * @see {@link PreferencesService} — HTTP layer: `GET/PUT /bff/user/preferences`.
 */
@Component({
  selector: 'hug-user-preferences',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './preferences.component.html',
  styleUrl: './preferences.component.scss',
})
export class PreferencesComponent implements OnInit {
  private readonly service = inject(PreferencesService);

  /** The ordered list of poison-mode options surfaced to the template's `<select>`.
   *  Sourced from {@link MEDIA_POISON_MODES} (which tracks the generated BFF
   *  vocabulary) rather than a third hand-written copy of the same four values. */
  readonly poisonModes: readonly MediaPoisonMode[] = MEDIA_POISON_MODES;
  /** Human-readable option labels keyed by mode value. */
  readonly poisonLabels = POISON_LABELS;

  /** The user's currently effective `media.poison.default` value (`null` while loading). */
  readonly poisonMode = signal<MediaPoisonMode | null>(null);

  /** `true` while a PUT `/bff/user/preferences` is in-flight (disables the select). */
  readonly busy = signal(false);
  /** Status message announced politely after a save attempt. */
  readonly statusMessage = signal('');
  /**
   * Whether {@link statusMessage} currently holds a FAILURE message, so the
   * template can tone the visible status line with `.hug-error` instead of the
   * shared success colour. Written only via {@link setStatus} /
   * {@link setStatusError}, which keeps it from going stale.
   */
  readonly statusIsError = signal(false);
  /** Non-empty when the initial preferences load fails. */
  readonly loadError = signal('');

  /** Load the caller's preferences on init and populate the select's default value. */
  async ngOnInit(): Promise<void> {
    try {
      const prefs = await firstValueFrom(this.service.load());
      // Extract the specific key we care about; fall back to 'off' for unknown values.
      const v = prefs[PREF_MEDIA_POISON_DEFAULT];
      this.poisonMode.set(this.asMode(v));
    } catch {
      this.loadError.set('Could not load your preferences — please try again.');
    }
  }

  /**
   * `(change)` handler for the AI-poison mode select. Immediately saves the new
   * value to the BFF; the select is disabled while the PUT is in-flight.
   *
   * @param event The native DOM `change` event from the `<select>` element.
   */
  async onPoisonChange(event: Event): Promise<void> {
    const value = (event.target as HTMLSelectElement).value as MediaPoisonMode;
    // Optimistically update the local signal so the select reflects the new value
    // immediately, even before the server confirms. Unlike the near-identical
    // NotificationPreferencesComponent.onToggle, this optimistic value is not
    // reverted on failure below — the error statusMessage is surfaced instead,
    // and the select (a single persistent value) is left showing the attempted
    // choice rather than snapping back to the last-confirmed one.
    this.poisonMode.set(value);
    this.setStatus('');
    this.busy.set(true);
    try {
      await firstValueFrom(this.service.set(PREF_MEDIA_POISON_DEFAULT, value));
      this.setStatus('Preference saved.');
    } catch {
      this.setStatusError('Could not save your preference — please try again.');
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Narrow an arbitrary string from the preferences map to a valid
   * {@link MediaPoisonMode}, defaulting to `'off'` for unknown or absent values.
   *
   * @param v The raw string value from the preferences map.
   * @returns A valid {@link MediaPoisonMode}.
   */
  private asMode(v: string | undefined): MediaPoisonMode {
    // Membership-tested against the shared vocabulary rather than a hand-written
    // `v === 'low' || …` chain, so a level added on the BFF is accepted here as
    // soon as `npm run gen:spec` runs — it no longer silently degrades to 'off'.
    return MEDIA_POISON_MODES.includes(v as MediaPoisonMode) ? (v as MediaPoisonMode) : 'off';
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

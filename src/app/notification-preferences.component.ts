import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import {
  NotificationPreference,
  NotificationPreferencesService,
} from './notification-preferences.service';
import type { NotificationCategory } from './notifications.service';

/** Human-readable label for each notification category. */
const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  'account-restriction': 'Account restrictions',
  'role-change': 'Role changes',
  'infra-impacting': 'Infrastructure changes',
  'feature-availability': 'Feature availability',
};

/** One-line description shown below each category label. */
const CATEGORY_HELP: Record<NotificationCategory, string> = {
  'account-restriction':
    'Suspension, bans, and other actions that affect your account status. Always on.',
  'role-change': 'When your role or permissions change (e.g. promoted to moderator).',
  'infra-impacting':
    'Scheduled maintenance, outages, or changes that affect the platform you use.',
  'feature-availability': 'New features or services that become available on your domain.',
};

/**
 * Notification preferences page — four category toggles backed by
 * `GET/PUT /bff/user/notification-preferences`. ROLE_USER only.
 *
 * The 'account-restriction' category is always enabled (forced by the BFF); it
 * is rendered with its checkbox checked and `disabled` so users understand the
 * setting is mandatory rather than simply not finding a way to change it.
 *
 * Changes are saved IMMEDIATELY on checkbox change — no separate Save button.
 * The `busy` flag disables all toggles while a PUT is in-flight to prevent
 * double-writes. A failed save reverts the optimistic update.
 *
 * a11y:
 * - Each checkbox has an associated `<label>` and `aria-describedby` pointing at
 *   a helptext element explaining the category.
 * - Saved/error status surfaces via `role="status"` polite live region.
 * - The forced-on category's checkbox is natively `disabled` so a screen reader
 *   announces it as unavailable, with the "(always on)" label suffix.
 *
 * @see {@link NotificationPreferencesService} — HTTP layer: GET/PUT /bff/user/notification-preferences.
 */
@Component({
  selector: 'hug-user-notification-preferences',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notification-preferences.component.html',
  styleUrl: './notification-preferences.component.scss',
})
export class NotificationPreferencesComponent implements OnInit {
  private readonly service = inject(NotificationPreferencesService);

  /** Ordered list of categories to display; account-restriction first (forced-on). */
  readonly categories: NotificationCategory[] = [
    'account-restriction',
    'role-change',
    'infra-impacting',
    'feature-availability',
  ];

  readonly categoryLabels = CATEGORY_LABELS;
  readonly categoryHelp = CATEGORY_HELP;

  /** The loaded preferences list (null until the first load completes). */
  readonly prefs = signal<NotificationPreference[] | null>(null);
  /** True while a PUT is in-flight — disables all toggles to prevent double-writes. */
  readonly busy = signal(false);
  /** Status message announced after save attempts. */
  readonly statusMessage = signal('');
  /**
   * Whether {@link statusMessage} currently holds a FAILURE message, so the
   * template can tone the visible status line with `.hug-error` instead of the
   * shared success colour. Written only via {@link setStatus} /
   * {@link setStatusError}, which keeps it from going stale.
   */
  readonly statusIsError = signal(false);
  /** Non-empty when the initial load fails. */
  readonly loadError = signal('');

  /** Load the caller's notification preferences on init. */
  async ngOnInit(): Promise<void> {
    try {
      this.prefs.set(await firstValueFrom(this.service.load()));
    } catch {
      this.loadError.set(
        'Could not load your notification preferences — please try again.',
      );
    }
  }

  /**
   * Return the current enabled state for a category, defaulting to `true` while
   * loading (so toggles appear on rather than showing a misleading all-off state).
   *
   * @param category The category to query.
   */
  isEnabled(category: NotificationCategory): boolean {
    if (category === 'account-restriction') {
      return true; // Always on; forced by the BFF regardless of any stored value.
    }
    return this.prefs()?.find((p) => p.category === category)?.enabled ?? true;
  }

  /**
   * Whether a toggle should be rendered disabled (not interactive).
   * account-restriction is always disabled (forced-on); all others are also
   * disabled while a save is in-flight or before the first load completes.
   *
   * @param category The category to check.
   */
  isDisabled(category: NotificationCategory): boolean {
    return category === 'account-restriction' || this.busy() || this.prefs() === null;
  }

  /**
   * `(change)` handler for an optional category's checkbox. Immediately saves the
   * new value; reverts the optimistic update if the PUT fails.
   *
   * @param category The notification category being toggled.
   * @param event    The native DOM `change` event from the `<input type="checkbox">`.
   */
  async onToggle(category: NotificationCategory, event: Event): Promise<void> {
    if (category === 'account-restriction') {
      return; // Never toggle the forced-on category.
    }
    const enabled = (event.target as HTMLInputElement).checked;
    // Optimistically update local state so the checkbox reflects the new value
    // immediately, even before the server confirms.
    this.prefs.update((ps) =>
      (ps ?? []).map((p) => (p.category === category ? { ...p, enabled } : p)),
    );
    this.setStatus('');
    this.busy.set(true);
    try {
      await firstValueFrom(this.service.set(category, enabled));
      this.setStatus('Preference saved.');
    } catch {
      // Revert the optimistic update so the UI stays consistent with the server.
      this.prefs.update((ps) =>
        (ps ?? []).map((p) => (p.category === category ? { ...p, enabled: !enabled } : p)),
      );
      this.setStatusError('Could not save your preference — please try again.');
    } finally {
      this.busy.set(false);
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

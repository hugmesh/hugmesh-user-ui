import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, firstValueFrom } from 'rxjs';
import { NotificationsService, SseLiveStatus, UserNotification } from './notifications.service';

/**
 * In-app notification inbox — displays a newest-first list of the caller's
 * notifications and lets them mark individual items as read. ROLE_USER only;
 * the BFF forces `owner = JWT subject` so a user only ever sees THEIR OWN
 * notifications.
 *
 * The `notifications` signal tracks {@link NotificationsService.notifications$}
 * directly, so the initial load, `markRead`'s optimistic update, AND real-time
 * SSE pushes (once {@link NotificationsService.startLive} is running) all flow
 * through the same single source of truth — no separate local mutation to keep
 * in sync.
 *
 * a11y:
 * - Heading announces the unread count via `aria-label` on the badge span.
 * - Mark-as-read buttons carry per-item `aria-label`s ("<title>").
 * - Status and error outcomes surface in `role="status"` / `role="alert"` regions.
 * - The notification list is a `<ul>` so screen readers announce item count.
 * - A `role="status"` banner discloses `degraded` live-status honestly (see
 *   {@link NotificationsService.liveStatus$}) rather than silently showing a
 *   list that has quietly stopped updating.
 *
 * @see {@link NotificationsService} — HTTP + SSE layer.
 */
@Component({
  selector: 'hug-user-notifications',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notifications.component.html',
  styleUrl: './notifications.component.scss',
})
export class NotificationsComponent implements OnInit, OnDestroy {
  private readonly service = inject(NotificationsService);
  private notificationsSub?: Subscription;
  private liveStatusSub?: Subscription;

  /** The caller's notification list (empty until loaded). */
  readonly notifications = signal<UserNotification[]>([]);
  /** True while the initial list fetch is in-flight. */
  readonly loading = signal(true);
  /** Non-empty when the initial list load fails. */
  readonly loadError = signal('');
  /** Status message announced politely after mark-as-read or error. */
  readonly statusMessage = signal('');
  /**
   * Whether {@link statusMessage} currently holds a FAILURE message, so the
   * template can tone the visible status line with `.hug-error` instead of the
   * shared success colour. Written only via {@link setStatus} /
   * {@link setStatusError}, which keeps it from going stale.
   */
  readonly statusIsError = signal(false);
  /** Real-time SSE connection status — see {@link SseLiveStatus}. Drives an
   *  honest "not live right now" banner when `degraded`. */
  readonly liveStatus = signal<SseLiveStatus>('idle');

  /** Number of unread notifications in the current list; drives the heading badge. */
  get unreadCount(): number {
    return this.notifications().filter((n) => this.isUnread(n)).length;
  }

  /** Load the caller's notifications on init, then start the real-time SSE
   *  subscription so later grants/revokes/etc. arrive without a manual reload. */
  async ngOnInit(): Promise<void> {
    this.notificationsSub = this.service.notifications$.subscribe((ns) =>
      this.notifications.set(ns),
    );
    this.liveStatusSub = this.service.liveStatus$.subscribe((s) => this.liveStatus.set(s));
    try {
      await firstValueFrom(this.service.list());
    } catch {
      this.loadError.set('Could not load your notifications — please try again.');
    } finally {
      this.loading.set(false);
    }
    this.service.startLive();
  }

  /** Tear down the SSE subscription and RxJS subscriptions — this service is
   *  `providedIn: 'root'` and would otherwise keep streaming after navigation
   *  away from this page. */
  ngOnDestroy(): void {
    this.notificationsSub?.unsubscribe();
    this.liveStatusSub?.unsubscribe();
    this.service.stopLive();
  }

  /**
   * Whether a notification is unread (`readAt` is absent or null).
   *
   * @param n The notification to check.
   */
  isUnread(n: UserNotification): boolean {
    return !n.readAt;
  }

  /**
   * Mark a notification as read. Skips the call if `readAt` is already set (the
   * BFF is idempotent, but we avoid the round-trip). On success, the `notifications`
   * signal updates itself via the {@link notificationsSub} subscription — the
   * service's own `tap()` stamps `readAt` on its BehaviorSubject, which this
   * component (and `unreadCount$` elsewhere) picks up automatically.
   *
   * @param notification The notification to mark read.
   */
  async markRead(notification: UserNotification): Promise<void> {
    if (!this.isUnread(notification)) {
      return; // Already read — skip the call (idempotent on the BFF, but no need).
    }
    try {
      await firstValueFrom(this.service.markRead(notification.id));
      this.setStatus('Notification marked as read.');
    } catch {
      this.setStatusError('Could not mark notification as read — please try again.');
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

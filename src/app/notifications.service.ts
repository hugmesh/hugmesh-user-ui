import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, from } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { NotificationsInAppFloorService } from './api/services/notifications-in-app-floor.service';

/** Notification category identifiers; mirrors the user-bff NotificationCategory enum. */
export type NotificationCategory =
  | 'account-restriction'
  | 'role-change'
  | 'infra-impacting'
  | 'feature-availability';

/**
 * Real-time SSE connection status for {@link NotificationsService.liveStatus$}:
 * - `idle` — {@link NotificationsService.startLive} has not been called (or
 *   {@link NotificationsService.stopLive} was).
 * - `connecting` — a connection attempt (initial or reconnect) is in flight.
 * - `live` — the stream is open; new notifications arrive in real time.
 * - `degraded` — the last attempt failed (network error, non-2xx, or an
 *   idle-timeout close); the caller keeps retrying, but is honestly NOT live
 *   right now — the polled {@link NotificationsService.list} snapshot may be
 *   stale until reconnection succeeds. Consumers MUST surface this rather
 *   than silently pretending the feed is current.
 */
export type SseLiveStatus = 'idle' | 'connecting' | 'live' | 'degraded';

/**
 * Wire shape of one event on the `/bff/user/notifications/events` SSE stream —
 * mirrors user-bff-api's `SseNotificationEvent` record field-for-field.
 * Deliberately narrower than {@link UserNotification}: the event carries no
 * `createdAt` / `readAt` (the client stamps its own arrival time — see
 * {@link NotificationsService}'s stream handling).
 */
export interface SseNotificationEvent {
  id: string;
  category: NotificationCategory;
  title: string;
  body?: string | null;
}

/**
 * Parse one raw SSE wire line into a `{name, value}` field per the SSE spec:
 * split on the FIRST colon, and strip AT MOST ONE leading space from the
 * value (the spec-mandated allowance — a compliant writer may or may not
 * include it). Returns `null` for a blank line (event terminator), a
 * comment line (starts with `:`), or a line with no colon at all.
 *
 * Deliberately NOT an exact-prefix match like `line.startsWith('data: ')` —
 * Spring WebFlux's `ServerSentEventHttpMessageWriter` writes `data:` with NO
 * space before the payload, so an exact `"data: "` check would silently
 * match zero real events from this platform's SSE endpoints.
 */
export function parseSseField(line: string): { name: string; value: string } | null {
  if (line === '' || line.startsWith(':')) return null;
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const name = line.slice(0, colon);
  let value = line.slice(colon + 1);
  if (value.startsWith(' ')) value = value.slice(1);
  return { name, value };
}

/**
 * A single in-app notification belonging to the caller. Mirrors the user-bff-api
 * `UserNotification` record field-for-field. The `readAt` field is null when the
 * notification is unread; non-null once the caller marks it read.
 *
 * `userSubject` is server-set (= JWT subject) and never sent from the client, so
 * a user can only ever see THEIR OWN notifications.
 */
export interface UserNotification {
  /** Server-assigned identifier used as the mark-as-read key. */
  id: string;
  /** Owning user's Casdoor subject (server-set; never written from the client). */
  userSubject?: string;
  /** The notification category — determines whether it can be muted. */
  category: NotificationCategory;
  /** Short notification title. */
  title: string;
  /** Full notification body text. */
  body: string;
  /** ISO 8601 timestamp when the notification was created. */
  createdAt: string;
  /** ISO 8601 timestamp when the notification was marked read, or null when unread. */
  readAt?: string | null;
}

/**
 * Datastore service for the caller's in-app notification feed. ROLE_USER only —
 * the BFF forces `owner = JWT subject` so a user can only read and mark THEIR OWN
 * notifications.
 *
 * Backed by a {@link BehaviorSubject} so a host-shell bell component can subscribe
 * to {@link unreadCount$} and display a live badge without a separate fetch. The
 * BehaviorSubject is updated optimistically when {@link markRead} resolves, and
 * (once {@link startLive} is called) pushed to in real time by the SSE stream.
 *
 * <p><b>ng-openapi-gen migration:</b> the two plain CRUD calls now DELEGATE to
 * the generated, typed {@link NotificationsInAppFloorService} (under
 * {@code src/app/api}, generated from the user-bff-api OpenAPI spec) instead of
 * hand-rolling {@code HttpClient} URLs — following the {@link UserProfileService}
 * reference migration. The generated client calls the SAME same-origin
 * {@code /bff/user/**} paths (its {@code rootUrl} defaults to '') through
 * {@code HttpClient}, so the wire behaviour — and the auth interceptor that
 * attaches the HttpOnly `bff_` session cookie — are unchanged. The SSE stream is
 * deliberately NOT migrated: the BFF's `text/event-stream` endpoint has no
 * generated counterpart (ng-openapi-gen models no streaming response), and it
 * needs `fetch()` + `ReadableStream` anyway — see {@link consumeLiveStream}.
 *
 * Endpoints (user-bff-api `NotificationsController`):
 * - `GET  /bff/user/notifications`            → {@link list} (newest-first, optional `?limit`) → `NotificationsInAppFloorService.list({limit})`
 * - `POST /bff/user/notifications/{id}/read`  → {@link markRead} (idempotent, 204) → `markRead({id})`
 * - `GET  /bff/user/notifications/events`     → {@link startLive} (SSE, real-time push; hand-rolled `fetch`)
 *
 * **SSE auth.** Like every other `/bff/**` call, the stream authenticates via the
 * HttpOnly `bff_` session cookie (`fetch(..., { credentials: 'include' })`) — the
 * browser holds no bearer token to attach, so this deliberately does NOT use the
 * native `EventSource` API (which historically couldn't carry auth); cookie-based
 * `fetch` + `ReadableStream` line parsing mirrors the pattern already shipped in
 * hugmesh.net' host-shell `NotificationToastService`.
 *
 * **Reconnect.** The server closes the stream after a 4-minute idle keepalive;
 * a network error or non-2xx also ends the attempt. Either way {@link startLive}
 * retries after a fixed backoff ({@link NotificationsService.RECONNECT_MS}) for as
 * long as it's running, and {@link liveStatus$} reports `degraded` for the honest
 * duration a caller is NOT receiving live pushes — this service never pretends the
 * feed is live when it isn't.
 *
 * @see {@link NotificationsComponent} — primary consumer of this service.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly notificationsApi = inject(NotificationsInAppFloorService);
  // Base path for the hand-rolled SSE fetch only — see consumeLiveStream().
  private readonly base = '/bff/user/notifications';

  /** Fixed reconnect delay after a dropped/failed SSE attempt. */
  private static readonly RECONNECT_MS = 5_000;

  private readonly notificationsSubject = new BehaviorSubject<UserNotification[]>([]);
  private readonly liveStatusSubject = new BehaviorSubject<SseLiveStatus>('idle');

  private liveController: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Observable stream of the caller's notifications. Emits the latest list
   * whenever {@link list} is called, {@link markRead} resolves, or a live SSE
   * event arrives while {@link startLive} is running.
   */
  readonly notifications$: Observable<UserNotification[]> =
    this.notificationsSubject.asObservable();

  /** Observable of the SSE connection status — see {@link SseLiveStatus}. */
  readonly liveStatus$: Observable<SseLiveStatus> = this.liveStatusSubject.asObservable();

  /**
   * Observable of the unread notification count. Derived from {@link notifications$}
   * so it updates whenever the list changes — including after {@link markRead}.
   * A host-shell bell component can subscribe here without needing the full list.
   */
  readonly unreadCount$: Observable<number> = this.notifications$.pipe(
    // Count entries where readAt is absent or null.
    map((ns) => ns.filter((n) => !n.readAt).length),
  );

  /**
   * Fetch the caller's in-app notifications from the BFF. Results are newest-first.
   * A null or absent response body (e.g. 204 no-content) is coerced to `[]`.
   *
   * @param limit Optional maximum number of notifications to return.
   * @returns An Observable that emits the notification list.
   */
  list(limit?: number): Observable<UserNotification[]> {
    // The generated request builder drops an undefined query param, so an
    // absent limit still sends a bare GET /bff/user/notifications.
    return from(this.notificationsApi.list({ limit })).pipe(
      // Coerce null (e.g. 204 no-content) to an empty array.
      map((ns) => (ns ?? []) as unknown as UserNotification[]),
      // Push the normalised list so unreadCount$ updates for any open subscriber.
      tap((ns) => this.notificationsSubject.next(ns)),
    );
  }

  /**
   * Mark a notification as read. Idempotent — safe to call if already read.
   * On success, optimistically updates the BehaviorSubject so {@link unreadCount$}
   * drops immediately without a full reload.
   *
   * @param id The {@link UserNotification.id} to mark read.
   * @returns An Observable that completes when the BFF confirms the mark (204).
   */
  markRead(id: string): Observable<void> {
    return from(this.notificationsApi.markRead({ id })).pipe(
      // Optimistically stamp readAt on the cached entry so unreadCount$ drops now.
      tap(() => {
        const now = new Date().toISOString();
        const updated = this.notificationsSubject.value.map((n) =>
          n.id === id ? { ...n, readAt: now } : n,
        );
        this.notificationsSubject.next(updated);
      }),
    );
  }

  /**
   * Start (or no-op if already running) the real-time SSE subscription against
   * `GET /bff/user/notifications/events`. New events are prepended into
   * {@link notifications$} (deduped by id); {@link liveStatus$} reports the
   * honest connection state throughout. Call {@link stopLive} on component
   * teardown — this service is `providedIn: 'root'` and would otherwise keep
   * an abandoned stream open for the app's lifetime.
   */
  startLive(): void {
    if (this.liveController) return; // already running
    this.liveController = new AbortController();
    this.liveStatusSubject.next('connecting');
    void this.consumeLiveStream();
  }

  /** Stop the SSE subscription (aborts any in-flight fetch, cancels a pending
   *  reconnect) and report `idle`. Safe to call when not running. */
  stopLive(): void {
    this.liveController?.abort();
    this.liveController = null;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.liveStatusSubject.next('idle');
  }

  /**
   * One connect-and-read attempt of the SSE stream. Resolves once the stream
   * closes (server timeout, network error, or `stopLive()`); on any close
   * still wanted by the caller (`liveController` not null), schedules a
   * reconnect after {@link NotificationsService.RECONNECT_MS} rather than
   * looping immediately — never a hot retry loop.
   */
  private async consumeLiveStream(): Promise<void> {
    const controller = this.liveController;
    if (!controller) return;
    try {
      const response = await fetch(`${this.base}/events`, {
        credentials: 'include',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        this.reportDegradedAndMaybeRetry();
        return;
      }
      this.liveStatusSubject.next('live');
      await this.readEventStream(response.body);
      // Stream ended (server-side idle timeout or close) — reconnect if still wanted.
      this.reportDegradedAndMaybeRetry();
    } catch {
      // AbortError from stopLive() lands here too — only retry if we're still running.
      this.reportDegradedAndMaybeRetry();
    }
  }

  /**
   * Read SSE `field:value` lines off the stream and apply each `data` field
   * as a live event.
   *
   * Parses per the SSE spec (split on the FIRST colon; strip AT MOST ONE
   * leading space off the value) rather than requiring an exact `"data: "`
   * prefix — Spring WebFlux's `ServerSentEventHttpMessageWriter` (the writer
   * `UserNotificationController` uses) emits `data:` with **no** space before
   * the JSON payload, so a naive exact-prefix match would silently never
   * match a single live event.
   */
  private async readEventStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep the last, possibly-incomplete line
      for (const line of lines) {
        const field = parseSseField(line);
        if (field?.name !== 'data') continue;
        try {
          this.applyLiveEvent(JSON.parse(field.value) as SseNotificationEvent);
        } catch {
          // Malformed event payload — skip it, keep the stream open.
        }
      }
    }
  }

  /** Prepend a freshly-arrived SSE event as a {@link UserNotification} (unread,
   *  arrival-time stamped — the event itself carries no `createdAt`). Ignores
   *  a duplicate id (e.g. already picked up by a concurrent {@link list} call). */
  private applyLiveEvent(event: SseNotificationEvent): void {
    const current = this.notificationsSubject.value;
    if (current.some((n) => n.id === event.id)) return;
    const notification: UserNotification = {
      id: event.id,
      category: event.category,
      title: event.title,
      body: event.body ?? '',
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    this.notificationsSubject.next([notification, ...current]);
  }

  /** Report `degraded` and, if {@link startLive} is still wanted, schedule one
   *  reconnect attempt after the fixed backoff. A `stopLive()` in the meantime
   *  (liveController now null) cancels this — never fires into a stopped service. */
  private reportDegradedAndMaybeRetry(): void {
    if (!this.liveController) return; // stopLive() already ran — stay idle
    this.liveStatusSubject.next('degraded');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.liveController) return;
      this.liveStatusSubject.next('connecting');
      void this.consumeLiveStream();
    }, NotificationsService.RECONNECT_MS);
  }
}

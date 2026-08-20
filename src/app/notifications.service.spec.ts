import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  NotificationsService,
  SseLiveStatus,
  UserNotification,
  parseSseField,
} from './notifications.service';

describe('parseSseField', () => {
  it('splits "name:value" with no space (the real Spring wire format)', () => {
    expect(parseSseField('data:{"id":"n1"}')).toEqual({ name: 'data', value: '{"id":"n1"}' });
  });

  it('strips exactly one leading space, per the SSE spec allowance', () => {
    expect(parseSseField('data: {"id":"n1"}')).toEqual({ name: 'data', value: '{"id":"n1"}' });
  });

  it('preserves a second leading space (only ONE is stripped)', () => {
    expect(parseSseField('data:  extra')).toEqual({ name: 'data', value: ' extra' });
  });

  it('splits on the FIRST colon only (value may itself contain colons)', () => {
    expect(parseSseField('data:{"time":"12:30:00"}')).toEqual({
      name: 'data',
      value: '{"time":"12:30:00"}',
    });
  });

  it('returns null for a blank line (event terminator)', () => {
    expect(parseSseField('')).toBeNull();
  });

  it('returns null for a comment line (starts with ":")', () => {
    expect(parseSseField(': keepalive')).toBeNull();
  });

  it('returns null for a line with no colon at all', () => {
    expect(parseSseField('not-a-field')).toBeNull();
  });
});

describe('NotificationsService', () => {
  let service: NotificationsService;
  let http: HttpTestingController;

  const n1: UserNotification = {
    id: 'n1',
    category: 'role-change',
    title: 'Role changed',
    body: 'You are now a moderator.',
    createdAt: '2026-06-01T12:00:00Z',
  };
  const n2: UserNotification = {
    id: 'n2',
    category: 'feature-availability',
    title: 'New feature',
    body: 'Games are now available.',
    createdAt: '2026-06-02T09:00:00Z',
    readAt: '2026-06-02T10:00:00Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [NotificationsService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(NotificationsService);
    http = TestBed.inject(HttpTestingController);
  });

  const originalFetch = globalThis.fetch;

  afterEach(() => {
    http.verify();
    service.stopLive(); // clear any pending reconnect timer / abort a hung fetch
    globalThis.fetch = originalFetch;
    TestBed.resetTestingModule();
  });

  // ── list() ────────────────────────────────────────────────────────────────

  it('list() sends GET /bff/user/notifications and emits the result', async () => {
    const promise = firstValueFrom(service.list());
    http.expectOne('/bff/user/notifications').flush([n1, n2]);
    expect(await promise).toEqual([n1, n2]);
  });

  it('list() coerces a null response body to []', async () => {
    const promise = firstValueFrom(service.list());
    http.expectOne('/bff/user/notifications').flush(null);
    expect(await promise).toEqual([]);
  });

  it('list() includes a limit query param when provided', async () => {
    firstValueFrom(service.list(5));
    const req = http.expectOne('/bff/user/notifications?limit=5');
    req.flush([n1]);
    expect(req.request.params.get('limit')).toBe('5');
  });

  it('list() pushes the result to notifications$ so subscribers see the update', async () => {
    // Await the list() call itself: the service delegates to the generated
    // client, whose Promise resolves (and only then pushes onto the subject)
    // one microtask after the response is flushed.
    const promise = firstValueFrom(service.list());
    http.expectOne('/bff/user/notifications').flush([n1]);
    await promise;
    const current = await firstValueFrom(service.notifications$);
    expect(current).toEqual([n1]);
  });

  // ── unreadCount$ ──────────────────────────────────────────────────────────

  it('unreadCount$ emits 0 before any list() call', async () => {
    expect(await firstValueFrom(service.unreadCount$)).toBe(0);
  });

  it('unreadCount$ reflects the number of notifications without a readAt', async () => {
    const promise = firstValueFrom(service.list());
    http.expectOne('/bff/user/notifications').flush([n1, n2]); // n1 unread, n2 read
    await promise;
    expect(await firstValueFrom(service.unreadCount$)).toBe(1);
  });

  // ── markRead() ────────────────────────────────────────────────────────────

  it('markRead() posts to /bff/user/notifications/{id}/read', async () => {
    // Seed the BehaviorSubject first.
    firstValueFrom(service.list());
    http.expectOne('/bff/user/notifications').flush([n1]);

    const promise = firstValueFrom(service.markRead('n1'));
    const req = http.expectOne('/bff/user/notifications/n1/read');
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await promise;
  });

  it('markRead() optimistically stamps readAt and drops unreadCount$ to 0', async () => {
    firstValueFrom(service.list());
    http.expectOne('/bff/user/notifications').flush([n1]);

    const mark$ = firstValueFrom(service.markRead('n1'));
    http.expectOne('/bff/user/notifications/n1/read').flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    await mark$;

    expect(await firstValueFrom(service.unreadCount$)).toBe(0);
    const ns = await firstValueFrom(service.notifications$);
    expect(ns[0].readAt).toBeTruthy();
  });

  it('markRead() URL-encodes the notification id', async () => {
    firstValueFrom(service.list());
    http.expectOne('/bff/user/notifications').flush([{ ...n1, id: 'n/1' }]);

    firstValueFrom(service.markRead('n/1'));
    http.expectOne('/bff/user/notifications/n%2F1/read').flush(null, {
      status: 204,
      statusText: 'No Content',
    });
  });

  // ── startLive() / stopLive() — SSE real-time push ───────────────────────────

  /** Build a fake fetch `Response` whose body is a ReadableStream emitting the
   *  given raw SSE text chunks, then closing (mirrors the wire framing the
   *  merged user-bff `UserNotificationController` produces). */
  function sseResponse(ok: boolean, chunks: string[] = []): Response {
    const encoder = new TextEncoder();
    const body = ok
      ? new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
          },
        })
      : null;
    return { ok, body } as unknown as Response;
  }

  /** Flush the promise chain inside `startLive()` (fetch → `reader.read()`
   *  loop, which are REAL native microtasks a plain `await Promise.resolve()`
   *  chain doesn't reliably drain) so the stream has been fully consumed
   *  before assertions run. A real macrotask tick guarantees this. */
  async function flushStream(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  it('startLive() fetches the events endpoint with cookie credentials and no bearer', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Promise<Response>(() => {}); // hang: keep the "connection" open
    }) as typeof fetch;

    service.startLive();

    expect(capturedUrl).toBe('/bff/user/notifications/events');
    expect(capturedInit?.credentials).toBe('include');
    expect(
      (capturedInit?.headers as Record<string, string> | undefined)?.['Authorization'],
    ).toBeUndefined();
  });

  it('startLive() is a no-op when already running (single fetch call)', async () => {
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls++;
      return new Promise<Response>(() => {});
    }) as typeof fetch;

    service.startLive();
    service.startLive();

    expect(fetchCalls).toBe(1);
  });

  it('liveStatus$ goes connecting → live on a successful connect', async () => {
    globalThis.fetch = (() => Promise.resolve(sseResponse(true, []))) as typeof fetch;

    const statuses: SseLiveStatus[] = [];
    service.liveStatus$.subscribe((s) => statuses.push(s));

    service.startLive();
    await flushStream();

    expect(statuses).toContain('connecting');
    expect(statuses).toContain('live');
  });

  it('parses a "data: {...}" SSE line into a prepended, unread UserNotification', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        sseResponse(true, [
          'event: role-change\n',
          'data: {"id":"n9","category":"role-change","title":"Role granted","body":"admin"}\n\n',
        ]),
      )) as typeof fetch;

    service.startLive();
    await flushStream();

    const ns = await firstValueFrom(service.notifications$);
    expect(ns.length).toBe(1);
    expect(ns[0]).toEqual(
      jasmine.objectContaining({
        id: 'n9',
        category: 'role-change',
        title: 'Role granted',
        body: 'admin',
        readAt: null,
      }),
    );
    expect(ns[0].createdAt).toBeTruthy(); // client-stamped arrival time
  });

  it('parses the REAL Spring wire format — "data:" with NO space before the JSON', async () => {
    // Spring WebFlux's ServerSentEventHttpMessageWriter (the actual writer
    // UserNotificationController uses) emits "data:" with no space before the
    // payload. A naive `line.startsWith('data: ')` exact-prefix check would
    // silently match zero real events — this is the regression this test guards.
    globalThis.fetch = (() =>
      Promise.resolve(
        sseResponse(true, [
          'id:n11\n',
          'event:role-change\n',
          'data:{"id":"n11","category":"role-change","title":"No-space wire format"}\n\n',
        ]),
      )) as typeof fetch;

    service.startLive();
    await flushStream();

    const ns = await firstValueFrom(service.notifications$);
    expect(ns.map((n) => n.id)).toEqual(['n11']);
    expect(ns[0].title).toBe('No-space wire format');
  });

  it('dedupes a live event whose id is already present', async () => {
    // Seed the list with n9 via a normal list() call first.
    const existing: UserNotification = {
      id: 'n9',
      category: 'role-change',
      title: 'Already here',
      body: 'seen once',
      createdAt: '2026-06-01T00:00:00Z',
    };
    firstValueFrom(service.list());
    http.expectOne('/bff/user/notifications').flush([existing]);

    globalThis.fetch = (() =>
      Promise.resolve(
        sseResponse(true, ['data: {"id":"n9","category":"role-change","title":"Dup"}\n\n']),
      )) as typeof fetch;

    service.startLive();
    await flushStream();

    const ns = await firstValueFrom(service.notifications$);
    expect(ns.length).toBe(1);
    expect(ns[0].title).toBe('Already here'); // the duplicate SSE push was ignored
  });

  it('skips a malformed SSE data line without breaking the rest of the stream', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        sseResponse(true, [
          'data: {not valid json\n\n',
          'data: {"id":"n10","category":"role-change","title":"Good one"}\n\n',
        ]),
      )) as typeof fetch;

    service.startLive();
    await flushStream();

    const ns = await firstValueFrom(service.notifications$);
    expect(ns.map((n) => n.id)).toEqual(['n10']);
  });

  it('a non-ok response reports degraded and schedules a reconnect', fakeAsync(() => {
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls++;
      return Promise.resolve(sseResponse(false));
    }) as typeof fetch;
    let lastStatus: SseLiveStatus | undefined;
    service.liveStatus$.subscribe((s) => (lastStatus = s));

    service.startLive();
    tick(); // let the first failed fetch settle
    expect(lastStatus).toBe('degraded');
    expect(fetchCalls).toBe(1);

    tick(5_000); // NotificationsService.RECONNECT_MS
    expect(fetchCalls).toBe(2); // retried
  }));

  it('a network error reports degraded and retries after the backoff', fakeAsync(() => {
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls++;
      return Promise.reject(new Error('offline'));
    }) as typeof fetch;
    let lastStatus: SseLiveStatus | undefined;
    service.liveStatus$.subscribe((s) => (lastStatus = s));

    service.startLive();
    tick();
    expect(lastStatus).toBe('degraded');

    tick(5_000);
    expect(fetchCalls).toBe(2);
  }));

  it('the stream ending cleanly (server idle-timeout close) reports degraded, not silently live', async () => {
    // The server's 4-minute idle keepalive closes the stream with no error —
    // this must NOT be mistaken for "still live"; the honest reconnect-driving
    // status transition (identical to the non-ok / network-error paths, which
    // the two adjacent tests prove actually schedule a reconnect) is what's
    // under test here.
    globalThis.fetch = (() =>
      Promise.resolve(sseResponse(true, []))) as typeof fetch; // immediately closes, no data

    const statuses: SseLiveStatus[] = [];
    service.liveStatus$.subscribe((s) => statuses.push(s));

    service.startLive();
    await flushStream();

    expect(statuses).toEqual(['idle', 'connecting', 'live', 'degraded']);
  });

  it('stopLive() cancels a pending reconnect — no further fetch after the backoff', fakeAsync(() => {
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls++;
      return Promise.reject(new Error('offline'));
    }) as typeof fetch;

    service.startLive();
    tick();
    expect(fetchCalls).toBe(1);

    service.stopLive();
    tick(5_000);
    expect(fetchCalls).toBe(1); // no reconnect fired after stop
  }));

  it('stopLive() aborts an in-flight connection and reports idle', () => {
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    }) as typeof fetch;
    let lastStatus: SseLiveStatus | undefined;
    service.liveStatus$.subscribe((s) => (lastStatus = s));

    service.startLive();
    expect(capturedSignal?.aborted).toBeFalse();

    service.stopLive();
    expect(capturedSignal?.aborted).toBeTrue();
    expect(lastStatus).toBe('idle');
  });

  it('stopLive() before startLive() is safe (no-op)', () => {
    expect(() => service.stopLive()).not.toThrow();
  });
});

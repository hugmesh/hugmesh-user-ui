import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { NotificationsComponent } from './notifications.component';
import { NotificationsService, SseLiveStatus, UserNotification } from './notifications.service';

describe('NotificationsComponent', () => {
  let service: jasmine.SpyObj<NotificationsService>;
  let notifications$: BehaviorSubject<UserNotification[]>;
  let liveStatus$: BehaviorSubject<SseLiveStatus>;

  const unread: UserNotification = {
    id: 'n1',
    category: 'role-change',
    title: 'You were promoted',
    body: 'Your role changed to moderator.',
    createdAt: '2026-01-01T12:00:00Z',
  };
  const read: UserNotification = {
    id: 'n2',
    category: 'feature-availability',
    title: 'New feature',
    body: 'Games are now available.',
    createdAt: '2026-01-02T09:00:00Z',
    readAt: '2026-01-02T10:00:00Z',
  };

  /**
   * Builds a spy `NotificationsService` whose `notifications$` / `liveStatus$`
   * are REAL BehaviorSubjects the test can push into — mirroring how the real
   * service's `list()`/`markRead()`/live-SSE path all funnel through the same
   * subjects. `list()` itself pushes `notifications` into `notifications$`
   * (like the real service's `tap()`), so the component's single subscription
   * exercises the real data flow, not a parallel mock path.
   */
  async function setup(
    notifications: UserNotification[] = [unread, read],
  ): Promise<ComponentFixture<NotificationsComponent>> {
    notifications$ = new BehaviorSubject<UserNotification[]>([]);
    liveStatus$ = new BehaviorSubject<SseLiveStatus>('idle');
    service = jasmine.createSpyObj<NotificationsService>('NotificationsService', [
      'list',
      'markRead',
      'startLive',
      'stopLive',
    ]);
    service.list.and.callFake(() => {
      notifications$.next(notifications);
      return of(notifications);
    });
    (service as unknown as { notifications$: typeof notifications$ }).notifications$ =
      notifications$;
    (service as unknown as { liveStatus$: typeof liveStatus$ }).liveStatus$ = liveStatus$;

    await TestBed.configureTestingModule({
      imports: [NotificationsComponent],
      providers: [{ provide: NotificationsService, useValue: service }],
    }).compileComponents();
    const fixture = TestBed.createComponent(NotificationsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  // ── USER-SITUATIONAL ─────────────────────────────────────────────────────

  it('loads notifications on init and renders one row per item', async () => {
    const fixture = await setup();
    expect(service.list).toHaveBeenCalledTimes(1);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="notifications-list"]')).toBeTruthy();
    expect(el.querySelector('[data-notification-id="n1"]')).toBeTruthy();
    expect(el.querySelector('[data-notification-id="n2"]')).toBeTruthy();
  });

  it('shows the unread badge with the correct count', async () => {
    const fixture = await setup();
    const el: HTMLElement = fixture.nativeElement;
    const badge = el.querySelector('[data-testid="unread-badge"]') as HTMLElement;
    expect(badge).withContext('unread badge is rendered').toBeTruthy();
    expect(badge.textContent?.trim()).toBe('1');
  });

  it('adds the .unread class and mark-as-read button only for unread items', async () => {
    const fixture = await setup();
    const el: HTMLElement = fixture.nativeElement;
    const unreadRow = el.querySelector('[data-notification-id="n1"]') as HTMLElement;
    const readRow = el.querySelector('[data-notification-id="n2"]') as HTMLElement;
    expect(unreadRow.classList).toContain('unread');
    expect(readRow.classList).not.toContain('unread');
    expect(el.querySelector('[data-mark-read="n1"]')).toBeTruthy();
    expect(el.querySelector('[data-mark-read="n2"]')).toBeNull();
  });

  it('mark-as-read removes the .unread class and hides the button', async () => {
    const fixture = await setup();
    service.markRead.and.callFake((id: string) => {
      const now = '2026-01-01T13:00:00Z';
      notifications$.next(notifications$.value.map((n) => (n.id === id ? { ...n, readAt: now } : n)));
      return of(undefined);
    });
    await fixture.componentInstance.markRead(unread);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const row = el.querySelector('[data-notification-id="n1"]') as HTMLElement;
    expect(row.classList).not.toContain('unread');
    expect(el.querySelector('[data-mark-read="n1"]')).toBeNull();
  });

  it('mark-as-read drops the unread count badge to 0', async () => {
    const fixture = await setup();
    service.markRead.and.callFake((id: string) => {
      const now = '2026-01-01T13:00:00Z';
      notifications$.next(notifications$.value.map((n) => (n.id === id ? { ...n, readAt: now } : n)));
      return of(undefined);
    });
    await fixture.componentInstance.markRead(unread);
    fixture.detectChanges();
    expect(fixture.componentInstance.unreadCount).toBe(0);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="unread-badge"]')).toBeNull();
  });

  it('does not call markRead when the notification is already read', async () => {
    const fixture = await setup();
    await fixture.componentInstance.markRead(read);
    expect(service.markRead).not.toHaveBeenCalled();
  });

  it('shows the empty-state message when there are no notifications', async () => {
    const fixture = await setup([]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="notifications-empty"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="notifications-list"]')).toBeNull();
  });

  it('mark-as-read button carries a descriptive aria-label', async () => {
    const fixture = await setup();
    const el: HTMLElement = fixture.nativeElement;
    const btn = el.querySelector<HTMLButtonElement>('[data-mark-read="n1"]')!;
    expect(btn.getAttribute('aria-label')).toContain('You were promoted');
  });

  // ── DENY / ERROR ─────────────────────────────────────────────────────────

  it('shows a friendly error alert when the list load fails', async () => {
    notifications$ = new BehaviorSubject<UserNotification[]>([]);
    liveStatus$ = new BehaviorSubject<SseLiveStatus>('idle');
    service = jasmine.createSpyObj<NotificationsService>('NotificationsService', [
      'list',
      'markRead',
      'startLive',
      'stopLive',
    ]);
    service.list.and.returnValue(throwError(() => new Error('500')));
    (service as unknown as { notifications$: typeof notifications$ }).notifications$ =
      notifications$;
    (service as unknown as { liveStatus$: typeof liveStatus$ }).liveStatus$ = liveStatus$;
    await TestBed.configureTestingModule({
      imports: [NotificationsComponent],
      providers: [{ provide: NotificationsService, useValue: service }],
    }).compileComponents();
    const fixture = TestBed.createComponent(NotificationsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.loadError()).toBeTruthy();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="notifications-load-error"]')).toBeTruthy();
  });

  it('shows a polite status message when mark-as-read fails', async () => {
    const fixture = await setup();
    service.markRead.and.returnValue(throwError(() => new Error('network')));
    await fixture.componentInstance.markRead(unread);
    expect(fixture.componentInstance.statusMessage()).toContain('Could not mark');
  });

  // ── REAL-TIME SSE ────────────────────────────────────────────────────────

  it('starts the live SSE subscription after the initial load', async () => {
    await setup();
    expect(service.startLive).toHaveBeenCalledTimes(1);
  });

  it('stops the live SSE subscription on destroy', async () => {
    const fixture = await setup();
    fixture.destroy();
    expect(service.stopLive).toHaveBeenCalledTimes(1);
  });

  it('a live SSE push (via notifications$) renders without a manual reload', async () => {
    const fixture = await setup([unread]);
    const pushed: UserNotification = {
      id: 'n3',
      category: 'infra-impacting',
      title: 'Live-pushed notification',
      body: 'Arrived over SSE.',
      createdAt: '2026-01-03T00:00:00Z',
      readAt: null,
    };
    notifications$.next([pushed, unread]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-notification-id="n3"]')).toBeTruthy();
  });

  it('shows the honest degraded banner when the live stream is unreachable', async () => {
    const fixture = await setup();
    liveStatus$.next('degraded');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="notifications-live-degraded"]')).toBeTruthy();
  });

  it('hides the degraded banner once the stream reconnects (live)', async () => {
    const fixture = await setup();
    liveStatus$.next('degraded');
    fixture.detectChanges();
    liveStatus$.next('live');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="notifications-live-degraded"]')).toBeNull();
  });

  it('does not show the degraded banner while merely connecting', async () => {
    const fixture = await setup();
    liveStatus$.next('connecting');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="notifications-live-degraded"]')).toBeNull();
  });
});

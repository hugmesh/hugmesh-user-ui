import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { SessionsComponent } from './sessions.component';
import { UserSession, SessionsService } from './sessions.service';

describe('SessionsComponent', () => {
  let sessions: jasmine.SpyObj<SessionsService>;

  const session: UserSession = {
    id: 's1',
    account: 'sub-1',
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-02-01T00:00:00Z',
    current: false,
  };

  async function setup(initial: UserSession[]): Promise<ComponentFixture<SessionsComponent>> {
    sessions = jasmine.createSpyObj<SessionsService>('SessionsService', ['list', 'revoke']);
    sessions.list.and.returnValue(of(initial));
    await TestBed.configureTestingModule({
      imports: [SessionsComponent],
      providers: [{ provide: SessionsService, useValue: sessions }],
    }).compileComponents();
    const fixture = TestBed.createComponent(SessionsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders the sessions container view', async () => {
    const fixture = await setup([session]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="sessions-view"]')).not.toBeNull();
  });

  it('fetches and renders a row per active session', async () => {
    const fixture = await setup([session]);
    expect(sessions.list).toHaveBeenCalledTimes(1);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="sessions-rows"]')).not.toBeNull();
    expect(el.querySelector('[data-session-id="s1"]')).not.toBeNull();
  });

  it('gives the revoke button a descriptive aria-label and revokes through the service', async () => {
    const fixture = await setup([session]);
    const el: HTMLElement = fixture.nativeElement;
    const btn = el.querySelector<HTMLButtonElement>('[data-revoke="s1"]')!;
    expect(btn.getAttribute('data-testid')).toBe('session-revoke');
    expect(btn.getAttribute('aria-label')).toContain('s1');

    // Revoke removes the row: the post-revoke refresh returns an empty list.
    sessions.revoke.and.returnValue(of({ revoked: true }));
    sessions.list.and.returnValue(of([]));
    await fixture.componentInstance.revoke(session);
    fixture.detectChanges();
    expect(sessions.revoke).toHaveBeenCalledWith('s1');
    expect(fixture.nativeElement.querySelector('[data-session-id="s1"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="sessions-empty"]')).not.toBeNull();
  });

  it('shows an empty-state message when there are no sessions', async () => {
    const fixture = await setup([]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="sessions-empty"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="sessions-rows"]')).toBeNull();
  });

  it('surfaces a role=alert error when the list load fails', async () => {
    sessions = jasmine.createSpyObj<SessionsService>('SessionsService', ['list', 'revoke']);
    sessions.list.and.returnValue(throwError(() => new Error('boom')));
    await TestBed.configureTestingModule({
      imports: [SessionsComponent],
      providers: [{ provide: SessionsService, useValue: sessions }],
    }).compileComponents();
    const fixture = TestBed.createComponent(SessionsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.errorMessage()).toContain('Could not load');
    const alert = fixture.nativeElement.querySelector('[data-testid="sessions-error"]');
    expect(alert).not.toBeNull();
    expect(alert.getAttribute('role')).toBe('alert');
  });

  it('surfaces a role=alert error when a revoke fails', async () => {
    const fixture = await setup([session]);
    sessions.revoke.and.returnValue(throwError(() => new Error('boom')));
    await fixture.componentInstance.revoke(session);
    fixture.detectChanges();
    expect(fixture.componentInstance.errorMessage()).toContain('Could not revoke');
    // The row stays put when the revoke fails.
    expect(fixture.nativeElement.querySelector('[data-session-id="s1"]')).not.toBeNull();
  });
});

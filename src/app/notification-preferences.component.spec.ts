import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { NotificationPreferencesComponent } from './notification-preferences.component';
import {
  NotificationPreference,
  NotificationPreferencesService,
} from './notification-preferences.service';

describe('NotificationPreferencesComponent', () => {
  let service: jasmine.SpyObj<NotificationPreferencesService>;

  const allPrefs: NotificationPreference[] = [
    { category: 'account-restriction', enabled: true },
    { category: 'role-change', enabled: true },
    { category: 'infra-impacting', enabled: false },
    { category: 'feature-availability', enabled: true },
  ];

  async function setup(
    prefs = allPrefs,
  ): Promise<ComponentFixture<NotificationPreferencesComponent>> {
    service = jasmine.createSpyObj<NotificationPreferencesService>(
      'NotificationPreferencesService',
      ['load', 'set'],
    );
    service.load.and.returnValue(of(prefs));
    await TestBed.configureTestingModule({
      imports: [NotificationPreferencesComponent],
      providers: [{ provide: NotificationPreferencesService, useValue: service }],
    }).compileComponents();
    const fixture = TestBed.createComponent(NotificationPreferencesComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  // ── USER-SITUATIONAL ─────────────────────────────────────────────────────

  it('loads preferences on init and renders a toggle for each category', async () => {
    const fixture = await setup();
    expect(service.load).toHaveBeenCalledTimes(1);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="notif-pref-toggle-account-restriction"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="notif-pref-toggle-role-change"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="notif-pref-toggle-infra-impacting"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="notif-pref-toggle-feature-availability"]')).toBeTruthy();
  });

  it('renders account-restriction as checked and natively disabled (forced-on)', async () => {
    const fixture = await setup();
    const el: HTMLElement = fixture.nativeElement;
    const toggle = el.querySelector<HTMLInputElement>(
      '[data-testid="notif-pref-toggle-account-restriction"]',
    )!;
    expect(toggle.checked).toBeTrue();
    expect(toggle.disabled).toBeTrue();
  });

  it('reflects the loaded enabled state for optional categories', async () => {
    const fixture = await setup();
    const el: HTMLElement = fixture.nativeElement;
    const infra = el.querySelector<HTMLInputElement>(
      '[data-testid="notif-pref-toggle-infra-impacting"]',
    )!;
    expect(infra.checked).toBeFalse();
    const roleChange = el.querySelector<HTMLInputElement>(
      '[data-testid="notif-pref-toggle-role-change"]',
    )!;
    expect(roleChange.checked).toBeTrue();
  });

  it('calls service.set and shows saved status on toggle change', async () => {
    const fixture = await setup();
    service.set.and.returnValue(of({ category: 'role-change', enabled: false }));
    const event = new Event('change');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = false;
    Object.defineProperty(event, 'target', { value: checkbox });
    await fixture.componentInstance.onToggle('role-change', event);
    expect(service.set).toHaveBeenCalledWith('role-change', false);
    expect(fixture.componentInstance.statusMessage()).toBe('Preference saved.');
  });

  it('does NOT call service.set for account-restriction (forced-on)', async () => {
    const fixture = await setup();
    const event = new Event('change');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = false;
    Object.defineProperty(event, 'target', { value: checkbox });
    await fixture.componentInstance.onToggle('account-restriction', event);
    expect(service.set).not.toHaveBeenCalled();
  });

  it('account-restriction isEnabled() always returns true regardless of prefs', async () => {
    // Even if server somehow sends enabled:false, the UI forces it on.
    const fixture = await setup([{ category: 'account-restriction', enabled: false }]);
    expect(fixture.componentInstance.isEnabled('account-restriction')).toBeTrue();
  });

  // ── DENY / ERROR ─────────────────────────────────────────────────────────

  it('shows a load error alert when load() fails', async () => {
    service = jasmine.createSpyObj<NotificationPreferencesService>(
      'NotificationPreferencesService',
      ['load', 'set'],
    );
    service.load.and.returnValue(throwError(() => new Error('500')));
    await TestBed.configureTestingModule({
      imports: [NotificationPreferencesComponent],
      providers: [{ provide: NotificationPreferencesService, useValue: service }],
    }).compileComponents();
    const fixture = TestBed.createComponent(NotificationPreferencesComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.loadError()).toBeTruthy();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="notif-prefs-load-error"]')).toBeTruthy();
  });

  it('shows a save error and reverts the optimistic update when set() fails', async () => {
    const fixture = await setup();
    service.set.and.returnValue(throwError(() => new Error('network')));
    // infra-impacting starts as false (from allPrefs).
    expect(fixture.componentInstance.isEnabled('infra-impacting')).toBeFalse();

    const event = new Event('change');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true; // Attempt to enable.
    Object.defineProperty(event, 'target', { value: checkbox });
    await fixture.componentInstance.onToggle('infra-impacting', event);

    expect(fixture.componentInstance.statusMessage()).toContain('Could not save');
    // Optimistic update should be reverted.
    expect(fixture.componentInstance.isEnabled('infra-impacting')).toBeFalse();
  });
});

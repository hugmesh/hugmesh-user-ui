import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  NotificationPreferencesService,
  NotificationPreference,
} from './notification-preferences.service';

describe('NotificationPreferencesService', () => {
  let service: NotificationPreferencesService;
  let http: HttpTestingController;

  /** The wire shape: user-bff returns a Map<String, Boolean>, NOT an array of rows. */
  const allView = {
    'account-restriction': true,
    'role-change': true,
    'infra-impacting': false,
    'feature-availability': true,
  };
  const allPrefs: NotificationPreference[] = [
    { category: 'account-restriction', enabled: true },
    { category: 'role-change', enabled: true },
    { category: 'infra-impacting', enabled: false },
    { category: 'feature-availability', enabled: true },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        NotificationPreferencesService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(NotificationPreferencesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  // ── load() ────────────────────────────────────────────────────────────────

  it('load() sends GET /bff/user/notification-preferences and emits the result', async () => {
    const promise = firstValueFrom(service.load());
    http.expectOne('/bff/user/notification-preferences').flush(allView);
    expect(await promise).toEqual(allPrefs);
  });

  it('load() pushes the result to prefs$ so subscribers see the update', async () => {
    const loaded = firstValueFrom(service.load());
    http.expectOne('/bff/user/notification-preferences').flush(allView);
    await loaded;
    expect(await firstValueFrom(service.prefs$)).toEqual(allPrefs);
  });

  it('prefs$ starts as null before any load() call', async () => {
    expect(await firstValueFrom(service.prefs$)).toBeNull();
  });

  // ── set() ─────────────────────────────────────────────────────────────────

  it('set() sends PUT /bff/user/notification-preferences with category+enabled body', async () => {
    // Pre-load so the BehaviorSubject is seeded.
    const seeded = firstValueFrom(service.load());
    http.expectOne('/bff/user/notification-preferences').flush(allView);
    await seeded;

    const promise = firstValueFrom(service.set('role-change', false));
    const req = http.expectOne('/bff/user/notification-preferences');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ category: 'role-change', enabled: false });
    req.flush({ ...allView, 'role-change': false });
    expect(await promise).toEqual({ category: 'role-change', enabled: false });
  });

  it('set() updates the matching entry in prefs$ with the server response', async () => {
    const seeded = firstValueFrom(service.load());
    http.expectOne('/bff/user/notification-preferences').flush(allView);
    await seeded;

    const saved = firstValueFrom(service.set('infra-impacting', true));
    http.expectOne('/bff/user/notification-preferences').flush({ ...allView, 'infra-impacting': true });
    await saved;

    const current = await firstValueFrom(service.prefs$);
    const infra = current?.find((p) => p.category === 'infra-impacting');
    expect(infra?.enabled).toBeTrue();
    // Other entries must be unchanged.
    const roleChange = current?.find((p) => p.category === 'role-change');
    expect(roleChange?.enabled).toBeTrue();
  });

  it('set() fails rather than inventing a row when the response lacks the category', async () => {
    const promise = firstValueFrom(service.set('role-change', true)).then(
      () => 'resolved',
      (e: Error) => e.message,
    );
    http.expectOne('/bff/user/notification-preferences').flush({ 'account-restriction': true });
    expect(await promise).toContain("no 'role-change' entry");
  });
});

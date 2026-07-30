import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { PREF_MEDIA_POISON_DEFAULT, PreferencesService } from './preferences.service';

describe('PreferencesService', () => {
  let service: PreferencesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PreferencesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // ── USER-SITUATIONAL ─────────────────────────────────────────────────────

  it('load() GETs /bff/user/preferences and pushes to prefs$', async () => {
    const map = { [PREF_MEDIA_POISON_DEFAULT]: 'medium' };
    const promise = firstValueFrom(service.load());
    const req = httpMock.expectOne('/bff/user/preferences');
    expect(req.request.method).toBe('GET');
    req.flush(map);
    const result = await promise;
    expect(result[PREF_MEDIA_POISON_DEFAULT]).toBe('medium');
    // prefs$ is also updated
    expect(await firstValueFrom(service.prefs$)).toEqual(map);
  });

  it('set() PUTs {key, value} and returns the updated map', async () => {
    const updated = { [PREF_MEDIA_POISON_DEFAULT]: 'high' };
    const promise = firstValueFrom(service.set(PREF_MEDIA_POISON_DEFAULT, 'high'));
    const req = httpMock.expectOne('/bff/user/preferences');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ key: PREF_MEDIA_POISON_DEFAULT, value: 'high' });
    req.flush(updated);
    const result = await promise;
    expect(result[PREF_MEDIA_POISON_DEFAULT]).toBe('high');
  });

  it('load() pushes null initially and the map after the response', async () => {
    expect(await firstValueFrom(service.prefs$)).toBeNull();
    const promise = firstValueFrom(service.load());
    httpMock.expectOne('/bff/user/preferences').flush({ [PREF_MEDIA_POISON_DEFAULT]: 'off' });
    await promise;
    expect((await firstValueFrom(service.prefs$))?.[PREF_MEDIA_POISON_DEFAULT]).toBe('off');
  });
});

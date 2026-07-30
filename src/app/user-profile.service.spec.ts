import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { HOME_GUIDE, UserProfile, UserProfileService } from './user-profile.service';

describe('UserProfileService', () => {
  let service: UserProfileService;
  let httpMock: HttpTestingController;

  const profile: UserProfile = {
    userId: 'sub-1',
    gender: 'nonbinary',
    pronouns: 'they/them',
    timezone: 'UTC',
    displayName: 'Alex',
    visibility: 'internal',
    vanitySubdomainEnabled: false,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [UserProfileService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UserProfileService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs /bff/user/profile and pushes it onto profile$', async () => {
    const result = firstValueFrom(service.load());
    const req = httpMock.expectOne('/bff/user/profile');
    expect(req.request.method).toBe('GET');
    req.flush(profile);
    expect(await result).toEqual(profile);
    expect(await firstValueFrom(service.profile$)).toEqual(profile);
  });

  it('PUTs the profile body to /bff/user/profile and updates profile$', async () => {
    const result = firstValueFrom(service.save(profile));
    const req = httpMock.expectOne('/bff/user/profile');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(profile);
    const saved = { ...profile, visibility: 'public' as const };
    req.flush(saved);
    expect(await result).toEqual(saved);
    expect(await firstValueFrom(service.profile$)).toEqual(saved);
  });

  it('POSTs {oldPassword,newPassword} to /bff/user/profile/password', async () => {
    const ack = service.changePassword('old', 'new');
    const req = httpMock.expectOne('/bff/user/profile/password');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ oldPassword: 'old', newPassword: 'new' });
    req.flush({ op: 'password-change', status: 'submitted', casdoor: 'live' });
    expect((await ack).op).toBe('password-change');
  });

  it('POSTs {email} to /bff/user/profile/email', async () => {
    const ack = service.changeEmail('new@example.com');
    const req = httpMock.expectOne('/bff/user/profile/email');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'new@example.com' });
    req.flush({ op: 'email-change', status: 'queued', casdoor: 'stubbed' });
    expect((await ack).op).toBe('email-change');
  });

  it('GETs the home-guide status with the guide query param and pushes onto homeGuide$', async () => {
    const result = firstValueFrom(service.loadHomeGuide());
    const req = httpMock.expectOne((r) => r.url === '/bff/user/home-guide');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('guide')).toBe(HOME_GUIDE);
    req.flush({ guide: HOME_GUIDE, dismissed: false });
    expect(await result).toEqual({ guide: HOME_GUIDE, dismissed: false });
    expect(await firstValueFrom(service.homeGuide$)).toEqual({ guide: HOME_GUIDE, dismissed: false });
  });

  it('POSTs to /bff/user/home-guide/dismiss to dismiss the guide ("don\'t show again")', async () => {
    const result = firstValueFrom(service.dismissHomeGuide());
    const req = httpMock.expectOne((r) => r.url === '/bff/user/home-guide/dismiss');
    expect(req.request.method).toBe('POST');
    expect(req.request.params.get('guide')).toBe(HOME_GUIDE);
    req.flush({ guide: HOME_GUIDE, dismissed: true });
    expect((await result).dismissed).toBeTrue();
  });

  it('DELETEs /bff/user/home-guide/dismiss to re-show the guide', async () => {
    const result = firstValueFrom(service.resetHomeGuide());
    const req = httpMock.expectOne((r) => r.url === '/bff/user/home-guide/dismiss');
    expect(req.request.method).toBe('DELETE');
    req.flush({ guide: HOME_GUIDE, dismissed: false });
    expect((await result).dismissed).toBeFalse();
  });
});

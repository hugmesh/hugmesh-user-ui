import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { UserSession, SessionsService } from './sessions.service';

describe('SessionsService', () => {
  let service: SessionsService;
  let httpMock: HttpTestingController;

  const session: UserSession = {
    id: 's1',
    account: 'sub-1',
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-02-01T00:00:00Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SessionsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('lists my active sessions', async () => {
    const promise = firstValueFrom(service.list());
    const req = httpMock.expectOne('/bff/user/sessions');
    expect(req.request.method).toBe('GET');
    req.flush([session]);
    expect((await promise).length).toBe(1);
  });

  it('coerces a null list body to an empty array', async () => {
    const promise = firstValueFrom(service.list());
    httpMock.expectOne('/bff/user/sessions').flush(null);
    expect(await promise).toEqual([]);
  });

  it('DELETEs a session by id (url-encoded)', async () => {
    const promise = firstValueFrom(service.revoke('s1'));
    const req = httpMock.expectOne('/bff/user/sessions/s1');
    expect(req.request.method).toBe('DELETE');
    req.flush({ revoked: true });
    await promise;
  });
});

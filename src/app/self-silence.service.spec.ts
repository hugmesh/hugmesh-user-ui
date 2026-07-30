import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { SelfSilenceService } from './self-silence.service';

describe('SelfSilenceService', () => {
  let service: SelfSilenceService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SelfSilenceService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('maps a 204 status response to null', async () => {
    const promise = firstValueFrom(service.status());
    const req = httpMock.expectOne('/bff/user/self-silence/status');
    expect(req.request.method).toBe('GET');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(await promise).toBeNull();
  });

  it('returns the body for a 200 active silence', async () => {
    const promise = firstValueFrom(service.status());
    const req = httpMock.expectOne('/bff/user/self-silence/status');
    req.flush({ userId: 'sub-1', expiresAt: '2999-01-01T00:00:00Z' });
    expect((await promise)?.expiresAt).toBe('2999-01-01T00:00:00Z');
  });

  it('POSTs activate with expiresAt + reason', async () => {
    const promise = firstValueFrom(service.activate('2999-01-01T00:00:00Z', 'taking a break'));
    const req = httpMock.expectOne('/bff/user/self-silence/activate');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ expiresAt: '2999-01-01T00:00:00Z', reason: 'taking a break' });
    req.flush({ userId: 'sub-1', expiresAt: '2999-01-01T00:00:00Z' });
    await promise;
  });

  it('POSTs cancel (204)', async () => {
    const promise = firstValueFrom(service.cancel());
    const req = httpMock.expectOne('/bff/user/self-silence/cancel');
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await promise;
  });

  it('POSTs email-mod with the reason', async () => {
    const promise = firstValueFrom(service.emailMod('please restore me'));
    const req = httpMock.expectOne('/bff/user/self-silence/email-mod');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ reason: 'please restore me' });
    req.flush({ status: 'queued', kind: 'self-silence-appeal', federation: {} });
    await promise;
  });
});

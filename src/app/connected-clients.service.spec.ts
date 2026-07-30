import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { ConnectedClient, ConnectedClientsService } from './connected-clients.service';

describe('ConnectedClientsService', () => {
  let service: ConnectedClientsService;
  let httpMock: HttpTestingController;

  const client: ConnectedClient = {
    id: 'c1',
    owner: 'sub-1',
    platform: 'matrix',
    clientKind: 'oauth-app',
    label: 'Element',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ConnectedClientsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('lists my connected clients', async () => {
    const promise = firstValueFrom(service.list());
    const req = httpMock.expectOne('/bff/user/connected-clients');
    expect(req.request.method).toBe('GET');
    req.flush([client]);
    expect((await promise).length).toBe(1);
  });

  it('coerces a null list body to an empty array', async () => {
    const promise = firstValueFrom(service.list());
    httpMock.expectOne('/bff/user/connected-clients').flush(null);
    expect(await promise).toEqual([]);
  });

  it('DELETEs a client by id (url-encoded)', async () => {
    const promise = firstValueFrom(service.revoke('c1'));
    const req = httpMock.expectOne('/bff/user/connected-clients/c1');
    expect(req.request.method).toBe('DELETE');
    req.flush({ revoked: true });
    await promise;
  });
});

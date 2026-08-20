import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { CardsService, UserModuleCard } from './cards.service';

/**
 * Let the generated ng-openapi-gen client's promise-based delegation settle.
 * `CardsService` now delegates to the generated `CardsService`, whose methods
 * return Promises, so a fire-and-forget follow-up refresh (the `listMine()` in
 * `delete()`/`put()`) pushes onto `cards$` one microtask AFTER its response is
 * flushed. A real macrotask tick guarantees that has happened.
 */
const settle = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('CardsService', () => {
  let service: CardsService;
  let httpMock: HttpTestingController;

  const card: UserModuleCard = {
    id: 1,
    ownerUserId: 'sub-1',
    slug: 'my-card',
    versionDir: 'v1',
    contentHash: 'abc',
    manifestJson: '{}',
    visibility: 'internal',
    createdAt: '2026-01-01T00:00:00Z',
    supersededAt: null,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CardsService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CardsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs /bff/user/cards for my cards and pushes them onto cards$', async () => {
    const result = firstValueFrom(service.listMine());
    const req = httpMock.expectOne('/bff/user/cards');
    expect(req.request.method).toBe('GET');
    req.flush([card]);
    expect(await result).toEqual([card]);
    expect(await firstValueFrom(service.cards$)).toEqual([card]);
  });

  it('treats a null list response as an empty cards$ (no crash)', async () => {
    const result = firstValueFrom(service.listMine());
    httpMock.expectOne('/bff/user/cards').flush(null);
    expect(await result).toBeNull();
    expect(await firstValueFrom(service.cards$)).toEqual([]);
  });

  it('GETs the versions of one card by slug (url-encoded)', async () => {
    const result = firstValueFrom(service.listBySlug('my/card'));
    const req = httpMock.expectOne('/bff/user/cards/my%2Fcard');
    expect(req.request.method).toBe('GET');
    req.flush([card]);
    expect(await result).toEqual([card]);
  });

  it('GETs the card body as text from /{slug}/body (owner-scoped read-my-card-body)', async () => {
    const result = firstValueFrom(service.readBody('my-card'));
    const req = httpMock.expectOne('/bff/user/cards/my-card/body');
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('text');
    req.flush('# Hello\n\n/* @hugmesh-card-css */\nh1 { color: red; }');
    expect(await result).toContain('# Hello');
  });

  it('DELETEs /{slug} (url-encoded) and refreshes the list on success', async () => {
    const result = firstValueFrom(service.delete('my/card'));
    const req = httpMock.expectOne('/bff/user/cards/my%2Fcard');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    await result;
    // tap() triggers a follow-up listMine() refresh.
    httpMock.expectOne('/bff/user/cards').flush([card]);
    await settle();
    expect(await firstValueFrom(service.cards$)).toEqual([card]);
  });

  it('PUTs an octet-stream entry file with optional query params and refreshes the list', async () => {
    const put = firstValueFrom(
      service.put('my-card', 'export default {}', {
        entryFile: 'index.js',
        visibility: 'public',
        manifestJson: '{"a":1}',
      }),
    );
    const putReq = httpMock.expectOne((r) => r.method === 'PUT' && r.url === '/bff/user/cards/my-card');
    expect(putReq.request.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(putReq.request.body).toBe('export default {}');
    expect(putReq.request.params.get('entryFile')).toBe('index.js');
    expect(putReq.request.params.get('visibility')).toBe('public');
    expect(putReq.request.params.get('manifest')).toBe('{"a":1}');
    putReq.flush(card);
    expect(await put).toEqual(card);

    // tap() triggers a follow-up listMine() refresh.
    httpMock.expectOne('/bff/user/cards').flush([card]);
    await settle();
    expect(await firstValueFrom(service.cards$)).toEqual([card]);
  });
});

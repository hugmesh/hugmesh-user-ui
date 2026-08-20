import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { BlockService, UserBlock } from './block.service';

/**
 * Let the generated ng-openapi-gen client's promise-based delegation settle.
 * `BlockService` now delegates to the generated `SelfBlockService`, whose methods
 * return Promises, so a fire-and-forget follow-up refresh (the `list()` in
 * `block()`/`unblock()`) pushes onto `blocks$` one microtask AFTER its response
 * is flushed. A real macrotask tick guarantees that has happened.
 */
const settle = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('BlockService', () => {
  let service: BlockService;
  let httpMock: HttpTestingController;

  const block: UserBlock = {
    id: 'b1',
    userId: 'sub-1',
    target: '@spam:example.org',
    platform: 'matrix',
    ts: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [BlockService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(BlockService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs /bff/user/blocks and pushes them onto blocks$', async () => {
    const result = firstValueFrom(service.list());
    const req = httpMock.expectOne('/bff/user/blocks');
    expect(req.request.method).toBe('GET');
    req.flush([block]);
    expect(await result).toEqual([block]);
    expect(await firstValueFrom(service.blocks$)).toEqual([block]);
  });

  it('POSTs {target,platform} to /bff/user/blocks and refreshes the list', async () => {
    const post = firstValueFrom(service.block('@spam:example.org', 'matrix'));
    const postReq = httpMock.expectOne((r) => r.method === 'POST' && r.url === '/bff/user/blocks');
    expect(postReq.request.body).toEqual({ target: '@spam:example.org', platform: 'matrix' });
    postReq.flush({ block, pushed: false, external: 'stubbed' });
    expect((await post).external).toBe('stubbed');

    // tap() triggers a follow-up list() refresh.
    httpMock.expectOne('/bff/user/blocks').flush([block]);
    await settle();
    expect(await firstValueFrom(service.blocks$)).toEqual([block]);
  });

  it('DELETEs /bff/user/blocks/{id} (url-encoded) and refreshes the list', async () => {
    const del = firstValueFrom(service.unblock('b 1'));
    const delReq = httpMock.expectOne('/bff/user/blocks/b%201');
    expect(delReq.request.method).toBe('DELETE');
    delReq.flush(null);
    await del;
    httpMock.expectOne('/bff/user/blocks').flush([]);
    await settle();
    expect(await firstValueFrom(service.blocks$)).toEqual([]);
  });

  it('POSTs {instance,reason} to /bff/user/recommend-instance-block', async () => {
    const rec = firstValueFrom(service.recommendInstanceBlock('bad.example', 'spam waves'));
    const req = httpMock.expectOne('/bff/user/recommend-instance-block');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ instance: 'bad.example', reason: 'spam waves' });
    req.flush({ recommended: true, instance: 'bad.example', federation: {} });
    expect((await rec).recommended).toBeTrue();
  });
});

import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('sends the bff_ cookie (withCredentials) and NO Authorization bearer header', () => {
    http.get('/bff/user/preferences').subscribe();
    const req = httpMock.expectOne('/bff/user/preferences');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });
});

import { HttpInterceptorFn } from '@angular/common/http';

/** Sends the HttpOnly `bff_` session cookie with every outgoing HttpClient
 *  request so the gateway's BffCookieToBearerWebFilter can mint the bearer
 *  server-side. The browser no longer holds (or attaches) a bearer token —
 *  it only carries the cookie. Requests made while the cookie is absent (not
 *  logged in) are still sent with credentials; the BFF rejects them with 401. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req.clone({ withCredentials: true }));
};

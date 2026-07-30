import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { authInterceptor } from './app/auth.interceptor';

// Bootstrap the standalone dev-shell application. This file is only executed when
// the remote is served standalone (`ng serve user`); in production the host shell
// bootstraps its own Angular app and federates `./routes` directly — this
// bootstrap is not involved.
//
// We must provide HttpClient here because the datastore services
// (UserProfileService, CardsService, BlockService, etc.) call same-origin
// /bff/user/** endpoints and depend on it. In production those services resolve
// from the host shell's root injector; providedIn:'root' means whichever app
// bootstraps first owns the singleton. The withFetch() adapter uses the browser's
// native fetch API (required for native-federation compatibility and SSR-friendly
// HTTP). The authInterceptor sends the request withCredentials so the HttpOnly
// bff_ session cookie rides along (the browser holds no bearer token).
bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
  ],
}).catch((err) => console.error(err));

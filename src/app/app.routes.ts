import { Routes } from '@angular/router';
import { USER_ROUTES } from './user.routes';

/**
 * Dev-shell routes for standalone development (`ng serve user`). Mounts the
 * federated {@link USER_ROUTES} at the root so the user remote is fully browsable
 * without the host shell. The host shell ignores this file and loads `./routes`
 * (USER_ROUTES) directly via the native-federation manifest.
 */
export const routes: Routes = [{ path: '', children: USER_ROUTES }];

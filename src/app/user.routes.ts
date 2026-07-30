import { Routes } from '@angular/router';
import { HomeComponent } from './home.component';
import { ProfileComponent } from './profile.component';
import { CardsComponent } from './cards.component';
import { SelfBlockComponent } from './self-block.component';
import { RecommendInstanceBlockComponent } from './recommend-instance-block.component';
import { SelfSilenceComponent } from './self-silence.component';
import { ConnectedAppsComponent } from './connected-apps.component';
import { SessionsComponent } from './sessions.component';
import { PreferencesComponent } from './preferences.component';
import { NotificationsComponent } from './notifications.component';
import { NotificationPreferencesComponent } from './notification-preferences.component';

/** Routes exposed by the User native-federation remote. The hugmesh.systems
 *  host mounts these at the user role-home, so they resolve to the home guide
 *  (default), /profile (profile editor — also exposed standalone for the modal),
 *  /cards (federation card manager), /blocks (self-block list),
 *  /recommend-instance-block (instance-block recommendation form),
 *  /self-silence (self-service visibility hide), /connected-apps (OAuth apps
 *  + device sessions, gated on an external-client role), /sessions (active login
 *  sessions list + revoke, backed by /bff/user/sessions), /preferences
 *  (durable per-user preferences backed by /bff/user/preferences),
 *  /notifications (in-app notification inbox backed by /bff/user/notifications),
 *  and /notification-preferences (per-category opt-in toggles backed by
 *  /bff/user/notification-preferences). ROLE_USER guarded by the host. */
export const USER_ROUTES: Routes = [
  { path: '', component: HomeComponent },
  { path: 'profile', component: ProfileComponent },
  { path: 'cards', component: CardsComponent },
  { path: 'blocks', component: SelfBlockComponent },
  { path: 'recommend-instance-block', component: RecommendInstanceBlockComponent },
  { path: 'self-silence', component: SelfSilenceComponent },
  { path: 'connected-apps', component: ConnectedAppsComponent },
  { path: 'sessions', component: SessionsComponent },
  { path: 'preferences', component: PreferencesComponent },
  { path: 'notifications', component: NotificationsComponent },
  { path: 'notification-preferences', component: NotificationPreferencesComponent },
];

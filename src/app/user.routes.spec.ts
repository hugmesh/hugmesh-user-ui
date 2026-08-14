import { USER_ROUTES } from './user.routes';
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

/**
 * These specs lock down the federation contract: `./routes` (exposed under the
 * remote name "user") is the module the hugmesh.net host mounts at the
 * user role-home. The host depends on these exact paths and components, so a
 * regression here would silently break the host's user views.
 */
describe('USER_ROUTES (exposed ./routes federation contract)', () => {
  const byPath = (path: string) => USER_ROUTES.find((r) => r.path === path);

  it('exposes the welcome/getting-started guide at the empty path (default mount point)', () => {
    const root = byPath('');
    expect(root).toBeDefined();
    expect(root!.component).toBe(HomeComponent);
  });

  it('wires each feature route to its dedicated component', () => {
    expect(byPath('profile')!.component).toBe(ProfileComponent);
    expect(byPath('cards')!.component).toBe(CardsComponent);
    expect(byPath('blocks')!.component).toBe(SelfBlockComponent);
    expect(byPath('recommend-instance-block')!.component).toBe(RecommendInstanceBlockComponent);
    expect(byPath('self-silence')!.component).toBe(SelfSilenceComponent);
    expect(byPath('connected-apps')!.component).toBe(ConnectedAppsComponent);
    expect(byPath('sessions')!.component).toBe(SessionsComponent);
    expect(byPath('preferences')!.component).toBe(PreferencesComponent);
    expect(byPath('notifications')!.component).toBe(NotificationsComponent);
    expect(byPath('notification-preferences')!.component).toBe(NotificationPreferencesComponent);
  });

  it('exposes exactly the user views the host expects', () => {
    expect(USER_ROUTES.map((r) => r.path)).toEqual([
      '',
      'profile',
      'cards',
      'blocks',
      'recommend-instance-block',
      'self-silence',
      'connected-apps',
      'sessions',
      'preferences',
      'notifications',
      'notification-preferences',
    ]);
  });

  it('declares every route with a component (no dead routes)', () => {
    for (const route of USER_ROUTES) {
      expect(route.component || route.children).withContext(`route ${route.path}`).toBeTruthy();
    }
  });

  it('contains no duplicate paths', () => {
    const paths = USER_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

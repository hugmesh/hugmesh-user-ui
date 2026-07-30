import { routes } from './app.routes';
import { USER_ROUTES } from './user.routes';

/**
 * The dev-shell routes (used only by `ng serve user` standalone) must mount the
 * exact same USER_ROUTES the host federates, so standalone behaviour matches
 * the federated behaviour.
 */
describe('app.routes (standalone dev shell)', () => {
  it('mounts the exposed USER_ROUTES as children of the root path', () => {
    expect(routes.length).toBe(1);
    expect(routes[0].path).toBe('');
    expect(routes[0].children).toBe(USER_ROUTES);
  });
});

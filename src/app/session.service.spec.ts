import { TestBed } from '@angular/core/testing';
import { SessionService, SnapSession } from './session.service';

function makeSession(roles: string[]): SnapSession {
  return {
    id: 'google:alex@example.com',
    label: 'alex@example.com',
    provider: 'google',
    roles,
    registrationComplete: true,
  };
}

describe('SessionService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  afterEach(() => localStorage.clear());

  it('is logged out with no session', () => {
    const s = TestBed.inject(SessionService);
    expect(s.loggedIn()).toBe(false);
    expect(s.isUser()).toBe(false);
    expect(s.hasExternalClientRole()).toBe(false);
  });

  it('treats any logged-in session as the USER tier', () => {
    localStorage.setItem('hug.session', JSON.stringify(makeSession(['user'])));
    const s = TestBed.inject(SessionService);
    expect(s.isUser()).toBe(true);
    expect(s.isMod()).toBe(false);
    expect(s.isAdmin()).toBe(false);
  });

  it('derives the external-client computeds from the role markers', () => {
    localStorage.setItem(
      'hug.session',
      JSON.stringify(makeSession(['user', 'matrix_external_client'])),
    );
    const s = TestBed.inject(SessionService);
    expect(s.isMatrixExternalClient()).toBe(true);
    expect(s.isMastodonExternalClient()).toBe(false);
    expect(s.hasExternalClientRole()).toBe(true);
  });

  it('treats a mastodon-external-client role as holding an external-client role', () => {
    localStorage.setItem(
      'hug.session',
      JSON.stringify(makeSession(['user', 'MASTODON_EXTERNAL_CLIENT'])),
    );
    const s = TestBed.inject(SessionService);
    expect(s.isMastodonExternalClient()).toBe(true);
    expect(s.hasExternalClientRole()).toBe(true);
  });

  it('a plain user holds NO external-client role (drives the disabled gate)', () => {
    localStorage.setItem('hug.session', JSON.stringify(makeSession(['user'])));
    const s = TestBed.inject(SessionService);
    expect(s.hasExternalClientRole()).toBe(false);
  });

  it('mod and admin tiers are additive (mod never sees admin)', () => {
    localStorage.setItem('hug.session', JSON.stringify(makeSession(['user', 'mod'])));
    const s = TestBed.inject(SessionService);
    expect(s.isMod()).toBe(true);
    expect(s.isAdmin()).toBe(false);
  });
});

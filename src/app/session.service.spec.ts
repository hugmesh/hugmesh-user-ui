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

  describe('same-document session-change channel (the sign-out propagation seam)', () => {
    // The host shell's Sign out removes the hug.session mirror and dispatches a
    // window event; same-document writes raise NO `storage` event, so that
    // broadcast is the ONLY way this remote learns the session ended. This copy
    // used to listen on the pre-rebrand 'snap-session-change' name only — deaf to
    // the canonical 'hug-session-change' every other remote speaks — so its
    // in-memory session kept rendering the signed-out user's surfaces until a
    // full reload (operator report 2026-08-19).
    it('drops the in-memory session on the CANONICAL hug-session-change event', () => {
      localStorage.setItem('hug.session', JSON.stringify(makeSession(['user'])));
      const s = TestBed.inject(SessionService);
      expect(s.loggedIn()).toBe(true);
      localStorage.removeItem('hug.session'); // the host's clear() already removed the mirror
      window.dispatchEvent(new Event('hug-session-change'));
      expect(s.loggedIn()).withContext('sign-out reaches this remote in-page').toBe(false);
    });

    it('still drops the session on the LEGACY snap-session-change event (mixed-version host)', () => {
      localStorage.setItem('hug.session', JSON.stringify(makeSession(['user'])));
      const s = TestBed.inject(SessionService);
      expect(s.loggedIn()).toBe(true);
      localStorage.removeItem('hug.session');
      window.dispatchEvent(new Event('snap-session-change'));
      expect(s.loggedIn()).withContext('a not-yet-redeployed host is still heard').toBe(false);
    });

    it('broadcasts BOTH channel names on clear()', () => {
      localStorage.setItem('hug.session', JSON.stringify(makeSession(['user'])));
      const s = TestBed.inject(SessionService);
      const canonical = jasmine.createSpy('canonical');
      const legacy = jasmine.createSpy('legacy');
      window.addEventListener('hug-session-change', canonical);
      window.addEventListener('snap-session-change', legacy);
      try {
        s.clear();
        expect(canonical).withContext('canonical listeners hear the sign-out').toHaveBeenCalled();
        expect(legacy).withContext('legacy listeners hear the sign-out').toHaveBeenCalled();
      } finally {
        window.removeEventListener('hug-session-change', canonical);
        window.removeEventListener('snap-session-change', legacy);
      }
    });
  });
});

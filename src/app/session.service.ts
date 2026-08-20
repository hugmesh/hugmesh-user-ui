import { Injectable, signal, computed } from '@angular/core';

/**
 * The deserialized shape of the `hug.session` localStorage entry. Written by
 * the login remote when SSO completes and the BFF issues a session token; read
 * by every federated remote via this service. `roles` are lowercase Casdoor role
 * slugs (`'user'`, `'mod'`, `'admin'`, `'matrix_external_client'`, etc.).
 */
export interface SnapSession {
  /** Casdoor identity key, e.g. `google:alice@gmail.com`. */
  id: string;
  /** Human-readable display label (email or Discord handle). */
  label: string;
  /** The SSO provider that authenticated this session. */
  provider: 'google' | 'discord';
  /** Lowercase Casdoor role slugs granted to this user. */
  roles: string[];
  registrationComplete: boolean;
}

/**
 * Holds the logged-in session (persisted to `localStorage` under `hug.session`)
 * and derives the Casdoor-style role-tier signals that role-gated surfaces consult.
 *
 * This is the canonical HugMesh SessionService (copied verbatim in each
 * native-federation remote because the federation runtime forbids shared singletons
 * across remote boundaries). Every copy reads/writes the SAME `hug.session`
 * localStorage key and dispatches/listens for the SAME `hug-session-change`
 * broadcast so all in-page instances (host shell + every loaded remote) stay in sync
 * without a round-trip to the server.
 *
 * Role signals mirror server-side `ROLE_*` authorities minted by the Casdoor
 * authorities converter; they are DEFENCE-IN-DEPTH (the UI hides/disables controls
 * the caller's role cannot use) — the BFF APIs remain the authoritative gate.
 *
 * @see {@link SnapSession} for the full session shape.
 * @see `hug-session-change` custom event — dispatched on every write so in-page
 *   remote copies re-read without a storage event (which only fires in OTHER tabs).
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly key = 'hug.session';
  /** The CANONICAL same-document session-change seam — the exact string every
   *  other remote's SessionService (login-ui, admin-ui, mod-ui, matrix-ui,
   *  mastodon-ui, forum-ui, wiki-ui, tube-ui, owncast-ui, user-mesh-ui) declares.
   *  This copy USED to carry the pre-rebrand 'snap-session-change' name: it was
   *  deaf to every canonical broadcast (including the host shell's sign-out once
   *  the host moved to the canonical name), so this remote's in-memory session
   *  kept rendering the signed-out user's surfaces until a full page reload
   *  (operator report 2026-08-19, "need to clear cache every time after log out"). */
  private readonly channel = 'hug-session-change';
  /** The legacy pre-rebrand channel name. Still LISTENED ON (so a
   *  not-yet-redeployed host shell that only dispatches the old name keeps this
   *  remote in sync during a mixed-version rollout) and still dispatched
   *  alongside the canonical name for the mirror-image rollout gap. Remove once
   *  every deployed host/remote speaks the canonical channel. */
  private readonly legacyChannel = 'snap-session-change';

  /** Reactive signal over the current session; `null` when logged out. */
  readonly session = signal<SnapSession | null>(this.load());

  /** `true` when a session is present (any role). */
  readonly loggedIn = computed(() => this.session() !== null);

  /**
   * USER tier — any authenticated user. Casdoor always grants the `'user'` role
   * at registration; the user-bff-api gates its endpoints on `hasRole('USER')`.
   */
  readonly isUser = computed(() => this.loggedIn());

  /**
   * ADMIN tier — only a Casdoor `'admin'` role. admin-bff gates endpoints on
   * `hasRole('ADMIN')`.
   */
  readonly isAdmin = computed(() => this.hasRole('admin'));

  /**
   * MOD tier — a Casdoor `'mod'` OR `'admin'` role. mod-bff defence-in-depth:
   * `hasAnyRole('MOD','ADMIN')`.
   */
  readonly isMod = computed(() => this.hasRole('mod') || this.hasRole('admin'));

  /**
   * Whether the caller holds a Matrix external-client role
   * (`ROLE_MATRIX_EXTERNAL_CLIENT`). Granted when a native Matrix app (Element,
   * FluffyChat, etc.) is registered to this account.
   */
  readonly isMatrixExternalClient = computed(() => this.hasRole('matrix_external_client'));

  /**
   * Whether the caller holds a Mastodon external-client role
   * (`ROLE_MASTODON_EXTERNAL_CLIENT`). Granted when a native Mastodon app
   * (Tusky, Ivory, etc.) is registered to this account.
   */
  readonly isMastodonExternalClient = computed(() => this.hasRole('mastodon_external_client'));

  /**
   * Whether the caller holds ANY external-client role. The user-bff-api
   * ConnectedClientsController gates its entire surface on
   * `hasRole('MATRIX_EXTERNAL_CLIENT') OR hasRole('MASTODON_EXTERNAL_CLIENT')`;
   * this signal drives the UI's disable + helptext mirror of that gate so the
   * connected-apps view never calls and 403s.
   */
  readonly hasExternalClientRole = computed(
    () => this.isMatrixExternalClient() || this.isMastodonExternalClient(),
  );

  /**
   * Whether the caller holds a homeserver PLATFORM role (`ROLE_MATRIX` or
   * `ROLE_MASTODON`) — distinct from the external-client roles above. The
   * user-bff-api `BlockController` gates `POST /bff/user/recommend-instance-block`
   * on `hasAnyRole('MATRIX','MASTODON')` (only a platform participant may start
   * the USER→MOD→ADMIN moderation chain); this signal drives the
   * recommend-instance-block form's disable + helptext mirror of that gate so a
   * plain user never sees a fully-enabled form whose submit just 403s.
   */
  readonly hasPlatformRole = computed(() => this.hasRole('matrix') || this.hasRole('mastodon'));

  constructor() {
    // Each native-federation remote and the host shell get their OWN Angular
    // injector, so each holds its OWN SessionService instance. We keep them in
    // sync by:
    //  1. Listening for `hug-session-change` (same-document custom event, fired by
    //     whichever instance last called set/patch/clear) so in-page remotes stay
    //     current without a storage event — plus the legacy `snap-session-change`
    //     name during mixed-version rollouts. Both handlers just re-read the
    //     mirror (idempotent), so hearing a dual-dispatched write twice is safe.
    //  2. Listening for the `storage` event so cross-tab writes (e.g. logging in a
    //     second tab) propagate here too.
    if (typeof window !== 'undefined') {
      window.addEventListener(this.channel, () => this.session.set(this.load()));
      window.addEventListener(this.legacyChannel, () => this.session.set(this.load()));
      window.addEventListener('storage', (e) => {
        if (e.key === this.key) this.session.set(this.load());
      });
    }
  }

  /**
   * Replace the stored session with `s`, persist to `localStorage`, and broadcast
   * to the other in-page service instances. Called by the login remote when SSO
   * completes.
   *
   * @param s The new session to store.
   */
  set(s: SnapSession): void {
    localStorage.setItem(this.key, JSON.stringify(s));
    this.session.set(s);
    this.broadcast();
  }

  /**
   * Apply a partial update to the current session (no-op when logged out).
   * Useful for patching a single field (e.g. `registrationComplete`) without
   * re-writing the whole session from scratch.
   *
   * @param p Partial session fields to merge.
   */
  patch(p: Partial<SnapSession>): void {
    const s = this.session();
    if (s) this.set({ ...s, ...p });
  }

  /**
   * Log out: remove the stored session from `localStorage`, reset the signal to
   * `null`, and broadcast to the other in-page instances.
   */
  clear(): void {
    localStorage.removeItem(this.key);
    this.session.set(null);
    this.broadcast();
  }

  /**
   * Case-insensitive role membership check over the session's lowercase `roles[]`.
   *
   * @param role Lowercase role slug to test (e.g. `'admin'`, `'mod'`).
   * @returns `true` when the current session carries that role.
   */
  private hasRole(role: string): boolean {
    return (this.session()?.roles ?? []).some((r) => r.toLowerCase() === role);
  }

  /**
   * Read and parse the stored session from `localStorage`. Returns `null` when
   * absent or on parse error (e.g. corrupted storage value).
   */
  private load(): SnapSession | null {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Dispatch a same-document `hug-session-change` event so the other in-page
   * SessionService instances (host shell + other loaded remotes) re-read from
   * `localStorage` without waiting for a cross-tab `storage` event. The legacy
   * `snap-session-change` name is dispatched too, for a not-yet-redeployed
   * listener during mixed-version rollouts (see {@link legacyChannel}).
   */
  private broadcast(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(this.channel));
    window.dispatchEvent(new Event(this.legacyChannel));
  }
}

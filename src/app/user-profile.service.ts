import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, from } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { ProfileService } from './api/services/profile.service';
import { HomeGuideService } from './api/services/home-guide.service';
import { UserProfile as GenUserProfile } from './api/models/user-profile';

/**
 * The caller's OWN profile, matched field-for-field to the user-bff-api
 * {@code UserProfile} record. {@code userId} is the JWT subject (server-set;
 * never sent from the client) and {@code visibility} is {@code public|internal}.
 */
export interface UserProfile {
  userId?: string;
  gender: string | null;
  pronouns: string | null;
  timezone: string | null;
  displayName: string | null;
  visibility: 'public' | 'internal';
  vanitySubdomainEnabled: boolean;
  /**
   * The ASCII aria-label a screen reader announces for this user (server column
   * {@code screen_reader_name}, changeset 008). When {@code displayName} is pure
   * ASCII the server DEFAULTS this to it; when {@code displayName} is non-ASCII a
   * screen-reader name must be supplied (the save flow prompts via a 422). NULL
   * when not yet set and the display name is ASCII — the read side defaults it.
   * Optional so an older host/BFF that omits it still type-checks.
   */
  screenReaderName?: string | null;
  /**
   * The stored REF for the caller's profile picture (server column
   * {@code avatar_url}) — an {@code mxc://} Matrix media ref, NOT a fetchable
   * URL. Treat it as a presence flag only; the bytes are served by
   * {@code GET /bff/user/profile/avatar/body}. (This doc used to claim
   * "same-origin URL", and the view believed it — hence a broken image for
   * everyone who had uploaded.) Set by the avatar-upload flow
   * ({@code POST /bff/user/profile/avatar}). NULL/absent when the user has not
   * uploaded one yet — the avatar view then shows a placeholder. Optional so an
   * older host/BFF that omits it still type-checks.
   */
  avatarUrl?: string | null;
}

/** GET/POST/DELETE /bff/user/home-guide response shape. */
export interface HomeGuideStatus {
  guide: string;
  dismissed: boolean;
}

/** Acknowledgement for a Casdoor-relayed password/email change. */
export interface CasdoorAck {
  op: string;
  status: string;
  casdoor: string;
}

/** Default guide key the role-home welcome panel reads/dismisses. */
export const HOME_GUIDE = 'home';

/**
 * Datastore service for the caller's OWN profile + the home-guide preference +
 * Casdoor-relayed password/email changes. RxJS {@link BehaviorSubject}-backed
 * so views subscribe to {@link profile$} / {@link homeGuide$} and re-render on
 * change.
 *
 * <p><b>ng-openapi-gen migration (pilot):</b> this service now DELEGATES every
 * call to the generated, typed {@link ProfileService} / {@link HomeGuideService}
 * (under {@code src/app/api}, generated from the user-bff-api OpenAPI spec) instead
 * of hand-rolling {@code HttpClient} URLs. The generated clients call the SAME
 * same-origin {@code /bff/user/**} paths (their {@code rootUrl} defaults to ''),
 * so the wire behaviour — and the {@code HttpTestingController} URL assertions in
 * the specs — are unchanged. The gateway forwards the caller's Casdoor JWT, so the
 * BFF always scopes to the caller's own data (owner = JWT subject). This service
 * keeps its OWN public {@link UserProfile} / {@link HomeGuideStatus} /
 * {@link CasdoorAck} types so the components consuming it need no change; the
 * generated model is bridged at the delegation boundary.
 *
 * Endpoints (user-bff-api ProfileController + HomeGuideController):
 *   GET    /bff/user/profile            → ProfileService.me()
 *   PUT    /bff/user/profile            → ProfileService.upsert({body})
 *   POST   /bff/user/profile/password   → ProfileService.changePassword({body})
 *   POST   /bff/user/profile/email      → ProfileService.changeEmail({body})
 *   GET    /bff/user/home-guide?guide=  → HomeGuideService.status3({guide})
 *   POST   /bff/user/home-guide/dismiss?guide= → HomeGuideService.dismiss({guide})
 *   DELETE /bff/user/home-guide/dismiss?guide= → HomeGuideService.reset({guide})
 */
@Injectable({ providedIn: 'root' })
export class UserProfileService {
  private readonly profiles = inject(ProfileService);
  private readonly guides = inject(HomeGuideService);
  // Direct HttpClient for the avatar UPLOAD only: multipart/form-data file posts
  // are not modelled cleanly by ng-openapi-gen, so this one same-origin call is
  // hand-rolled while every other call still delegates to the generated clients.
  private readonly http = inject(HttpClient);

  private readonly profileSubject = new BehaviorSubject<UserProfile | null>(null);
  /** The caller's own profile (null until first load). */
  readonly profile$: Observable<UserProfile | null> = this.profileSubject.asObservable();

  private readonly homeGuideSubject = new BehaviorSubject<HomeGuideStatus | null>(null);
  /** Home-guide dismissal status (null until first load). */
  readonly homeGuide$: Observable<HomeGuideStatus | null> = this.homeGuideSubject.asObservable();

  /** Load my profile and push it onto {@link profile$}. */
  load(): Observable<UserProfile> {
    return from(this.profiles.me()).pipe(
      map((p) => p as UserProfile),
      tap((p) => this.profileSubject.next(p)),
    );
  }

  /** Create/update my profile (the body's userId is ignored — owner = JWT subject). */
  save(profile: UserProfile): Observable<UserProfile> {
    return from(this.profiles.upsert({ body: profile as GenUserProfile })).pipe(
      map((p) => p as UserProfile),
      tap((p) => this.profileSubject.next(p)),
    );
  }

  /**
   * Upload my profile picture as multipart/form-data and push the returned,
   * updated profile (with its new {@code avatarUrl}) onto {@link profile$} so
   * every subscribing view re-renders — mirrors how {@link save} updates the
   * subject. The BFF forces owner = JWT subject, so a user only ever updates
   * THEIR OWN avatar.
   *
   * @param file the chosen image (the component validates type/size first)
   */
  uploadAvatar(file: File): Observable<UserProfile> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<UserProfile>('/bff/user/profile/avatar', formData).pipe(
      tap((p) => this.profileSubject.next(p)),
    );
  }

  /** Change my Casdoor password (BFF relays to the IdP). */
  changePassword(oldPassword: string, newPassword: string): Promise<CasdoorAck> {
    return this.profiles
      .changePassword({ body: { oldPassword, newPassword } })
      .then((ack) => ack as unknown as CasdoorAck);
  }

  /** Change my Casdoor email (BFF relays to the IdP). */
  changeEmail(email: string): Promise<CasdoorAck> {
    return this.profiles
      .changeEmail({ body: { email } })
      .then((ack) => ack as unknown as CasdoorAck);
  }

  /** Is the named guide dismissed for me? Pushes onto {@link homeGuide$}. */
  loadHomeGuide(guide: string = HOME_GUIDE): Observable<HomeGuideStatus> {
    return from(this.guides.status3({ guide })).pipe(
      map((s) => s as unknown as HomeGuideStatus),
      tap((s) => this.homeGuideSubject.next(s)),
    );
  }

  /** Dismiss the named guide for me ("don't show again"). Idempotent. */
  dismissHomeGuide(guide: string = HOME_GUIDE): Observable<HomeGuideStatus> {
    return from(this.guides.dismiss({ guide })).pipe(
      map((s) => s as unknown as HomeGuideStatus),
      tap((s) => this.homeGuideSubject.next(s)),
    );
  }

  /** Re-show (un-dismiss) the named guide for me. */
  resetHomeGuide(guide: string = HOME_GUIDE): Observable<HomeGuideStatus> {
    return from(this.guides.reset({ guide })).pipe(
      map((s) => s as unknown as HomeGuideStatus),
      tap((s) => this.homeGuideSubject.next(s)),
    );
  }
}

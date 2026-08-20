import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, from } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { SelfSilenceService as GenSelfSilenceService } from './api/services/self-silence.service';

/**
 * One self-silence belonging to the caller, matched field-for-field to the
 * user-bff-api `SelfSilence` record. The user has made THEMSELVES invisible to
 * others until `expiresAt`; they keep their full access the whole time. This is
 * NOT a ban — it carries no role change, no suspension, and no revocation.
 * `userId` is server-set (`owner = JWT subject`) and is never sent from the client.
 */
export interface SelfSilence {
  /** Owning user's Casdoor subject (server-set; never written from the client). */
  userId?: string;
  /** ISO timestamp when the self-silence was started. */
  startedAt?: string | null;
  /**
   * ISO timestamp when the hide auto-expires. The BFF's `@Scheduled`
   * `SelfSilenceExpiryAction` clears the hide at this time with no manual action.
   */
  expiresAt: string | null;
  /** ISO timestamp when the silence was manually cancelled, or null when still active. */
  clearedAt?: string | null;
  /** Optional free-text reason the user supplied when activating the silence. */
  reason?: string | null;
  /** ISO timestamp of the last update to this row. */
  updatedAt?: string | null;
}

/**
 * Acknowledgement returned by `POST /bff/user/self-silence/email-mod`. `kind` is
 * the federation queue item kind (`'self-silence-appeal'`); `federation` is the
 * raw federation-api response envelope (opaque to the UI).
 */
export interface EmailModAck {
  status: string;
  kind: string;
  federation: unknown;
}

/**
 * Datastore service for the caller's OWN self-silence (self-service visibility
 * hide — NOT a ban). ROLE_USER only; the BFF forces `owner = JWT subject` so a
 * user can only ever silence, read, or cancel THEMSELVES.
 *
 * The BFF's `@Scheduled SelfSilenceExpiryAction` auto-clears the hide at
 * `expiresAt` with no manual action, so the UI reads back that window and exposes
 * it as the scheduled auto-restore time.
 *
 * Backed by a {@link BehaviorSubject} so {@link SelfSilenceComponent} can
 * subscribe to {@link silence$} and receive live updates after each activation or
 * cancellation.
 *
 * <p><b>ng-openapi-gen migration:</b> this service now DELEGATES to the generated,
 * typed {@link GenSelfSilenceService} (under {@code src/app/api}, generated from
 * the user-bff-api OpenAPI spec) instead of hand-rolling {@code HttpClient} URLs —
 * following the {@link UserProfileService} reference migration. The generated
 * client calls the SAME same-origin {@code /bff/user/**} paths (its
 * {@code rootUrl} defaults to '') through {@code HttpClient}, so the wire
 * behaviour — and the auth interceptor that attaches the HttpOnly `bff_` session
 * cookie — are unchanged. This service keeps its OWN public {@link SelfSilence} /
 * {@link EmailModAck} types so {@link SelfSilenceComponent} needs no change; the
 * generated model is bridged at the delegation boundary.
 *
 * Endpoints (user-bff-api `SelfSilenceController`):
 * - `GET  /bff/user/self-silence/status`    → {@link status} (200 + body | 204 → null) → `status1$Response()`
 * - `POST /bff/user/self-silence/activate`  → {@link activate} → `activate({body})`
 * - `POST /bff/user/self-silence/cancel`    → {@link cancel} (204) → `cancel()`
 * - `POST /bff/user/self-silence/email-mod` → {@link emailMod} → `emailMod({body})`
 *
 * @see {@link SelfSilenceComponent} — the primary consumer of this service.
 */
@Injectable({ providedIn: 'root' })
export class SelfSilenceService {
  private readonly silenceApi = inject(GenSelfSilenceService);

  private readonly silenceSubject = new BehaviorSubject<SelfSilence | null>(null);

  /**
   * Observable stream of the caller's current self-silence. Emits `null` when no
   * silence is active and a {@link SelfSilence} whenever one is loaded or written.
   */
  readonly silence$: Observable<SelfSilence | null> = this.silenceSubject.asObservable();

  /**
   * Fetch the caller's current self-silence status. HTTP 200 + body → the active
   * {@link SelfSilence}; HTTP 204 (no active silence) → `null`. Pushes the result
   * onto {@link silence$}.
   *
   * We take the generated client's `$Response` variant (the full
   * {@code StrictHttpResponse}, not just the body) so we can distinguish a 204
   * with no body from a 200 with a null body, and always emit
   * `SelfSilence | null`.
   *
   * @returns An Observable that emits the active silence or `null`.
   */
  status(): Observable<SelfSilence | null> {
    return from(this.silenceApi.status1$Response()).pipe(
      // 204 = no active silence; any other 2xx body is the active SelfSilence.
      map((resp) => (resp.status === 204 ? null : (resp.body as unknown as SelfSilence))),
      // Push the normalised value so any open subscriber on silence$ updates.
      tap((s) => this.silenceSubject.next(s)),
    );
  }

  /**
   * Activate a self-silence until `expiresAt`. Pushes the new {@link SelfSilence}
   * onto {@link silence$} on success.
   *
   * @param expiresAt ISO 8601 timestamp when the hide should auto-expire.
   * @param reason    Optional free-text reason (surfaced to mods via the appeal flow).
   * @returns An Observable that emits the created {@link SelfSilence}.
   */
  activate(expiresAt: string, reason?: string): Observable<SelfSilence> {
    // An omitted `reason` and an explicit null are equivalent to the BFF: its
    // ActivateRequest record binds a missing property to a null String.
    return from(this.silenceApi.activate({ body: { expiresAt, reason } })).pipe(
      map((s) => s as unknown as SelfSilence),
      // Push the server-confirmed silence so the component can reflect the new state.
      tap((s) => this.silenceSubject.next(s)),
    );
  }

  /**
   * Cancel the caller's active self-silence immediately (un-hide + clear). On
   * success, pushes `null` onto {@link silence$} so the component shows the
   * inactive state. On failure the Observable errors and the component surfaces it.
   *
   * @returns An Observable that completes (void) when the BFF confirms cancellation.
   */
  cancel(): Observable<void> {
    return from(this.silenceApi.cancel()).pipe(
      // Clear local state so the component immediately reflects the cancellation.
      tap(() => this.silenceSubject.next(null)),
    );
  }

  /**
   * Submit a self-silence-appeal to the mod queue, asking a moderator to restore
   * the caller sooner than the scheduled auto-expiry. Does NOT change the active
   * silence; the hide still auto-clears at `expiresAt`.
   *
   * @param reason Optional free-text explanation for the moderator.
   * @returns An Observable that emits the {@link EmailModAck} from the BFF.
   */
  emailMod(reason?: string): Observable<EmailModAck> {
    // As in activate(): an omitted `reason` is the same as an explicit null to
    // the BFF's EmailModRequest record.
    return from(this.silenceApi.emailMod({ body: { reason } })).pipe(
      map((ack) => ack as unknown as EmailModAck),
    );
  }
}

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * Response shape from GET /bff/owncast/user/my-stream. The server returns this
 * when the caller has an active broadcast grant. `streamUrl` is the HLS
 * playlist URL the platform exposes for the caller's Owncast instance;
 * `visibility` mirrors the stream's current permission level. A 404 or a
 * response with `visibility` absent/null means no grant is active.
 */
export interface MyStreamStatus {
  /** The platform-supplied HLS stream URL (never author-injectable). */
  streamUrl: string;
  /** Current visibility of the stream (e.g. "public" | "internal"). */
  visibility: string | null;
}

/**
 * Service for the caller's OWN Owncast stream status. All HTTP is
 * same-origin to {@code /bff/owncast/user/my-stream}; the gateway forwards the
 * caller's JWT, so the BFF always scopes to the caller's own broadcast grant.
 *
 * Used by the card publish flow to:
 *   1. Detect whether the card contains {@code <sd-owncast-player>}.
 *   2. Gate the Publish button and provide helptext when no grant is active.
 *   3. Retrieve the platform-supplied stream URL to pass to
 *      {@code renderSafeCardHtml(rawHtml, streamUrl)} so the HLS src is
 *      PLATFORM-supplied — never injectable from card author markup.
 *
 * Endpoint:
 *   GET /bff/owncast/user/my-stream → {@link MyStreamStatus} (200 with grant,
 *                                     404 when no grant active)
 */
@Injectable({ providedIn: 'root' })
export class OwncastService {
  private readonly http = inject(HttpClient);
  private readonly base = '/bff/owncast/user';

  /**
   * Fetch my stream status. Resolves with the status when a grant is active
   * (HTTP 200). The caller must handle 404 (no grant) via catchError or
   * firstValueFrom error handling.
   */
  myStream(): Observable<MyStreamStatus> {
    return this.http.get<MyStreamStatus>(`${this.base}/my-stream`);
  }
}

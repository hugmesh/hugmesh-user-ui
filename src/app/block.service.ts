import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * One self-block belonging to the caller, matched field-for-field to the
 * user-bff-api {@code UserBlock} record. {@code platform} is
 * {@code matrix|mastodon|internal}; {@code userId} is server-set (owner = JWT
 * subject) and never sent from the client.
 */
export interface UserBlock {
  /** Server-assigned UUID for this block row; used as the deletion key. */
  id: string;
  /** The owning user's Casdoor subject (server-set; never written from the client). */
  userId?: string;
  /** The blocked identity (MXID, Mastodon acct, or internal username). */
  target: string;
  /** Which platform's block list this entry lives on. */
  platform: BlockPlatform;
  /** ISO timestamp when the block was recorded. */
  ts?: string;
}

/** Platform discriminator for a self-block — mirrors `UserBlock.validPlatform` on the BFF. */
export type BlockPlatform = 'matrix' | 'mastodon' | 'internal';

/** All allowed self-block platforms (matches `UserBlock.validPlatform` on the BFF). */
export const BLOCK_PLATFORMS: BlockPlatform[] = ['matrix', 'mastodon', 'internal'];

/**
 * Acknowledgement returned by `POST /bff/user/blocks`. `pushed` indicates
 * whether the block was propagated to the external homeserver; `external` is
 * a short status message from that propagation attempt.
 */
export interface BlockAck {
  block: UserBlock;
  pushed: boolean;
  external: string;
}

/**
 * Acknowledgement returned by `POST /bff/user/recommend-instance-block`.
 * `federation` is the raw federation-api response envelope (opaque to the UI).
 */
export interface RecommendAck {
  recommended: boolean;
  instance: string;
  federation: unknown;
}

/**
 * Datastore service for the caller's OWN self-blocks and instance-block
 * recommendations. ROLE_USER only — the BFF forces `owner = JWT subject` so a
 * user can only ever see and edit their own block list.
 *
 * Backed by a {@link BehaviorSubject} so the {@link SelfBlockComponent} can
 * subscribe to {@link blocks$} and receive refreshed data after each mutation
 * without needing a manual re-fetch at the call site.
 *
 * Endpoints (user-bff-api `BlockController`):
 * - `GET    /bff/user/blocks`                   → {@link list}
 * - `POST   /bff/user/blocks`                   → {@link block}
 * - `DELETE /bff/user/blocks/{id}`              → {@link unblock}
 * - `POST   /bff/user/recommend-instance-block` → {@link recommendInstanceBlock}
 *
 * @see {@link SelfBlockComponent} — the primary consumer of this service.
 * @see {@link RecommendInstanceBlockComponent} — calls {@link recommendInstanceBlock}.
 */
@Injectable({ providedIn: 'root' })
export class BlockService {
  private readonly http = inject(HttpClient);
  private readonly base = '/bff/user';

  private readonly blocksSubject = new BehaviorSubject<UserBlock[]>([]);

  /**
   * Observable stream of the caller's own self-blocks. Emits the latest list
   * whenever {@link list}, {@link block}, or {@link unblock} is called.
   */
  readonly blocks$: Observable<UserBlock[]> = this.blocksSubject.asObservable();

  /**
   * Fetch the caller's own self-block list from the BFF and push the result
   * onto {@link blocks$}.
   *
   * @returns An Observable that emits the block list (empty array when none exist).
   */
  list(): Observable<UserBlock[]> {
    return this.http
      .get<UserBlock[]>(`${this.base}/blocks`)
      // Coerce null (empty 204 body) to [] and push the latest list into the subject.
      .pipe(tap((blocks) => this.blocksSubject.next(blocks ?? [])));
  }

  /**
   * Create a self-block (writes a durable row + best-effort external homeserver
   * push). Automatically refreshes {@link blocks$} on success so the UI list
   * stays in sync without a separate fetch.
   *
   * @param target The identity to block (MXID, Mastodon acct, or internal username).
   * @param platform Which platform's block list to write.
   * @returns An Observable that emits the {@link BlockAck} from the BFF.
   */
  block(target: string, platform: BlockPlatform): Observable<BlockAck> {
    return this.http
      .post<BlockAck>(`${this.base}/blocks`, { target, platform })
      // Refresh the block list so the new entry appears immediately.
      .pipe(tap(() => this.list().subscribe()));
  }

  /**
   * Remove one of the caller's own self-blocks by its server-assigned id.
   * Automatically refreshes {@link blocks$} on success.
   *
   * @param id The `UserBlock.id` to delete.
   * @returns An Observable that completes when the BFF confirms deletion.
   */
  unblock(id: string): Observable<void> {
    return this.http
      .delete<void>(`${this.base}/blocks/${encodeURIComponent(id)}`)
      // Refresh the block list so the removed entry disappears.
      .pipe(tap(() => this.list().subscribe()));
  }

  /**
   * Submit an instance-block RECOMMENDATION to the BFF, starting the
   * USER → MOD → ADMIN federation moderation chain. The caller is flagging a
   * problem instance for moderator review — this is NOT a direct block.
   *
   * @param instance The domain of the instance to recommend blocking.
   * @param reason   Free-text explanation for the moderator (may be empty).
   * @returns An Observable that emits the {@link RecommendAck} from the BFF.
   */
  recommendInstanceBlock(instance: string, reason: string): Observable<RecommendAck> {
    return this.http.post<RecommendAck>(`${this.base}/recommend-instance-block`, {
      instance,
      reason,
    });
  }
}

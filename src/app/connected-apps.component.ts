import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ConnectedClient, ConnectedClientsService } from './connected-clients.service';
import { SessionService } from './session.service';

/**
 * Connected apps and devices view: list and revoke the caller's own native OAuth
 * apps and device sessions on the homeservers (Element, Tusky, Ivory, etc.).
 * ROLE_USER only — the BFF forces `owner = JWT subject` so a user can only ever
 * see and revoke THEIR OWN clients.
 *
 * **External-client gate (defence-in-depth UI mirror)**: the user-bff-api
 * `ConnectedClientsController` gates its ENTIRE surface on the caller holding an
 * external-client role (`ROLE_MATRIX_EXTERNAL_CLIENT` or
 * `ROLE_MASTODON_EXTERNAL_CLIENT`). This view mirrors that gate:
 * - Without the role: the surface is shown DISABLED with helptext explaining the
 *   missing capability. The view does NOT call and receive a 403.
 * - With the role: the live client list is fetched and each row has a Revoke button.
 *
 * The API remains the authoritative gate; the UI explanation is defence-in-depth.
 *
 * @see {@link ConnectedClientsService} — HTTP layer: `GET/DELETE /bff/user/connected-clients`.
 * @see {@link SessionService.hasExternalClientRole} — the role gate signal.
 */
@Component({
  selector: 'hug-user-connected-apps',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './connected-apps.component.html',
  styleUrl: './connected-apps.component.scss',
})
export class ConnectedAppsComponent implements OnInit {
  private readonly clientsService = inject(ConnectedClientsService);
  private readonly session = inject(SessionService);

  /**
   * Whether the caller holds an external-client role. Drives the enabled/disabled
   * state of the whole surface — mirrors the BFF's role gate.
   */
  readonly hasExternalClientRole = this.session.hasExternalClientRole;

  /** The caller's own connected clients (empty until loaded). */
  readonly clients = signal<ConnectedClient[]>([]);
  /** Status announced to screen readers in a polite live region. */
  readonly statusMessage = signal('');
  /**
   * Whether {@link statusMessage} currently holds a FAILURE message, so the
   * template can tone the visible status line with `.hug-error` instead of the
   * shared success colour. Written only via {@link setStatus} /
   * {@link setStatusError}, which keeps it from going stale.
   */
  readonly statusIsError = signal(false);

  async ngOnInit(): Promise<void> {
    // Mirror the API gate: skip the fetch entirely when the role is absent to
    // avoid a 403 and to keep the UX coherent with the disabled state.
    if (!this.hasExternalClientRole()) {
      return;
    }
    await this.refresh();
  }

  /**
   * Reload the connected client list from the BFF. Called on init and after each
   * successful revocation to keep the displayed list current.
   */
  private async refresh(): Promise<void> {
    try {
      this.clients.set(await firstValueFrom(this.clientsService.list()));
    } catch {
      this.setStatusError('Could not load your connected apps and devices.');
    }
  }

  /**
   * Return a human-readable label for a client row: the app/device label when
   * present and non-blank, else the server-assigned client id.
   *
   * @param client The connected client to label.
   * @returns A non-empty display string for the client.
   */
  label(client: ConnectedClient): string {
    return client.label && client.label.trim() ? client.label : client.id;
  }

  /**
   * Revoke a connected client by its server-assigned id. On success, announces
   * the outcome to screen readers and refreshes the client list.
   *
   * @param client The {@link ConnectedClient} to revoke.
   */
  async revoke(client: ConnectedClient): Promise<void> {
    try {
      await firstValueFrom(this.clientsService.revoke(client.id));
      this.setStatus(`Revoked access for "${this.label(client)}".`);
      // Refresh so the revoked row disappears from the list.
      await this.refresh();
    } catch {
      this.setStatusError('Could not revoke that app. Please try again.');
    }
  }

  /**
   * Show a neutral or SUCCESS status message.
   *
   * The status line is rendered visibly, so its tone has to be driven by the
   * code rather than assumed by the stylesheet — see {@link setStatusError}.
   *
   * @param message Text for the polite live region.
   */
  private setStatus(message: string): void {
    this.statusMessage.set(message);
    this.statusIsError.set(false);
  }

  /**
   * Show a FAILURE status message.
   *
   * `statusMessage` carries both outcomes, so without this the shared
   * `.hug-status` rule would paint every "Could not …" line in success green.
   * Setting the flag adds `.hug-error` in the template instead.
   *
   * @param message Text for the polite live region.
   */
  private setStatusError(message: string): void {
    this.statusMessage.set(message);
    this.statusIsError.set(true);
  }
}

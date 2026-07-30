import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { UserSession, SessionsService } from './sessions.service';

/**
 * SESSIONS view: list the caller's active login sessions and revoke one. The owning
 * account is derived SERVER-SIDE from the validated JWT principal (never a request
 * param), and the BFF validates a revoke target belongs to the caller before
 * deleting — so a user only ever sees/revokes THEIR OWN sessions. Available to any
 * authenticated user (no extra role gate), unlike the connected-apps surface.
 */
@Component({
  selector: 'hug-user-sessions',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sessions.component.html',
  styleUrl: './sessions.component.scss',
})
export class SessionsComponent implements OnInit {
  private readonly sessionsService = inject(SessionsService);

  readonly sessions = signal<UserSession[]>([]);
  /** Polite live-region status for successful actions (revoke / no-op refresh). */
  readonly statusMessage = signal('');
  /** Assertive (role=alert) error message; null when there is no error. */
  readonly errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      this.sessions.set(await firstValueFrom(this.sessionsService.list()));
      this.errorMessage.set(null);
    } catch {
      this.errorMessage.set('Could not load your active sessions.');
    }
  }

  /** The accessible name for a session row: a "this device" hint for the current
   *  session, otherwise the opaque session id. */
  label(session: UserSession): string {
    return session.current ? `This device (${session.id})` : session.id;
  }

  /** Revoke one of my login sessions and refresh the list. */
  async revoke(session: UserSession): Promise<void> {
    try {
      await firstValueFrom(this.sessionsService.revoke(session.id));
      this.errorMessage.set(null);
      this.statusMessage.set(`Signed out of "${this.label(session)}".`);
      await this.refresh();
    } catch {
      this.errorMessage.set('Could not revoke that session. Please try again.');
    }
  }
}

import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { UserProfileService, HOME_GUIDE } from './user-profile.service';

/**
 * User role-home: the welcome / getting-started guide shown to ROLE_USER on
 * their first visit. Reads the per-user `home-guide-dismissed` preference
 * (`GET /bff/user/home-guide?guide=home`) to decide whether to show the guide.
 * Provides:
 * - A "don't show again" control that writes the dismissal
 *   (`POST /bff/user/home-guide/dismiss?guide=home`).
 * - A "show again" control that un-dismisses it
 *   (`DELETE /bff/user/home-guide/dismiss?guide=home`).
 *
 * If the preference load fails, the component **fails open** (shows the guide)
 * so first-time users always see the welcome content rather than a blank page.
 *
 * @see {@link UserProfileService.loadHomeGuide}   — fetches the dismissal status.
 * @see {@link UserProfileService.dismissHomeGuide} — writes the dismissal.
 * @see {@link UserProfileService.resetHomeGuide}  — un-dismisses the guide.
 */
@Component({
  selector: 'hug-user-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit {
  private readonly profiles = inject(UserProfileService);

  /**
   * Whether the guide has been dismissed by this user. `null` while the
   * preference is loading; `false` if load fails (fail-open — show the guide);
   * `true` once the user has dismissed it.
   */
  readonly dismissed = signal<boolean | null>(null);

  /** Status announced to screen readers in a polite live region. */
  readonly statusMessage = signal('');

  /** Load the guide dismissal status on init; fail open on error. */
  async ngOnInit(): Promise<void> {
    try {
      const status = await firstValueFrom(this.profiles.loadHomeGuide(HOME_GUIDE));
      this.dismissed.set(status.dismissed);
    } catch {
      // If the preference can't be loaded, fail open so the guide is always
      // shown — a blank role-home is worse than a repeated guide.
      this.dismissed.set(false);
    }
  }

  /**
   * Dismiss ("don't show again") the guide for this user. Writes the dismissal
   * to the BFF and hides the guide locally.
   */
  async dismiss(): Promise<void> {
    await firstValueFrom(this.profiles.dismissHomeGuide(HOME_GUIDE));
    this.dismissed.set(true);
    this.statusMessage.set('Getting-started guide dismissed. You can re-open it any time.');
  }

  /**
   * Un-dismiss the guide so it shows again for this user. Deletes the dismissal
   * on the BFF and re-shows the guide locally.
   */
  async showAgain(): Promise<void> {
    await firstValueFrom(this.profiles.resetHomeGuide(HOME_GUIDE));
    this.dismissed.set(false);
    this.statusMessage.set('Getting-started guide re-opened.');
  }
}

import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, firstValueFrom } from 'rxjs';
import { UserProfile, UserProfileService } from './user-profile.service';

/** Largest avatar the UI will attempt to upload (mirrors the BFF limit). */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
/** Image MIME types the avatar upload accepts (mirrors the file input accept). */
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png'] as const;

/**
 * PROFILE AVATAR view: shows the caller's current profile picture (or a
 * placeholder) and lets them upload a new one. Owner = JWT subject server-side,
 * so a user only ever sees/updates THEIR OWN avatar. Self-contained and embedded
 * at the top of the profile editor.
 *
 * <p>The chosen file is validated CLIENT-SIDE first — it must be an image of an
 * accepted type and at most {@link MAX_AVATAR_BYTES} — so the UI mirrors the BFF
 * and surfaces a friendly inline error instead of a confusing post-upload 4xx. A
 * local FileReader data-URL preview shows the image immediately; on a successful
 * {@code POST /bff/user/profile/avatar} the returned profile (with its new
 * avatarUrl) replaces the preview.
 */
@Component({
  selector: 'hug-profile-avatar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './profile-avatar.component.html',
  styleUrl: './profile-avatar.component.scss',
})
export class ProfileAvatarComponent implements OnInit, OnDestroy {
  private readonly profiles = inject(UserProfileService);

  /** The caller's current profile (null until first loaded). */
  readonly currentProfile = signal<UserProfile | null>(null);
  /** Local data-URL preview of a just-chosen image (empty = none). */
  readonly previewUrl = signal<string>('');
  /** Whether an upload is in flight (disables the input). */
  readonly uploading = signal(false);
  /** Inline validation/upload error surfaced in role=alert. Empty = none. */
  readonly uploadError = signal('');
  /** True once the served picture failed to load — a pre-022 profile whose bytes
   *  were discarded by the old upload path. The view falls back to the honest
   *  placeholder rather than a broken-image box. Reset on every fresh upload. */
  readonly avatarBroken = signal(false);

  /**
   * Where the picture is FETCHED from — the BFF's same-origin, cookie-authenticated
   * serve route, never the stored `avatarUrl`. That column holds an `mxc://` Matrix
   * media ref, which no browser can fetch; binding it produced a broken image for
   * everyone who had ever uploaded. A cache-busting stamp is appended after an
   * upload so the new picture replaces the 5-minute privately-cached old one.
   */
  avatarSrc(): string {
    const v = this.avatarVersion();
    return v ? `/bff/user/profile/avatar/body?v=${v}` : '/bff/user/profile/avatar/body';
  }

  /** Bumped after each successful upload to bust the private 5-minute cache. */
  private readonly avatarVersion = signal(0);

  private profileSub?: Subscription;

  ngOnInit(): void {
    // Re-render whenever the shared profile changes (e.g. after a save elsewhere).
    this.profileSub = this.profiles.profile$.subscribe((p) => this.currentProfile.set(p));
  }

  ngOnDestroy(): void {
    this.profileSub?.unsubscribe();
  }

  /**
   * Handle a file selection: validate it is an accepted image within the size
   * cap, show a local preview, then upload it. Invalid files set an inline error
   * and do NOT call the BFF.
   */
  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    const validationError = this.validate(file);
    if (validationError) {
      this.uploadError.set(validationError);
      this.previewUrl.set('');
      input.value = '';
      return;
    }

    this.uploadError.set('');
    this.showPreview(file);
    await this.upload(file, input);
  }

  /** Client-side mirror of the BFF gate: accepted image type AND within the cap. */
  private validate(file: File): string {
    const allowed = ALLOWED_AVATAR_TYPES as readonly string[];
    if (!file.type || !allowed.includes(file.type)) {
      return 'Please choose an image file (JPEG or PNG).';
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return 'That image is larger than 5 MB. Please choose a smaller one.';
    }
    return '';
  }

  /** Render an immediate local data-URL preview of the chosen image. */
  private showPreview(file: File): void {
    const reader = new FileReader();
    reader.onload = () => this.previewUrl.set(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  }

  /** Upload the validated file and adopt the returned, updated profile. */
  private async upload(file: File, input: HTMLInputElement): Promise<void> {
    this.uploading.set(true);
    try {
      const updated = await firstValueFrom(this.profiles.uploadAvatar(file));
      this.currentProfile.set(updated);
      // A fresh upload means fresh bytes: clear any earlier load failure and bust
      // the serve route's private 5-minute cache so the new picture shows now.
      this.avatarBroken.set(false);
      this.avatarVersion.update((v) => v + 1);
      this.previewUrl.set('');
      input.value = '';
    } catch {
      this.uploadError.set('Could not upload your profile picture. Please try again.');
    } finally {
      this.uploading.set(false);
    }
  }
}

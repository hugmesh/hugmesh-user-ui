import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { ProfileAvatarComponent } from './profile-avatar.component';
import { UserProfile, UserProfileService } from './user-profile.service';

describe('ProfileAvatarComponent', () => {
  let profiles: jasmine.SpyObj<UserProfileService>;
  let profileSubject: BehaviorSubject<UserProfile | null>;

  const withAvatar: UserProfile = {
    gender: null,
    pronouns: null,
    timezone: null,
    displayName: 'Ada',
    visibility: 'internal',
    vanitySubdomainEnabled: false,
    screenReaderName: null,
    avatarUrl: '/bff/user/profile/avatar/me.png',
  };

  /** Build a fake <input type=file>-style change Event carrying one file. */
  function fileChangeEvent(file: File | null): Event {
    const input = document.createElement('input');
    input.type = 'file';
    // FileList is read-only; define a getter the handler reads.
    Object.defineProperty(input, 'files', {
      value: file ? ([file] as unknown as FileList) : (([] as unknown) as FileList),
      configurable: true,
    });
    return { target: input } as unknown as Event;
  }

  async function setup(initial: UserProfile | null): Promise<ComponentFixture<ProfileAvatarComponent>> {
    profileSubject = new BehaviorSubject<UserProfile | null>(initial);
    profiles = jasmine.createSpyObj<UserProfileService>(
      'UserProfileService',
      ['uploadAvatar'],
      { profile$: profileSubject.asObservable() },
    );
    await TestBed.configureTestingModule({
      imports: [ProfileAvatarComponent],
      providers: [{ provide: UserProfileService, useValue: profiles }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProfileAvatarComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders the placeholder (not an image) when the user has no avatar', async () => {
    const fixture = await setup(null);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="profile-avatar-placeholder"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="profile-avatar-image"]')).toBeNull();
  });

  it('renders the current avatar image when one is set', async () => {
    const fixture = await setup(withAvatar);
    const el: HTMLElement = fixture.nativeElement;
    const img = el.querySelector<HTMLImageElement>('[data-testid="profile-avatar-image"]');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toContain('me.png');
    expect(el.querySelector('[data-testid="profile-avatar-placeholder"]')).toBeNull();
  });

  it('uploads through the service and adopts the returned profile on a valid image', async () => {
    const fixture = await setup(null);
    profiles.uploadAvatar.and.returnValue(of(withAvatar));
    const file = new File(['x'], 'me.png', { type: 'image/png' });

    await fixture.componentInstance.onFileSelected(fileChangeEvent(file));
    fixture.detectChanges();

    expect(profiles.uploadAvatar).toHaveBeenCalledWith(file);
    expect(fixture.componentInstance.currentProfile()?.avatarUrl).toContain('me.png');
    expect(fixture.componentInstance.uploadError()).toBe('');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="profile-avatar-image"]')).not.toBeNull();
  });

  it('rejects a non-image file with an error and does NOT call the service', async () => {
    const fixture = await setup(null);
    const file = new File(['not an image'], 'notes.txt', { type: 'text/plain' });

    await fixture.componentInstance.onFileSelected(fileChangeEvent(file));
    fixture.detectChanges();

    expect(profiles.uploadAvatar).not.toHaveBeenCalled();
    expect(fixture.componentInstance.uploadError()).toContain('image');
    const el: HTMLElement = fixture.nativeElement;
    const err = el.querySelector('[data-testid="profile-avatar-error"]');
    expect(err).not.toBeNull();
    expect(err!.getAttribute('role')).toBe('alert');
  });

  it('rejects an oversized image (> 5 MB) without calling the service', async () => {
    const fixture = await setup(null);
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'huge.png', { type: 'image/png' });

    await fixture.componentInstance.onFileSelected(fileChangeEvent(big));

    expect(profiles.uploadAvatar).not.toHaveBeenCalled();
    expect(fixture.componentInstance.uploadError()).toContain('5');
  });

  it('surfaces a friendly message when the upload fails', async () => {
    const fixture = await setup(null);
    profiles.uploadAvatar.and.returnValue(throwError(() => new Error('boom')));
    const file = new File(['x'], 'me.png', { type: 'image/png' });

    await fixture.componentInstance.onFileSelected(fileChangeEvent(file));

    expect(profiles.uploadAvatar).toHaveBeenCalledWith(file);
    expect(fixture.componentInstance.uploadError()).toContain('Could not upload');
  });
});

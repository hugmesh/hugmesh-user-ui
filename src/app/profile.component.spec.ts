import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ProfileComponent } from './profile.component';
import { UserProfile, UserProfileService } from './user-profile.service';

describe('ProfileComponent', () => {
  let fixture: ComponentFixture<ProfileComponent>;
  let component: ProfileComponent;
  let profiles: jasmine.SpyObj<UserProfileService>;

  const loaded: UserProfile = {
    userId: 'sub-1',
    gender: 'nonbinary',
    pronouns: 'they/them',
    timezone: 'UTC',
    displayName: 'Alex',
    visibility: 'internal',
    vanitySubdomainEnabled: false,
    screenReaderName: 'Alex',
  };

  beforeEach(async () => {
    profiles = jasmine.createSpyObj<UserProfileService>(
      'UserProfileService',
      ['load', 'save', 'changePassword', 'changeEmail'],
      // The embedded <hug-profile-avatar> subscribes to profile$ on init;
      // stub the observable PROPERTY so the spy renders without throwing.
      { profile$: of(null) },
    );
    profiles.load.and.returnValue(of(loaded));
    await TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [{ provide: UserProfileService, useValue: profiles }],
    }).compileComponents();
    fixture = TestBed.createComponent(ProfileComponent);
    component = fixture.componentInstance;
  });

  it('loads my profile on init and binds it to the form model', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(profiles.load).toHaveBeenCalledTimes(1);
    expect(component.model().displayName).toBe('Alex');
    // Let the one-way [ngModel] binding flush the model value into the DOM input.
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector<HTMLInputElement>('#profile-displayName')!.value).toBe('Alex');
  });

  it('PUTs a trimmed profile (incl. visibility + vanity toggle) on save', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    profiles.save.and.returnValue(of({ ...loaded, visibility: 'public', vanitySubdomainEnabled: true }));

    component.set('displayName', '  New Name  ');
    component.set('visibility', 'public');
    component.set('vanitySubdomainEnabled', true);
    await component.save();

    expect(profiles.save).toHaveBeenCalledWith(jasmine.objectContaining({
      displayName: 'New Name', visibility: 'public', vanitySubdomainEnabled: true,
    }));
    expect(component.model().visibility).toBe('public');
  });

  describe('screenReaderName', () => {
    it('default-fills the screen-reader name from an ASCII display name', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      // Existing SRN tracked the old ASCII display name ('Alex'), so it re-tracks.
      component.setDisplayName('Bobby');
      expect(component.model().screenReaderName).toBe('Bobby');
      expect(component.needsScreenReaderName()).toBe(false);
    });

    it('PRESERVES a custom screen-reader name when the display name changes', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      // A deliberate custom SRN that does NOT mirror the display name: changing the
      // display name must NOT clobber it (srnTrackedOldDisplay=false, srnBlank=false).
      component.set('displayName', 'Alex');
      component.set('screenReaderName', 'Custom Reader');
      component.setDisplayName('Bobby');
      expect(component.model().displayName).toBe('Bobby');
      expect(component.model().screenReaderName).toBe('Custom Reader');
    });

    it('PROMPTS (does not auto-fill) when the display name is non-ASCII', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      component.setDisplayName('山田太郎');
      // No safe ASCII default -> field unchanged -> prompt is required.
      expect(component.needsScreenReaderName()).toBe(true);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const prompt = el.querySelector('[data-testid="profile-srn-prompt"]')!;
      expect(prompt.getAttribute('role')).toBe('alert');
    });

    it('blocks save until a non-ASCII display name has an ASCII screen-reader name', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      profiles.save.calls.reset();
      component.setDisplayName('José');
      component.set('screenReaderName', null);
      await component.save();
      expect(profiles.save).not.toHaveBeenCalled();
      expect(component.formError()).toContain('screen-reader name');

      // Supplying an ASCII screen-reader name unblocks the save.
      profiles.save.and.returnValue(of({ ...loaded, displayName: 'José', screenReaderName: 'Jose' }));
      component.set('screenReaderName', 'Jose');
      await component.save();
      expect(profiles.save).toHaveBeenCalledWith(
        jasmine.objectContaining({ displayName: 'José', screenReaderName: 'Jose' }),
      );
    });

    it('rejects a non-printable-ASCII screen-reader name before calling the BFF', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      profiles.save.calls.reset();
      component.set('displayName', 'Alex');
      component.set('screenReaderName', 'tab\there');
      await component.save();
      expect(profiles.save).not.toHaveBeenCalled();
      expect(component.formError()).toContain('printable ASCII');
    });

    it('previews the ASCII screen-reader name as the announced aria-label', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      component.set('displayName', '山田太郎');
      component.set('screenReaderName', 'Yamada Taro');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const preview = el.querySelector<HTMLElement>('[data-testid="profile-srn-preview"] strong')!;
      expect(preview.textContent).toContain('Yamada Taro');
      expect(preview.getAttribute('aria-label')).toBe('Yamada Taro');
    });
  });

  it('blocks save + announces an alert when display name is blank', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    profiles.save.calls.reset();

    component.set('displayName', '   ');
    await component.save();
    fixture.detectChanges();

    expect(profiles.save).not.toHaveBeenCalled();
    const el: HTMLElement = fixture.nativeElement;
    const alert = el.querySelector('[data-testid="profile-error"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(el.querySelector<HTMLInputElement>('#profile-displayName')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('POSTs a password change and clears the fields on success', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    profiles.changePassword.and.resolveTo({ op: 'password-change', status: 'submitted', casdoor: 'live' });

    component.oldPassword = 'old';
    component.newPassword = 'new';
    await component.changePassword();

    expect(profiles.changePassword).toHaveBeenCalledWith('old', 'new');
    expect(component.oldPassword).toBe('');
    expect(component.newPassword).toBe('');
    expect(component.passwordMessage()).toContain('submitted');
  });

  it('requires both passwords before calling the BFF', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    profiles.changePassword.calls.reset();
    component.oldPassword = '';
    component.newPassword = 'new';
    await component.changePassword();
    expect(profiles.changePassword).not.toHaveBeenCalled();
    expect(component.passwordMessage()).toContain('required');
  });

  it('POSTs a trimmed email change and clears the field on success', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    profiles.changeEmail.and.resolveTo({ op: 'email-change', status: 'queued', casdoor: 'stubbed' });

    component.newEmail = '  new@example.com ';
    await component.changeEmail();

    expect(profiles.changeEmail).toHaveBeenCalledWith('new@example.com');
    expect(component.newEmail).toBe('');
    expect(component.emailMessage()).toContain('queued');
  });

  it('surfaces a friendly message when profile load fails', async () => {
    profiles.load.and.returnValue(throwError(() => new Error('boom')));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.statusMessage()).toContain('Could not load');
  });

  describe('accessibility', () => {
    it('associates each profile input with a <label for>', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      for (const id of [
        'profile-displayName', 'profile-screenReaderName', 'profile-pronouns', 'profile-gender',
        'profile-timezone', 'profile-visibility', 'profile-vanity',
        'profile-oldPassword', 'profile-newPassword', 'profile-newEmail',
      ]) {
        expect(el.querySelector(`#${id}`)).withContext(`#${id}`).not.toBeNull();
        expect(el.querySelector(`label[for="${id}"]`)).withContext(`label for #${id}`).not.toBeNull();
      }
    });

    it('wires every control to visible help text via aria-describedby', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      // Each control -> the help id it MUST reference (and that id must exist + be non-empty).
      const wiring: Record<string, string> = {
        'profile-displayName': 'profile-displayName-help',
        'profile-pronouns': 'profile-pronouns-help',
        'profile-gender': 'profile-gender-help',
        'profile-timezone': 'profile-timezone-help',
        'profile-visibility': 'profile-visibility-help',
        'profile-vanity': 'profile-vanity-help',
        'profile-save': 'profile-save-help',
        'profile-newEmail': 'profile-email-help',
      };
      for (const [control, helpId] of Object.entries(wiring)) {
        const ctrl = el.querySelector(`[data-testid="${control}"]`)!;
        expect(ctrl.getAttribute('aria-describedby'))
          .withContext(`${control} aria-describedby`)
          .toContain(helpId);
        const help = el.querySelector(`#${helpId}`);
        expect(help).withContext(`#${helpId} target exists`).not.toBeNull();
        expect((help!.textContent ?? '').trim().length).withContext(`#${helpId} non-empty`).toBeGreaterThan(0);
      }
      // The password fields share one help id; assert both reference it and it exists.
      const pwHelp = el.querySelector('#profile-password-help');
      expect(pwHelp).not.toBeNull();
      expect((pwHelp!.textContent ?? '').trim().length).toBeGreaterThan(0);
      for (const id of ['profile-oldPassword', 'profile-newPassword']) {
        expect(el.querySelector(`#${id}`)!.getAttribute('aria-describedby'))
          .withContext(`${id} describedby`)
          .toContain('profile-password-help');
      }
    });
  });
});

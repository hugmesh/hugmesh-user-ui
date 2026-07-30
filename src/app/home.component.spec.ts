import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HomeComponent } from './home.component';
import { UserProfileService } from './user-profile.service';

describe('HomeComponent', () => {
  let fixture: ComponentFixture<HomeComponent>;
  let component: HomeComponent;
  let profiles: jasmine.SpyObj<UserProfileService>;

  function setup() {
    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
  }

  beforeEach(() => {
    profiles = jasmine.createSpyObj<UserProfileService>('UserProfileService', [
      'loadHomeGuide', 'dismissHomeGuide', 'resetHomeGuide',
    ]);
    TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [{ provide: UserProfileService, useValue: profiles }],
    });
  });

  it('shows the getting-started guide on first visit (not dismissed)', async () => {
    profiles.loadHomeGuide.and.returnValue(of({ guide: 'home', dismissed: false }));
    setup();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.dismissed()).toBeFalse();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="home-guide"]')).not.toBeNull();
  });

  it('hides the guide when the preference says it was dismissed', async () => {
    profiles.loadHomeGuide.and.returnValue(of({ guide: 'home', dismissed: true }));
    setup();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="home-guide"]')).toBeNull();
    expect(el.querySelector('[data-testid="home-dismissed-note"]')).not.toBeNull();
  });

  it('fails OPEN (shows the guide) when the preference load errors', async () => {
    profiles.loadHomeGuide.and.returnValue(throwError(() => new Error('boom')));
    setup();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.dismissed()).toBeFalse();
  });

  it('"don\'t show again" dismisses via the BFF and hides the guide', async () => {
    profiles.loadHomeGuide.and.returnValue(of({ guide: 'home', dismissed: false }));
    profiles.dismissHomeGuide.and.returnValue(of({ guide: 'home', dismissed: true }));
    setup();
    fixture.detectChanges();
    await fixture.whenStable();

    await component.dismiss();
    fixture.detectChanges();
    expect(profiles.dismissHomeGuide).toHaveBeenCalled();
    expect(component.dismissed()).toBeTrue();
  });

  it('re-shows the guide via the BFF when asked', async () => {
    profiles.loadHomeGuide.and.returnValue(of({ guide: 'home', dismissed: true }));
    profiles.resetHomeGuide.and.returnValue(of({ guide: 'home', dismissed: false }));
    setup();
    fixture.detectChanges();
    await fixture.whenStable();

    await component.showAgain();
    expect(profiles.resetHomeGuide).toHaveBeenCalled();
    expect(component.dismissed()).toBeFalse();
  });

  describe('accessibility', () => {
    it('labels the view + guide region and exposes a polite status live region', async () => {
      profiles.loadHomeGuide.and.returnValue(of({ guide: 'home', dismissed: false }));
      setup();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[aria-labelledby="home-heading"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="home-guide"]')!.getAttribute('role')).toBe('region');
      const status = el.querySelector('[data-testid="home-status"]')!;
      expect(status.getAttribute('role')).toBe('status');
      expect(status.getAttribute('aria-live')).toBe('polite');
    });

    it('wires the dismiss control to visible help text via aria-describedby', async () => {
      profiles.loadHomeGuide.and.returnValue(of({ guide: 'home', dismissed: false }));
      setup();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const dismiss = el.querySelector('[data-testid="home-dismiss"]')!;
      expect(dismiss.getAttribute('aria-describedby')).toContain('home-dismiss-help');
      const help = el.querySelector('#home-dismiss-help');
      expect(help).not.toBeNull();
      expect((help!.textContent ?? '').trim().length).toBeGreaterThan(0);
    });
  });
});

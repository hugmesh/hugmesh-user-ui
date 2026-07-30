import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { SelfSilenceComponent } from './self-silence.component';
import { SelfSilence, SelfSilenceService } from './self-silence.service';

describe('SelfSilenceComponent', () => {
  let fixture: ComponentFixture<SelfSilenceComponent>;
  let component: SelfSilenceComponent;
  let silence: jasmine.SpyObj<SelfSilenceService>;

  const future = new Date(Date.now() + 3_600_000).toISOString();
  const activeSilence: SelfSilence = { userId: 'sub-1', expiresAt: future, clearedAt: null };

  beforeEach(async () => {
    silence = jasmine.createSpyObj<SelfSilenceService>('SelfSilenceService', [
      'status', 'activate', 'cancel', 'emailMod',
    ]);
    silence.status.and.returnValue(of(null));
    await TestBed.configureTestingModule({
      imports: [SelfSilenceComponent],
      providers: [{ provide: SelfSilenceService, useValue: silence }],
    }).compileComponents();
    fixture = TestBed.createComponent(SelfSilenceComponent);
    component = fixture.componentInstance;
  });

  it('loads my self-silence status on init', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    expect(silence.status).toHaveBeenCalledTimes(1);
    expect(component.active()).toBe(false);
  });

  it('activates a future self-silence (converting local time to ISO) and refreshes', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    silence.activate.and.returnValue(of(activeSilence));
    // datetime-local strings have no timezone; pick a far-future local value.
    component.until = '2999-01-01T12:00';
    component.reason = '  break ';
    await component.activate();

    expect(silence.activate).toHaveBeenCalledTimes(1);
    const [iso, reason] = silence.activate.calls.mostRecent().args;
    expect(new Date(iso).getTime()).toBeGreaterThan(Date.now());
    expect(reason).toBe('break');
    expect(component.active()).toBe(true);
  });

  it('rejects a past/empty end time with a role=alert before calling the BFF', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    silence.activate.calls.reset();

    component.until = '';
    await component.activate();
    expect(silence.activate).not.toHaveBeenCalled();
    expect(component.formError()).toContain('Choose when');

    component.until = '2000-01-01T00:00';
    await component.activate();
    expect(silence.activate).not.toHaveBeenCalled();
    expect(component.formError()).toContain('future');

    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="self-silence-error"]')!.getAttribute('role')).toBe('alert');
  });

  describe('while already silenced', () => {
    beforeEach(async () => {
      silence.status.and.returnValue(of(activeSilence));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    });

    it('shows the auto-clear wake window readback', () => {
      const el: HTMLElement = fixture.nativeElement;
      const readback = el.querySelector('[data-testid="self-silence-active"]')!;
      expect(readback.getAttribute('role')).toBe('status');
      expect(el.querySelector('[data-testid="self-silence-wake"]')!.textContent).toContain(
        'auto-reactivates',
      );
    });

    it('aria-DISABLES the activate control (focusable) with announced helptext', () => {
      const el: HTMLElement = fixture.nativeElement;
      const activateBtn = el.querySelector<HTMLButtonElement>('[data-testid="self-silence-activate"]')!;
      // NOT natively disabled — it must stay focusable so AT users reach + hear
      // the helptext. busy() is false here, so the native disabled stays off.
      expect(activateBtn.disabled).toBe(false);
      expect(activateBtn.getAttribute('aria-disabled')).toBe('true');
      const helpId = activateBtn.getAttribute('aria-describedby')!;
      expect(el.querySelector(`#${helpId}`)!.textContent).toContain('already hidden');
    });

    it('guards activate() at the method level (no BFF call while already silenced)', async () => {
      // Defence-in-depth behind the aria-disabled button: even a programmatic
      // activate() must be a no-op while a silence is already active.
      silence.activate.calls.reset();
      component.until = '2999-01-01T12:00';
      await component.activate();
      expect(silence.activate).not.toHaveBeenCalled();
    });

    it('cancels the active silence (un-hide now)', async () => {
      silence.cancel.and.returnValue(of(void 0));
      await component.cancel();
      expect(silence.cancel).toHaveBeenCalledTimes(1);
      expect(component.active()).toBe(false);
    });

    it('emails a moderator to restore sooner (self-silence-appeal write)', async () => {
      silence.emailMod.and.returnValue(of({ status: 'queued', kind: 'self-silence-appeal', federation: {} }));
      component.reason = 'please';
      await component.emailMod();
      expect(silence.emailMod).toHaveBeenCalledWith('please');
      expect(component.statusMessage()).toContain('moderator');
    });

    // WCAG 2.1.1 (Keyboard): the un-hide + email-moderator actions are real
    // <button>s, so they are Tab-reachable and Enter/Space actuate them. Activating
    // un-hide (the click a keyboard press dispatches) runs cancel().
    it('the un-hide action is a Tab-reachable button that cancels when activated (Enter/Space path)', async () => {
      silence.cancel.and.returnValue(of(void 0));
      const el: HTMLElement = fixture.nativeElement;
      const cancelBtn = el.querySelector<HTMLButtonElement>('[data-testid="self-silence-cancel"]')!;
      expect(cancelBtn.tagName.toLowerCase()).toBe('button');
      expect(cancelBtn.disabled).withContext('not natively disabled (busy is false)').toBe(false);
      const ti = cancelBtn.getAttribute('tabindex');
      expect(ti === null || Number(ti) >= 0).withContext('reachable by Tab').toBe(true);
      cancelBtn.click();
      await fixture.whenStable();
      expect(silence.cancel).toHaveBeenCalledTimes(1);
    });
  });

  it('surfaces a friendly message when activate fails', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    silence.activate.and.returnValue(throwError(() => new Error('boom')));
    component.until = '2999-01-01T12:00';
    await component.activate();
    expect(component.statusMessage()).toContain('Could not activate');
  });

  describe('accessibility', () => {
    it('labels the inputs and announces status politely', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      for (const id of ['self-silence-until', 'self-silence-reason']) {
        expect(el.querySelector(`label[for="${id}"]`)).withContext(`label for #${id}`).not.toBeNull();
      }
      expect(el.querySelector('[data-testid="self-silence-status"]')!.getAttribute('aria-live')).toBe(
        'polite',
      );
    });

    it('wires the until + reason fields to visible help text', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const wiring: Record<string, string> = {
        'self-silence-until': 'self-silence-until-help',
        'self-silence-reason': 'self-silence-reason-help',
      };
      for (const [control, helpId] of Object.entries(wiring)) {
        const ctrl = el.querySelector(`[data-testid="${control}"]`)!;
        expect(ctrl.getAttribute('aria-describedby'))
          .withContext(`${control} aria-describedby`)
          .toContain(helpId);
        const help = el.querySelector(`#${helpId}`);
        expect(help).withContext(`#${helpId}`).not.toBeNull();
        expect((help!.textContent ?? '').trim().length).toBeGreaterThan(0);
      }
    });

    it('wires the un-hide + email-moderator actions to visible help text (while silenced)', async () => {
      silence.status.and.returnValue(of(activeSilence));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const wiring: Record<string, string> = {
        'self-silence-cancel': 'self-silence-cancel-help',
        'self-silence-email-mod': 'self-silence-email-mod-help',
      };
      for (const [control, helpId] of Object.entries(wiring)) {
        const ctrl = el.querySelector(`[data-testid="${control}"]`)!;
        expect(ctrl.getAttribute('aria-describedby'))
          .withContext(`${control} aria-describedby`)
          .toContain(helpId);
        const help = el.querySelector(`#${helpId}`);
        expect(help).withContext(`#${helpId}`).not.toBeNull();
        expect((help!.textContent ?? '').trim().length).toBeGreaterThan(0);
      }
    });
  });
});

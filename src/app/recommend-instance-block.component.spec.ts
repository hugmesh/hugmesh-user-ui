import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { RecommendInstanceBlockComponent } from './recommend-instance-block.component';
import { BlockService } from './block.service';

describe('RecommendInstanceBlockComponent', () => {
  let fixture: ComponentFixture<RecommendInstanceBlockComponent>;
  let component: RecommendInstanceBlockComponent;
  let blocks: jasmine.SpyObj<BlockService>;

  /** Seed the `hug.session` the (root) SessionService reads, so the platform-role
   *  gate signal (`hasPlatformRole`) resolves deterministically for a test. Must
   *  run BEFORE the component is created (SessionService.load() reads it at
   *  injection time). */
  function seedRoles(roles: string[]): void {
    localStorage.setItem(
      'hug.session',
      JSON.stringify({
        id: 'google:e2e@example.test',
        label: 'e2e',
        provider: 'google',
        roles,
        registrationComplete: true,
      }),
    );
  }

  async function createWith(roles: string[]): Promise<void> {
    seedRoles(roles);
    blocks = jasmine.createSpyObj<BlockService>('BlockService', ['recommendInstanceBlock']);
    await TestBed.configureTestingModule({
      imports: [RecommendInstanceBlockComponent],
      providers: [{ provide: BlockService, useValue: blocks }],
    }).compileComponents();
    fixture = TestBed.createComponent(RecommendInstanceBlockComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => {
    localStorage.removeItem('hug.session');
  });

  beforeEach(async () => {
    // Default: a Matrix platform-role holder, so the form is usable and the
    // existing submit/validation tests exercise the real POST path.
    await createWith(['user', 'matrix']);
  });

  it('POSTs a trimmed {instance,reason} recommendation and clears the form on success', async () => {
    blocks.recommendInstanceBlock.and.returnValue(of({ recommended: true, instance: 'bad.example', federation: {} }));
    component.instance = '  bad.example ';
    component.reason = '  spam waves ';
    await component.submit();

    expect(blocks.recommendInstanceBlock).toHaveBeenCalledWith('bad.example', 'spam waves');
    expect(component.instance).toBe('');
    expect(component.reason).toBe('');
    expect(component.statusMessage()).toContain('Recommended');
  });

  it('blocks submit + announces an alert when the instance is blank', async () => {
    blocks.recommendInstanceBlock.calls.reset();
    component.instance = '   ';
    await component.submit();
    fixture.detectChanges();

    expect(blocks.recommendInstanceBlock).not.toHaveBeenCalled();
    const el: HTMLElement = fixture.nativeElement;
    const alert = el.querySelector('[data-testid="recommend-error"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(el.querySelector<HTMLInputElement>('#recommend-instance')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('surfaces a friendly message when the recommendation fails', async () => {
    blocks.recommendInstanceBlock.and.returnValue(throwError(() => new Error('boom')));
    component.instance = 'bad.example';
    await component.submit();
    expect(component.statusMessage()).toContain('Could not submit');
  });

  describe('accessibility', () => {
    it('associates the instance + reason fields with <label for>', () => {
      const el: HTMLElement = fixture.nativeElement;
      for (const id of ['recommend-instance', 'recommend-reason']) {
        expect(el.querySelector(`#${id}`)).withContext(`#${id}`).not.toBeNull();
        expect(el.querySelector(`label[for="${id}"]`)).withContext(`label for #${id}`).not.toBeNull();
      }
    });

    it('wires the instance, reason and submit controls to visible help text', () => {
      const el: HTMLElement = fixture.nativeElement;
      const wiring: Record<string, string> = {
        'recommend-instance': 'recommend-instance-help',
        'recommend-reason': 'recommend-reason-help',
        'recommend-submit': 'recommend-submit-help',
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

  describe('platform-role gate (no MATRIX/MASTODON role)', () => {
    // The outer beforeEach already instantiated the module with a Matrix role;
    // reset and rebuild as a plain user so the gate mirror is exercised.
    beforeEach(async () => {
      TestBed.resetTestingModule();
      await createWith(['user']);
    });

    it('disables submit + explains the gate, and never POSTs, for a plain user', async () => {
      const el: HTMLElement = fixture.nativeElement;

      // The submit control mirrors the BFF gate via aria-disabled (focusable +
      // announced), with the gate helptext associated for AT.
      const submit = el.querySelector('[data-testid="recommend-submit"]')!;
      expect(submit.getAttribute('aria-disabled')).toBe('true');
      expect(submit.getAttribute('aria-describedby')).toContain('recommend-gate-help');

      const gateHelp = el.querySelector('[data-testid="recommend-gate-help"]');
      expect(gateHelp).withContext('recommend-gate-help').not.toBeNull();
      expect((gateHelp!.textContent ?? '').trim().length).toBeGreaterThan(0);

      // Even a forced click / programmatic submit must not fire the request the
      // BFF would only 403 — submit() early-returns when the role is absent.
      component.instance = 'bad.example';
      await component.submit();
      expect(blocks.recommendInstanceBlock).not.toHaveBeenCalled();
    });
  });
});

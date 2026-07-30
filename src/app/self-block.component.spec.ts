import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { SelfBlockComponent } from './self-block.component';
import { BlockService, UserBlock } from './block.service';

describe('SelfBlockComponent', () => {
  let fixture: ComponentFixture<SelfBlockComponent>;
  let component: SelfBlockComponent;
  let blocks: jasmine.SpyObj<BlockService>;

  const block: UserBlock = {
    id: 'b1',
    userId: 'sub-1',
    target: '@spam:example.org',
    platform: 'matrix',
    ts: '2026-01-01T00:00:00Z',
  };

  beforeEach(async () => {
    blocks = jasmine.createSpyObj<BlockService>('BlockService', ['list', 'block', 'unblock', 'recommendInstanceBlock']);
    blocks.list.and.returnValue(of([block]));
    await TestBed.configureTestingModule({
      imports: [SelfBlockComponent],
      providers: [{ provide: BlockService, useValue: blocks }],
    }).compileComponents();
    fixture = TestBed.createComponent(SelfBlockComponent);
    component = fixture.componentInstance;
  });

  it('lists my self-blocks on init and renders a row per block', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(blocks.list).toHaveBeenCalled();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-block-id="b1"]')).not.toBeNull();
  });

  it('renders the matrix|mastodon|internal platform options', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const opts = Array.from(el.querySelectorAll('#self-block-platform option')).map((o) => o.getAttribute('value'));
    expect(opts).toEqual(['matrix', 'mastodon', 'internal']);
  });

  it('adds a trimmed self-block with the chosen platform and refreshes', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    blocks.block.and.returnValue(of({ block, pushed: false, external: 'stubbed' }));
    blocks.list.calls.reset();
    blocks.list.and.returnValue(of([block]));

    component.target = '  @spam:example.org ';
    component.platform = 'matrix';
    await component.add();

    expect(blocks.block).toHaveBeenCalledWith('@spam:example.org', 'matrix');
    expect(component.target).toBe('');
  });

  it('blocks add + announces an alert when the target is blank', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    blocks.block.calls.reset();
    component.target = '   ';
    await component.add();
    fixture.detectChanges();

    expect(blocks.block).not.toHaveBeenCalled();
    const el: HTMLElement = fixture.nativeElement;
    const alert = el.querySelector('[data-testid="self-block-error"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(el.querySelector<HTMLInputElement>('#self-block-target')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('removes a self-block by id through the service', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    blocks.unblock.and.returnValue(of(void 0));
    blocks.list.and.returnValue(of([]));
    await component.remove(block);
    expect(blocks.unblock).toHaveBeenCalledWith('b1');
  });

  describe('accessibility', () => {
    it('labels inputs and gives remove buttons a descriptive aria-label', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      for (const id of ['self-block-target', 'self-block-platform']) {
        expect(el.querySelector(`label[for="${id}"]`)).withContext(`label for #${id}`).not.toBeNull();
      }
      const btn = el.querySelector<HTMLButtonElement>('[data-remove="b1"]')!;
      expect(btn.getAttribute('aria-label')).toContain('@spam:example.org');
    });

    it('wires the target, platform and add controls to visible help text', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const wiring: Record<string, string> = {
        'self-block-target': 'self-block-target-help',
        'self-block-platform': 'self-block-platform-help',
        'self-block-add': 'self-block-add-help',
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

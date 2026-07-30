import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { CardsComponent } from './cards.component';
import { CardsService, UserModuleCard } from './cards.service';
import { OwncastService, MyStreamStatus } from './owncast.service';

describe('CardsComponent', () => {
  let fixture: ComponentFixture<CardsComponent>;
  let component: CardsComponent;
  let cards: jasmine.SpyObj<CardsService>;
  let owncast: jasmine.SpyObj<OwncastService>;

  const card: UserModuleCard = {
    id: 1,
    ownerUserId: 'sub-1',
    slug: 'my-card',
    versionDir: 'v1',
    contentHash: 'abc',
    manifestJson: '{}',
    visibility: 'internal',
    createdAt: '2026-01-01T00:00:00Z',
    supersededAt: null,
  };

  const activeStream: MyStreamStatus = {
    streamUrl: 'https://stream.example.com/hls/live.m3u8',
    visibility: 'public',
  };

  beforeEach(async () => {
    cards = jasmine.createSpyObj<CardsService>('CardsService', [
      'listMine',
      'listBySlug',
      'put',
      'readBody',
      'delete',
    ]);
    owncast = jasmine.createSpyObj<OwncastService>('OwncastService', ['myStream']);
    cards.listMine.and.returnValue(of([card]));
    cards.listBySlug.and.returnValue(of([card]));
    cards.readBody.and.returnValue(of('# Prior body\n\n/* @hugmesh-card-css */\nh1 { color: blue; }'));
    cards.delete.and.returnValue(of(void 0));
    // Default: no active stream grant.
    owncast.myStream.and.returnValue(throwError(() => Object.assign(new Error('Not Found'), { status: 404 })));
    await TestBed.configureTestingModule({
      imports: [CardsComponent],
      providers: [
        { provide: CardsService, useValue: cards },
        { provide: OwncastService, useValue: owncast },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CardsComponent);
    component = fixture.componentInstance;
  });

  it('lists my cards on init and renders a row per card', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(cards.listMine).toHaveBeenCalled();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-card-slug="my-card"]')).not.toBeNull();
  });

  it('embeds the sandboxed WYSIWYG card editor (not a plain textarea body)', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="cards-editor"]')).not.toBeNull();
    // The genesis plain-form entry-body textarea is gone.
    expect(el.querySelector('#cards-body')).toBeNull();
  });

  it('publishes the encoded editor source (markdown + scoped css) via CardsService.put', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    cards.put.and.returnValue(of(card));
    cards.listMine.calls.reset();
    cards.listMine.and.returnValue(of([card]));

    // Drive the embedded editor through the cards component's editor handle.
    component['editor']()!.setSource({ markdown: '# Hello', css: 'h1 { color: red; }' });
    component.slug = '  my-card ';
    component.entryFile = ' index.md ';
    component.visibility = 'public';
    await component.publish();

    expect(cards.put).toHaveBeenCalled();
    const [slug, body, opts] = cards.put.calls.mostRecent().args;
    expect(slug).toBe('my-card');
    expect(body).toContain('# Hello');
    expect(body).toContain('h1 { color: red; }');
    expect(opts).toEqual({ entryFile: 'index.md', visibility: 'public' });
    expect(component.slug).toBe('');
  });

  it('blocks publish + announces an alert when slug or body is blank', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    cards.put.calls.reset();

    component['editor']()!.setSource({ markdown: '', css: '' });
    component.slug = '';
    await component.publish();
    fixture.detectChanges();

    expect(cards.put).not.toHaveBeenCalled();
    const el: HTMLElement = fixture.nativeElement;
    const alert = el.querySelector('[data-testid="cards-error"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(component.formError()).toContain('required');
  });

  it('loads a card slug + pre-fills the editor with its decoded prior body when edited', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await component.edit(card);
    expect(component.slug).toBe('my-card');
    expect(component.visibility).toBe('internal');
    // Reads the OWNER-scoped body and decodes it into the editor (markdown + CSS).
    expect(cards.readBody).toHaveBeenCalledWith('my-card');
    const src = component['editor']()!.source();
    expect(src.markdown).toContain('# Prior body');
    expect(src.css).toContain('h1 { color: blue; }');
    expect(component.statusMessage()).toContain('new version');
  });

  it('opens the editor empty with a non-fatal status when the prior body read fails', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    cards.readBody.and.returnValue(throwError(() => new Error('boom')));
    await component.edit(card);
    expect(component.slug).toBe('my-card');
    expect(component['editor']()!.source().markdown).toBe('');
    expect(component.statusMessage()).toContain('could not load the prior body');
  });

  it('deletes my card via CardsService.delete and refreshes the list', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    cards.listMine.calls.reset();
    cards.listMine.and.returnValue(of([]));
    await component.remove(card);
    expect(cards.delete).toHaveBeenCalledWith('my-card');
    expect(cards.listMine).toHaveBeenCalled();
    expect(component.cards()).toEqual([]);
    expect(component.statusMessage()).toContain('deleted');
  });

  it('announces a failure status when delete fails (and does not crash)', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    cards.delete.and.returnValue(throwError(() => new Error('boom')));
    await component.remove(card);
    expect(component.statusMessage()).toContain('Could not delete');
  });

  it('tones the visible status line: failures carry .hug-error, successes do not', async () => {
    // The status line is rendered VISIBLY (it used to be .sr-only), and one
    // signal carries both outcomes — so without a tone flag the shared
    // .hug-status success colour would paint "Could not delete …" green.
    // Asserted on the real DOM classes, and BOTH ways: a test that only checked
    // the failure case would still pass if every message were marked an error.
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const statusEl = () =>
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="cards-status"]')!;

    cards.delete.and.returnValue(throwError(() => new Error('boom')));
    await component.remove(card);
    fixture.detectChanges();
    expect(component.statusIsError()).withContext('failed delete').toBeTrue();
    expect(statusEl().classList).toContain('hug-error');
    expect(statusEl().textContent).toContain('Could not delete');

    // The same region must drop the failure tone once an action succeeds.
    cards.delete.and.returnValue(of(void 0));
    await component.remove(card);
    fixture.detectChanges();
    expect(component.statusIsError()).withContext('successful delete').toBeFalse();
    expect(statusEl().classList).not.toContain('hug-error');
    expect(statusEl().textContent).toContain('deleted');
  });

  describe('sd-owncast-player publish gate (broadcast grant check)', () => {
    beforeEach(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    });

    it('does NOT call owncastService.myStream when card has no sd-owncast-player', async () => {
      cards.put.and.returnValue(of(card));
      component['editor']()!.setSource({ markdown: '<sd-callout>hi</sd-callout>', css: '' });
      component.slug = 'no-player';
      await component.publish();
      expect(owncast.myStream).not.toHaveBeenCalled();
    });

    it('blocks publish and sets formError when sd-owncast-player is present but no grant', async () => {
      // owncast.myStream throws (no grant) — set up in beforeEach.
      component['editor']()!.setSource({
        markdown: '<sd-owncast-player></sd-owncast-player>',
        css: '',
      });
      component.slug = 'live-card';
      await component.publish();
      expect(cards.put).not.toHaveBeenCalled();
      expect(component.formError()).toContain('broadcast grant');
      expect(component.owncastGrantState()).toBe('denied');
    });

    it('shows the helptext notice in the DOM when grant is denied', async () => {
      // Manually set the state to denied to test the template binding.
      component.owncastGrantState.set('denied');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const notice = el.querySelector('[data-testid="cards-owncast-no-grant"]')!;
      expect(notice).not.toBeNull();
      expect(notice.getAttribute('role')).toBe('note');
      expect((notice.textContent ?? '').toLowerCase()).toContain('broadcast grant');
    });

    it('disables the Publish button when grant is denied', async () => {
      component.owncastGrantState.set('denied');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const btn = el.querySelector<HTMLButtonElement>('[data-testid="cards-publish"]')!;
      expect(btn.disabled).toBe(true);
      // The button's aria-describedby must include the helptext element id.
      expect(btn.getAttribute('aria-describedby')).toContain('cards-owncast-no-grant');
    });

    it('allows publish when sd-owncast-player is present AND grant is active', async () => {
      owncast.myStream.and.returnValue(of(activeStream));
      cards.put.and.returnValue(of(card));
      component['editor']()!.setSource({
        markdown: '<sd-owncast-player></sd-owncast-player>',
        css: '',
      });
      component.slug = 'live-card';
      await component.publish();
      expect(owncast.myStream).toHaveBeenCalled();
      expect(cards.put).toHaveBeenCalled();
      expect(component.formError()).toBe('');
      expect(component.owncastGrantState()).toBe('unchecked'); // reset after publish
    });

    it('blocks publish when grant BFF returns a status without visibility (no active grant)', async () => {
      // BFF returns 200 but with null visibility — not an active grant.
      owncast.myStream.and.returnValue(of({ streamUrl: 'https://s.example/hls/live.m3u8', visibility: null }));
      component['editor']()!.setSource({
        markdown: '<sd-owncast-player></sd-owncast-player>',
        css: '',
      });
      component.slug = 'live-card';
      await component.publish();
      expect(cards.put).not.toHaveBeenCalled();
      expect(component.owncastGrantState()).toBe('denied');
    });
  });

  describe('accessibility', () => {
    it('associates the metadata fields with <label for> and gives edit buttons aria-labels', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      for (const id of ['cards-slug', 'cards-entryFile', 'cards-visibility']) {
        expect(el.querySelector(`#${id}`)).withContext(`#${id}`).not.toBeNull();
        expect(el.querySelector(`label[for="${id}"]`)).withContext(`label for #${id}`).not.toBeNull();
      }
      const btn = el.querySelector<HTMLButtonElement>('[data-edit="my-card"]')!;
      expect(btn.getAttribute('type')).toBe('button');
      expect(btn.getAttribute('aria-label')).toContain('my-card');
    });

    it('wires the slug, entry-file, visibility and publish controls to visible help text', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const wiring: Record<string, string> = {
        'cards-slug': 'cards-slug-help',
        'cards-entryFile': 'cards-entryFile-help',
        'cards-visibility': 'cards-visibility-help',
        'cards-publish': 'cards-publish-help',
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

    // WCAG 2.1.1 (Keyboard): the per-row edit/delete actions are real <button>s,
    // so they are Tab-reachable and Enter/Space activate them — no mouse-only
    // handler. Activating one (the same path a keyboard press dispatches) runs the
    // handler.
    it('per-row edit + delete are Tab-reachable buttons; activating delete (Enter/Space path) removes the card', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;

      const editBtn = el.querySelector<HTMLButtonElement>('[data-edit="my-card"]')!;
      const deleteBtn = el.querySelector<HTMLButtonElement>('[data-delete="my-card"]')!;
      for (const [btn, name] of [[editBtn, 'edit'], [deleteBtn, 'delete']] as const) {
        expect(btn.tagName.toLowerCase()).withContext(`${name} is a <button>`).toBe('button');
        expect(btn.disabled).withContext(`${name} not natively disabled`).toBe(false);
        const ti = btn.getAttribute('tabindex');
        expect(ti === null || Number(ti) >= 0)
          .withContext(`${name} reachable by Tab`)
          .toBe(true);
      }

      cards.listMine.calls.reset();
      cards.listMine.and.returnValue(of([]));
      deleteBtn.click(); // the click a keyboard Enter/Space dispatches on a button
      await fixture.whenStable();
      expect(cards.delete).toHaveBeenCalledWith('my-card');
    });
  });
});

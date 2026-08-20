import { ComponentFixture, TestBed, fakeAsync, flush } from '@angular/core/testing';
import { CardEditorComponent } from './card-editor.component';
import { decodeDocument, emptySection, encodeDocument } from './card-sections';
import { PROVIDED_TAGS } from './card-tags';

describe('CardEditorComponent (draggable section builder)', () => {
  let fixture: ComponentFixture<CardEditorComponent>;
  let component: CardEditorComponent;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CardEditorComponent] }).compileComponents();
    fixture = TestBed.createComponent(CardEditorComponent);
    component = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  /** The raw HTML the sandboxed iframe `srcdoc` is bound to (unwrap SafeHtml). */
  function previewHtml(): string {
    const safe = component.previewDoc() as { changingThisBreaksApplicationSecurity?: string };
    return String(safe.changingThisBreaksApplicationSecurity ?? component.previewDoc());
  }

  describe('sandboxed preview (security — unchanged two-wall guarantee)', () => {
    it('renders the preview in an iframe with an EMPTY sandbox (no scripts, no same-origin)', () => {
      const frame = el.querySelector<HTMLIFrameElement>('[data-testid="card-preview"]')!;
      expect(frame.tagName.toLowerCase()).toBe('iframe');
      const sandbox = frame.getAttribute('sandbox');
      expect(sandbox).toBe(''); // empty token list = maximal restriction
      expect((sandbox ?? '').toLowerCase()).not.toContain('allow-scripts');
      expect((sandbox ?? '').toLowerCase()).not.toContain('allow-same-origin');
    });

    it('neutralises a <script>/onerror host-escape attempt typed into a section', () => {
      component.onContentInput(0, '<script>alert(1)</script><img src=x onerror=alert(2)>');
      const doc = previewHtml();
      expect(doc.toLowerCase()).not.toMatch(/<script[\s>]/i);
      expect(doc).not.toContain('alert(1)');
      // The <img onerror> is stripped of its handler (no live on*= attribute).
      expect(doc.toLowerCase()).not.toContain('onerror=');
    });

    it('scopes user CSS so a host-escape rule cannot restyle the shell', () => {
      component.onCssInput('body { display: none; } .nav { color: red; }');
      const doc = previewHtml();
      expect(doc).toContain('.card-root { display: none; }');
      expect(doc).toContain('.card-root .nav {');
    });
  });

  describe('sections + draggable orientation', () => {
    it('starts with one section and can add more', () => {
      expect(component.sections().length).toBe(1);
      component.addSection();
      expect(component.sections().length).toBe(2);
    });

    it('REORDERS sections via move() — updates the model AND the serialised card body', () => {
      component.setDocument({
        sections: [
          { ...emptySection(), title: 'First', content: 'one' },
          { ...emptySection(), title: 'Second', content: 'two' },
        ],
        css: '',
      });
      expect(component.sections().map((s) => s.title)).toEqual(['First', 'Second']);

      component.move(0, 1); // drag First below Second
      expect(component.sections().map((s) => s.title)).toEqual(['Second', 'First']);

      // The serialised body reflects the new order (round-trips back the same way).
      const back = decodeDocument(encodeDocument(component.document()));
      expect(back.sections.map((s) => s.title)).toEqual(['Second', 'First']);
    });

    it('removing the last remaining section leaves one empty section (never zero)', () => {
      component.removeSection(0);
      expect(component.sections().length).toBe(1);
    });

    it('updates a section orientation (align + columns)', () => {
      component.onAlign(0, 'center');
      component.onColumns(0, 3);
      expect(component.sections()[0].layout).toEqual({ align: 'center', columns: 3 });
    });
  });

  describe('provided tags + MathTeX in the preview', () => {
    it('renders a provided <sd-math> tag to KaTeX, and STILL strips a <script>', () => {
      component.onContentInput(0, '<sd-math>a^2 + b^2</sd-math><script>alert(1)</script>');
      const doc = previewHtml();
      expect(doc).toContain('class="katex'); // KaTeX rendered the math
      expect(doc.toLowerCase()).toContain('<math'); // accessible MathML present
      expect(doc.toLowerCase()).not.toContain('<script'); // script still stripped
      expect(doc).not.toContain('alert(1)');
    });

    it('renders a provided <sd-callout> to safe class-tagged markup', () => {
      component.onContentInput(0, '<sd-callout tone="success">done</sd-callout>');
      const doc = previewHtml();
      expect(doc).toContain('class="sd-callout sd-tone-success"');
      expect(doc).toContain('done');
    });

    it('inserts a provided-tag snippet into the active section from the palette', () => {
      const math = PROVIDED_TAGS.find((t) => t.tag === 'sd-math')!;
      component.focusSection(0);
      component.insertTag(math);
      expect(component.sections()[0].content).toContain('<sd-math>');
    });
  });

  describe('accessibility', () => {
    it('exposes a keyboard-operable tag palette of real <button>s', () => {
      for (const t of PROVIDED_TAGS) {
        const btn = el.querySelector<HTMLButtonElement>(`[data-testid="palette-${t.tag}"]`)!;
        expect(btn).withContext(t.tag).not.toBeNull();
        expect(btn.tagName.toLowerCase()).toBe('button');
        expect(btn.getAttribute('type')).toBe('button');
        expect(btn.getAttribute('aria-label')).withContext(`${t.tag} label`).toBeTruthy();
      }
    });

    it('gives each section a drag handle button AND explicit Move up/down controls', () => {
      const handle = el.querySelector<HTMLButtonElement>('[data-testid="drag-0"]')!;
      expect(handle.tagName.toLowerCase()).toBe('button');
      expect(handle.getAttribute('aria-label')).toContain('Reorder');
      expect(el.querySelector('[data-testid="move-up-0"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="move-down-0"]')).not.toBeNull();
    });

    it('labels the section title/body fields and names the preview region', () => {
      expect(el.querySelector('label[for="sec-title-0"]')).not.toBeNull();
      expect(el.querySelector('label[for="sec-body-0"]')).not.toBeNull();
      const frame = el.querySelector('[data-testid="card-preview"]')!;
      expect(frame.getAttribute('title')).toBeTruthy();
      expect(frame.getAttribute('aria-labelledby')).toBe('card-preview-heading');
    });

    it('reflects alignment selection via aria-pressed', () => {
      component.onAlign(0, 'center');
      fixture.detectChanges();
      const btn = el.querySelector<HTMLButtonElement>('[data-testid="align-center-0"]')!;
      expect(btn.getAttribute('aria-pressed')).toBe('true');
    });
  });

  // WCAG 2.1.1 (Keyboard): every reorder/add/remove/palette control is a real
  // <button>, so Enter/Space actuate it natively — these tests assert each is
  // FOCUSABLE (in tab order, not natively disabled when it should be live) and
  // that activating it (the same path a keyboard Enter/Space dispatches) runs the
  // handler. No (keydown) shim is needed precisely because they are real buttons.
  describe('keyboard operability (WCAG 2.1.1)', () => {
    /** A native <button> is keyboard-actuatable iff it is focusable (not disabled
     *  and no negative tabindex); native buttons are tabbable with tabindex unset. */
    function assertKeyboardActuatable(btn: HTMLButtonElement, context: string): void {
      expect(btn.tagName.toLowerCase()).withContext(`${context} is a <button>`).toBe('button');
      expect(btn.disabled).withContext(`${context} not natively disabled`).toBe(false);
      const ti = btn.getAttribute('tabindex');
      expect(ti === null || Number(ti) >= 0)
        .withContext(`${context} reachable by Tab (no negative tabindex)`)
        .toBe(true);
    }

    it('Add section + palette + per-section controls are all Tab-reachable buttons', () => {
      assertKeyboardActuatable(
        el.querySelector<HTMLButtonElement>('[data-testid="add-section"]')!,
        'Add section',
      );
      assertKeyboardActuatable(
        el.querySelector<HTMLButtonElement>('[data-testid="drag-0"]')!,
        'Drag handle',
      );
      assertKeyboardActuatable(
        el.querySelector<HTMLButtonElement>('[data-testid="remove-0"]')!,
        'Remove section',
      );
      const firstPalette = el.querySelector<HTMLButtonElement>(
        `[data-testid="palette-${PROVIDED_TAGS[0].tag}"]`,
      )!;
      assertKeyboardActuatable(firstPalette, `Palette ${PROVIDED_TAGS[0].tag}`);
    });

    it('activating Move down via the button (the Enter/Space path) reorders the section', () => {
      component.setDocument({
        sections: [
          { ...emptySection(), title: 'First', content: 'one' },
          { ...emptySection(), title: 'Second', content: 'two' },
        ],
        css: '',
      });
      fixture.detectChanges();
      // A keyboard Enter/Space on a native <button> dispatches a click; assert that
      // path drives the reorder (and that the boundary control is correctly disabled).
      const moveDown0 = el.querySelector<HTMLButtonElement>('[data-testid="move-down-0"]')!;
      assertKeyboardActuatable(moveDown0, 'Move down section 1');
      moveDown0.click();
      fixture.detectChanges();
      expect(component.sections().map((s) => s.title)).toEqual(['Second', 'First']);
    });

    it('disables the boundary Move controls so keyboard focus skips no-op directions', () => {
      // Move-up on the first section + Move-down on the last are no-ops: they are
      // natively disabled (announced + removed from the actuation set), not silent.
      const moveUp0 = el.querySelector<HTMLButtonElement>('[data-testid="move-up-0"]')!;
      expect(moveUp0.disabled).withContext('Move-up disabled at top').toBe(true);
    });

    it('activating a palette button (Enter/Space path) inserts the snippet into the focused section', () => {
      component.focusSection(0);
      const math = PROVIDED_TAGS.find((t) => t.tag === 'sd-math')!;
      const btn = el.querySelector<HTMLButtonElement>('[data-testid="palette-sd-math"]')!;
      assertKeyboardActuatable(btn, `Palette ${math.tag}`);
      btn.click();
      fixture.detectChanges();
      expect(component.sections()[0].content).toContain('<sd-math>');
    });
  });

  describe('document API round-trip', () => {
    it('document()/setDocument() expose and seed the section state', () => {
      const doc = {
        sections: [{ ...emptySection(), title: 'T', content: 'C', layout: { align: 'right' as const, columns: 2 as const } }],
        css: '.card-root h1 { color: red; }',
      };
      component.setDocument(doc);
      const back = component.document();
      expect(back.sections[0].title).toBe('T');
      expect(back.sections[0].content).toBe('C');
      expect(back.sections[0].layout).toEqual({ align: 'right', columns: 2 });
      expect(back.css).toBe('.card-root h1 { color: red; }');
    });

    it('legacy setSource()/source() still work (single-section bridge)', () => {
      component.setSource({ markdown: 'legacy body', css: 'c' });
      expect(component.source().markdown).toContain('legacy body');
      expect(component.source().css).toBe('c');
    });
  });

  describe('CDK drag preview styling (overlay lives outside the component subtree)', () => {
    /**
     * CDK builds the drag preview by DEEP-CLONING the dragged root element and
     * appending the clone to `document.body` (top layer, via the popover API) —
     * outside this component's DOM subtree. Emulated view encapsulation is
     * ATTRIBUTE-based, not position-based, so the clone carries the same
     * `_ngcontent-*` attribute and the component's `.section-card` /
     * `.cdk-drag-preview` rules keep matching, while the `--hug-*` theme tokens
     * reach it by normal inheritance from `:root` (supplied by src/styles.scss
     * standalone, and by the host shell once federated).
     *
     * That is an implementation detail of CDK, so it is pinned here: if a CDK
     * bump ever wrapped the preview or rebuilt it from a template instead, the
     * drop-shadow polish would silently stop applying and this would fail.
     */
    function startDrag(): HTMLElement | null {
      const card = el.querySelector<HTMLElement>('.section-card')!;
      const handle = el.querySelector<HTMLElement>('[data-testid="drag-0"]')!;
      const at = card.getBoundingClientRect();
      // `buttons`/`detail` must be non-zero: CDK ignores a mousedown with
      // neither as a synthetic screen-reader click and never starts a drag.
      const send = (type: string, target: EventTarget, x: number, y: number) =>
        target.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, detail: 1,
          }),
        );
      send('mousedown', handle, at.left + 5, at.top + 5);
      send('mousemove', document, at.left + 40, at.top + 60); // past dragStartThreshold
      return document.querySelector<HTMLElement>('.cdk-drag-preview');
    }

    /**
     * Release the pointer AND drain CDK's drop animation. `.cdk-drag-animating`
     * gives the preview a 200ms transform transition, so CDK only runs
     * `_cleanupDragArtifacts` on a timer after the drop — without flushing it
     * that cleanup lands after the fixture is destroyed and CDK throws on a
     * null root element.
     */
    function endDrag() {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      flush();
    }

    beforeEach(() => {
      component.sections.set([
        { ...emptySection(), title: 'First' },
        { ...emptySection(), title: 'Second' },
      ]);
      fixture.detectChanges();
    });

    it('appends the preview outside the component subtree but keeps its encapsulation attribute', fakeAsync(() => {
      const preview = startDrag();
      expect(preview).withContext('CDK did not create a drag preview').toBeTruthy();
      expect(el.contains(preview!)).toBe(false); // genuinely outside this component's DOM
      const card = el.querySelector<HTMLElement>('.section-card')!;
      const ngContent = card.getAttributeNames().find((a) => a.startsWith('_ngcontent-'));
      expect(ngContent).withContext('component is not emulated-encapsulated').toBeTruthy();
      expect(preview!.hasAttribute(ngContent!)).toBe(true);
      endDrag();
    }));

    it('applies the drop-shadow polish and matches the in-list card chrome', fakeAsync(() => {
      const card = el.querySelector<HTMLElement>('.section-card')!;
      const cardStyle = getComputedStyle(card);
      const preview = startDrag();
      const style = getComputedStyle(preview!);
      // The .cdk-drag-preview rule's own polish actually lands...
      expect(style.boxShadow).not.toBe('none');
      // ...and the shared .section-card chrome is not lost on the way to body,
      // including the --hug-* tokens it resolves by inheritance.
      expect(style.backgroundColor).toBe(cardStyle.backgroundColor);
      expect(style.borderTopColor).toBe(cardStyle.borderTopColor);
      expect(style.borderTopWidth).toBe(cardStyle.borderTopWidth);
      expect(style.borderRadius).toBe(cardStyle.borderRadius);
      expect(style.padding).toBe(cardStyle.padding);
      endDrag();
    }));
  });
});

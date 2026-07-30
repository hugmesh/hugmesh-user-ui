import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { buildCardPreview } from './card-sanitize';
import {
  CardDocument,
  CardSection,
  decodeDocument,
  emptySection,
  encodeDocument,
} from './card-sections';
import { ALIGNMENTS, Alignment, PROVIDED_TAGS, ProvidedTag } from './card-tags';

/**
 * Back-compat shape: the genesis editor persisted a `{ markdown, css }` source.
 * The section editor persists a `CardDocument`. The component's own
 * {@link CardEditorComponent.source} / {@link CardEditorComponent.setSource}
 * keep the old shape working for any caller that still speaks it — they wrap
 * the v2 document codec, treating the markdown as a single section's content.
 * New callers should use the document API below.
 */
export interface CardSource {
  markdown: string;
  css: string;
}

/**
 * Draggable, section-based WYSIWYG card editor (replaces the single-textarea
 * markdown editor). The card is an ORDERED list of sections the author can add,
 * remove, and REORDER by drag-and-drop (Angular CDK — keyboard-accessible: the
 * drag handle is a real button, and the list also offers explicit Move-up /
 * Move-down controls so keyboard and AT users can reorder without a pointer).
 * Each section has a title, a body (HTML using the PROVIDED `sd-*` tags +
 * MathTeX), and an orientation (alignment + column count). A tag PALETTE lists
 * the sanctioned tags and inserts a starter snippet into the focused section.
 *
 * SANDBOXING (unchanged guarantees) — see {@link buildCardPreview} +
 * card-sanitize: every section's content is rendered through the safe pipeline
 * (provided-tag lowering + KaTeX pre-render + allow-list sanitiser) and the whole
 * document is dropped into a `<iframe sandbox>` with NO `allow-scripts` and NO
 * `allow-same-origin` — a null-origin, script-disabled frame. KaTeX math is
 * PRE-RENDERED to static HTML+MathML (no runtime script in the sandbox); its
 * structural CSS is inlined and scoped to `.card-root`.
 */
@Component({
  selector: 'hug-user-card-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule],
  templateUrl: './card-editor.component.html',
  styleUrl: './card-editor.component.scss',
})
export class CardEditorComponent {
  private readonly sanitizer = inject(DomSanitizer);

  /** The section <textarea>s, keyed by index, for snippet insertion + focus. */
  private readonly bodyAreas = viewChild('bodyAreas', { read: ElementRef });

  /** The ordered card sections (the drag-drop model). */
  readonly sections = signal<CardSection[]>([emptySection()]);
  /** Optional user style block, scoped to `.card-root` in the preview. */
  readonly userCss = signal('');
  /** Index of the section the tag palette inserts into (last focused). */
  readonly activeSection = signal(0);

  /** Orientation choices surfaced to the template. */
  readonly alignments = ALIGNMENTS;
  readonly columnChoices = [1, 2, 3, 4] as const;
  /** The provided-tag catalogue for the palette/help. */
  readonly providedTags: readonly ProvidedTag[] = PROVIDED_TAGS;

  /**
   * The sandboxed preview document (iframe `srcdoc`). Recomputed from the
   * sanitised sections + scoped CSS — it never contains script and is bound with
   * bypassSecurityTrustHtml ONLY because Angular strips `srcdoc` otherwise; the
   * content is already neutralised and the iframe sandbox is the hard wall.
   */
  readonly previewDoc = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(buildCardPreview(this.sections(), this.userCss())),
  );

  // ---- Section CRUD + reorder -------------------------------------------------

  addSection(): void {
    this.sections.update((list) => [...list, emptySection()]);
    this.activeSection.set(this.sections().length - 1);
  }

  removeSection(index: number): void {
    this.sections.update((list) => list.filter((_, i) => i !== index));
    if (this.sections().length === 0) this.sections.set([emptySection()]);
    this.activeSection.set(Math.max(0, Math.min(index, this.sections().length - 1)));
  }

  /** CDK drag-drop reorder (pointer + keyboard via cdkDrag handle). */
  drop(event: CdkDragDrop<CardSection[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    this.sections.update((list) => {
      const next = list.slice();
      moveItemInArray(next, event.previousIndex, event.currentIndex);
      return next;
    });
  }

  /** Explicit keyboard/AT reorder (Move up / Move down buttons). */
  move(index: number, delta: -1 | 1): void {
    const to = index + delta;
    if (to < 0 || to >= this.sections().length) return;
    this.sections.update((list) => {
      const next = list.slice();
      moveItemInArray(next, index, to);
      return next;
    });
  }

  // ---- Per-section field edits ------------------------------------------------

  onTitleInput(index: number, value: string): void {
    this.patch(index, (s) => ({ ...s, title: value }));
  }

  onContentInput(index: number, value: string): void {
    this.patch(index, (s) => ({ ...s, content: value }));
  }

  onAlign(index: number, align: Alignment): void {
    this.patch(index, (s) => ({ ...s, layout: { ...s.layout, align } }));
  }

  onColumns(index: number, columns: number): void {
    const cols = (columns === 2 || columns === 3 || columns === 4 ? columns : 1) as 1 | 2 | 3 | 4;
    this.patch(index, (s) => ({ ...s, layout: { ...s.layout, columns: cols } }));
  }

  onCssInput(value: string): void {
    this.userCss.set(value);
  }

  /** Remember which section is focused so the palette inserts into the right one. */
  focusSection(index: number): void {
    this.activeSection.set(index);
  }

  /**
   * Insert a provided-tag starter snippet into the active section's content at
   * the caret (or appended), then refocus the textarea. Keyboard-operable: the
   * palette entries are real <button>s.
   */
  insertTag(tag: ProvidedTag): void {
    const index = Math.min(this.activeSection(), this.sections().length - 1);
    const section = this.sections()[index];
    if (!section) return;
    const ta = this.textareaAt(index);
    const current = section.content ?? '';
    const snippet = tag.snippet;
    if (!ta) {
      this.onContentInput(index, current ? `${current}\n${snippet}` : snippet);
      return;
    }
    const start = ta.selectionStart ?? current.length;
    const end = ta.selectionEnd ?? current.length;
    const next = current.slice(0, start) + snippet + current.slice(end);
    this.onContentInput(index, next);
    queueMicrotask(() => {
      ta.focus();
      const caret = start + snippet.length;
      ta.setSelectionRange(caret, caret);
    });
  }

  // ---- Document API (used by the parent CardsComponent) -----------------------

  /** Current editor document (sections + CSS) for the parent to persist. */
  document(): CardDocument {
    return { sections: this.sections(), css: this.userCss() };
  }

  /** Seed the editor from a stored document (used when editing an existing card). */
  setDocument(doc: CardDocument): void {
    this.sections.set(doc.sections.length ? doc.sections : [emptySection()]);
    this.userCss.set(doc.css ?? '');
    this.activeSection.set(0);
  }

  // ---- Back-compat source API (legacy {markdown, css}) ------------------------

  /** Legacy source view — first section's content as markdown + the CSS. */
  source(): CardSource {
    return { markdown: this.sections().map((s) => s.content).join('\n\n'), css: this.userCss() };
  }

  /** Seed from a legacy source (single section). */
  setSource(src: CardSource): void {
    this.setDocument({
      sections: [{ ...emptySection(), content: src.markdown ?? '' }],
      css: src.css ?? '',
    });
  }

  // ---- internals --------------------------------------------------------------

  /** trackBy for the *ngFor over sections (stable across reorder). */
  trackSection(_i: number, s: CardSection): string {
    return s.id;
  }

  private patch(index: number, fn: (s: CardSection) => CardSection): void {
    this.sections.update((list) => list.map((s, i) => (i === index ? fn(s) : s)));
  }

  private textareaAt(index: number): HTMLTextAreaElement | null {
    const host = this.bodyAreas()?.nativeElement as HTMLElement | undefined;
    if (!host) return null;
    return host.querySelectorAll<HTMLTextAreaElement>('textarea.section-body').item(index) ?? null;
  }
}

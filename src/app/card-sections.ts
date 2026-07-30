/**
 * The SECTION MODEL for the card builder: a card is an ORDERED list of sections
 * the author adds / removes / REORDERS by drag-and-drop, plus an optional scoped
 * CSS block. Each section carries its own content (HTML using the provided
 * `sd-*` tags + math) and an orientation/layout (alignment + column count).
 *
 * Serialisation round-trips LOSSLESSLY through the existing octet-stream card
 * body (CardsService.put / readBody) so re-opening a card restores the exact
 * section structure. The on-disk body is:
 *
 *     <!-- @hugmesh-card v2 -->
 *     {"sections":[ … ]}            ← one JSON line (the section model)
 *     /​* @hugmesh-card-css *​/    ← existing CSS fence (unchanged contract)
 *     .card-root h1 { … }            ← optional scoped user CSS
 *
 * A LEGACY body (no v2 marker) decodes to a SINGLE section holding the old
 * markdown, so previously-saved cards keep working. The CSS fence is reused
 * verbatim so the persisted-CSS half of the contract is untouched.
 */
import { Alignment } from './card-tags';

/** Layout/orientation of a single section's content. */
export interface SectionLayout {
  /** Horizontal orientation of the content within the section. */
  align: Alignment;
  /** Equal columns the section content is split into (1 = single column). */
  columns: 1 | 2 | 3 | 4;
}

/** One ordered, draggable section of a card. */
export interface CardSection {
  /** Stable id (for *ngFor trackBy + drag identity); not persisted meaningfully. */
  id: string;
  /** Optional heading shown above the section content. */
  title: string;
  /** Section body — HTML using the provided sd-* tags, markdown, and math. */
  content: string;
  layout: SectionLayout;
}

/** The full editor document: ordered sections + optional scoped CSS. */
export interface CardDocument {
  sections: CardSection[];
  css: string;
}

/** Marker line identifying the v2 (section) body format. */
const V2_MARKER = '<!-- @hugmesh-card v2 -->';
/** CSS fence — UNCHANGED from the genesis editor so the CSS contract is stable. */
const CSS_FENCE = '/* @hugmesh-card-css */';

let idCounter = 0;
/** Generate a process-unique section id (drag/track identity only). */
export function newSectionId(): string {
  return `sec-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

/** A fresh, empty section with sensible default orientation. */
export function emptySection(): CardSection {
  return { id: newSectionId(), title: '', content: '', layout: { align: 'left', columns: 1 } };
}

/** Normalise a possibly-partial layout from persisted JSON to a valid one. */
function normLayout(raw: Partial<SectionLayout> | undefined): SectionLayout {
  const align = (['left', 'center', 'right'] as const).includes(raw?.align as Alignment)
    ? (raw!.align as Alignment)
    : 'left';
  const cols = raw?.columns;
  const columns = cols === 2 || cols === 3 || cols === 4 ? cols : 1;
  return { align, columns };
}

/**
 * Serialise the section document to the single entry-file body persisted via
 * CardsService.put. Emits the v2 marker, a one-line JSON of the sections, then
 * (if any) the existing CSS fence + scoped CSS.
 */
export function encodeDocument(doc: CardDocument): string {
  const sections = doc.sections.map((s) => ({
    title: s.title ?? '',
    content: s.content ?? '',
    layout: normLayout(s.layout),
  }));
  const head = `${V2_MARKER}\n${JSON.stringify({ sections })}`;
  const css = (doc.css ?? '').trim();
  return css ? `${head}\n\n${CSS_FENCE}\n${css}` : head;
}

/**
 * Parse a stored body back into a {@link CardDocument}. A v2 body restores the
 * exact section list; a legacy body (markdown ± CSS fence) is wrapped into one
 * section so old cards still open. Malformed JSON also falls back to a single
 * section holding the raw text (never throws).
 */
export function decodeDocument(body: string): CardDocument {
  const text = body ?? '';
  const cssIdx = text.indexOf(CSS_FENCE);
  const head = cssIdx === -1 ? text : text.slice(0, cssIdx);
  const css = cssIdx === -1 ? '' : text.slice(cssIdx + CSS_FENCE.length).replace(/^\n+/, '');

  if (head.trimStart().startsWith(V2_MARKER)) {
    const json = head.slice(head.indexOf(V2_MARKER) + V2_MARKER.length).trim();
    try {
      const parsed = JSON.parse(json) as { sections?: Array<Partial<CardSection>> };
      const sections = (parsed.sections ?? []).map((s) => ({
        id: newSectionId(),
        title: s.title ?? '',
        content: s.content ?? '',
        layout: normLayout(s.layout),
      }));
      return { sections: sections.length ? sections : [emptySection()], css };
    } catch {
      // Corrupt v2 JSON — fall through to single-section legacy handling below.
    }
  }

  // Legacy (or corrupt) body: one section holding the raw markdown/text.
  const legacy = emptySection();
  legacy.content = head.replace(/\n+$/, '');
  return { sections: [legacy], css };
}

/** Move a section from index `from` to index `to`, returning a new array. */
export function reorderSections(sections: CardSection[], from: number, to: number): CardSection[] {
  const next = sections.slice();
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}

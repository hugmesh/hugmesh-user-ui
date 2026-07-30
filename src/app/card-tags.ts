/**
 * The curated, SAFE set of "Angular tags we provide" for card authors — the
 * SANCTIONED custom element vocabulary the card editor/renderer understands.
 *
 * These `sd-*` tags are the ONLY custom tags the sanitiser permits (see
 * card-sanitize). Each is lowered to plain allow-listed HTML (a class-tagged
 * <div>/<span>/<hr>) BEFORE sanitisation, so the rendered card never contains a
 * live custom element — just safe, styled markup. Arbitrary/unknown tags,
 * <script>, <iframe>, on*= and style= remain stripped exactly as before. The
 * metadata below also drives the in-editor tag palette / help.
 *
 * `<sd-math>` is special: its body is TeX and is rendered by KaTeX (see
 * card-math). It is lowered by the math pass, not here.
 */

/** One attribute a provided tag accepts, for the palette/help + value validation. */
export interface ProvidedTagAttr {
  name: string;
  /** Accepted values; when present, an out-of-list value falls back to the first. */
  values?: readonly string[];
  description: string;
}

/** Documentation + contract for one provided `sd-*` tag (drives the palette). */
export interface ProvidedTag {
  tag: string;
  summary: string;
  /** A copy-paste starter snippet shown in the palette. */
  snippet: string;
  attrs: readonly ProvidedTagAttr[];
  /** True for void/self-closing tags (no children), e.g. <sd-divider>. */
  void?: boolean;
}

/** Allowed orientation values shared by sections/columns/badges. */
export const ALIGNMENTS = ['left', 'center', 'right'] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

/** The provided-tags catalogue — single source of truth for renderer + palette. */
export const PROVIDED_TAGS: readonly ProvidedTag[] = [
  {
    tag: 'sd-card-section',
    summary: 'A titled content block. Orient its content left, center, or right.',
    snippet: '<sd-card-section title="Section" align="left">\n  …content…\n</sd-card-section>',
    attrs: [
      { name: 'title', description: 'Optional heading shown above the section.' },
      { name: 'align', values: ALIGNMENTS, description: 'Text/content alignment.' },
    ],
  },
  {
    tag: 'sd-columns',
    summary: 'Lay child blocks out in 1–4 equal columns (stacks on narrow screens).',
    snippet: '<sd-columns count="2">\n  <div>Left</div>\n  <div>Right</div>\n</sd-columns>',
    attrs: [
      { name: 'count', values: ['1', '2', '3', '4'], description: 'Number of columns.' },
    ],
  },
  {
    tag: 'sd-callout',
    summary: 'A coloured note box for tips, warnings, or info.',
    snippet: '<sd-callout tone="info">Heads up!</sd-callout>',
    attrs: [
      {
        name: 'tone',
        values: ['info', 'success', 'warning', 'danger'],
        description: 'Colour/intent of the callout.',
      },
    ],
  },
  {
    tag: 'sd-badge',
    summary: 'A small inline pill/label.',
    snippet: '<sd-badge tone="info">New</sd-badge>',
    attrs: [
      {
        name: 'tone',
        values: ['info', 'success', 'warning', 'danger'],
        description: 'Colour of the badge.',
      },
    ],
  },
  {
    tag: 'sd-divider',
    summary: 'A horizontal rule separating content.',
    snippet: '<sd-divider></sd-divider>',
    attrs: [],
    void: true,
  },
  {
    tag: 'sd-math',
    summary: 'LaTeX math, rendered with KaTeX (accessible MathML included).',
    snippet: '<sd-math>c = \\pm\\sqrt{a^2 + b^2}</sd-math>',
    attrs: [
      {
        name: 'display',
        values: ['block', 'inline'],
        description: 'Block (centred) or inline rendering.',
      },
    ],
  },
  {
    tag: 'sd-owncast-player',
    summary: 'Live stream player for your Owncast broadcast (requires a broadcast grant).',
    snippet: '<sd-owncast-player></sd-owncast-player>',
    attrs: [],
    void: false,
  },
];

/** The set of provided custom tag names (for the sanitiser allow-list). */
export const PROVIDED_TAG_NAMES: ReadonlySet<string> = new Set(PROVIDED_TAGS.map((t) => t.tag));

/** Pick an attribute value against its allow-list, falling back to the default. */
function pick(value: string | null, allowed: readonly string[], fallback: string): string {
  const v = (value ?? '').trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

/**
 * Lower the provided `sd-*` custom elements in a parsed DOM tree to plain,
 * allow-listed HTML (class-tagged <div>/<span>/<hr>), IN PLACE, BEFORE the
 * generic sanitiser runs. After this pass there are no custom elements left, so
 * the sanitiser only ever sees safe HTML. Unknown attributes are dropped here
 * (we read only the documented ones); children are preserved so nested provided
 * tags and ordinary markup keep working.
 *
 * `<sd-math>` is lowered to a math PLACEHOLDER token (via the `mathToken`
 * callback the caller supplies). The caller renders the TeX with KaTeX, keeps
 * the trusted HTML in its slot table, and re-inserts it AFTER the generic
 * sanitiser has run — so KaTeX's positioning `style` attributes survive instead
 * of being stripped. The token is plain text and passes through the sanitiser
 * untouched.
 */
export function lowerProvidedTags(
  root: Element,
  mathToken: (tex: string, display: boolean) => string,
  streamUrl?: string,
): void {
  // Depth-first; collect first because we replace nodes as we go.
  const elements = Array.from(root.querySelectorAll('*'));
  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    if (!tag.startsWith('sd-')) continue;
    const doc = el.ownerDocument;
    let replacement: Element;

    switch (tag) {
      case 'sd-card-section': {
        const align = pick(el.getAttribute('align'), ALIGNMENTS, 'left');
        const wrap = doc.createElement('div');
        wrap.setAttribute('class', `sd-card-section sd-align-${align}`);
        const title = (el.getAttribute('title') ?? '').trim();
        if (title) {
          const h = doc.createElement('h3');
          h.setAttribute('class', 'sd-section-title');
          h.textContent = title; // textContent escapes — no markup injection via title
          wrap.appendChild(h);
        }
        moveChildren(el, wrap);
        replacement = wrap;
        break;
      }
      case 'sd-columns': {
        const count = pick(el.getAttribute('count'), ['1', '2', '3', '4'], '2');
        const wrap = doc.createElement('div');
        wrap.setAttribute('class', `sd-columns sd-cols-${count}`);
        moveChildren(el, wrap);
        replacement = wrap;
        break;
      }
      case 'sd-callout': {
        const tone = pick(el.getAttribute('tone'), ['info', 'success', 'warning', 'danger'], 'info');
        const wrap = doc.createElement('div');
        wrap.setAttribute('class', `sd-callout sd-tone-${tone}`);
        wrap.setAttribute('role', 'note');
        moveChildren(el, wrap);
        replacement = wrap;
        break;
      }
      case 'sd-badge': {
        const tone = pick(el.getAttribute('tone'), ['info', 'success', 'warning', 'danger'], 'info');
        const span = doc.createElement('span');
        span.setAttribute('class', `sd-badge sd-tone-${tone}`);
        moveChildren(el, span);
        replacement = span;
        break;
      }
      case 'sd-divider': {
        replacement = doc.createElement('hr');
        replacement.setAttribute('class', 'sd-divider');
        break;
      }
      case 'sd-math': {
        const display = pick(el.getAttribute('display'), ['block', 'inline'], 'block') === 'block';
        // Register the TeX with the caller's KaTeX slot table; we get back an
        // opaque placeholder token (plain text) that survives sanitisation and
        // is swapped for the trusted KaTeX HTML afterwards.
        const token = mathToken(el.textContent ?? '', display);
        const span = doc.createElement('span');
        span.setAttribute('class', display ? 'sd-math sd-math-block' : 'sd-math sd-math-inline');
        span.textContent = token;
        replacement = span;
        break;
      }
      case 'sd-owncast-player': {
        // SECURITY: the HLS URL is PLATFORM-supplied (the `streamUrl` argument),
        // never read from the card author's markup. Any attributes on the
        // <sd-owncast-player> element are silently ignored.
        const wrap = doc.createElement('div');
        if (streamUrl) {
          // Live player: the client-side HLS.js loader picks up data-hls-src and
          // initialises the stream. The iframe sandbox has no allow-scripts so the
          // preview shows the notice text; the live card renderer (outside the
          // sandbox) is responsible for wiring HLS.js.
          wrap.setAttribute('class', 'sd-owncast-player');
          wrap.setAttribute('data-hls-src', streamUrl);
          wrap.setAttribute('role', 'region');
          wrap.setAttribute('aria-label', 'Live stream player');
          const notice = doc.createElement('p');
          notice.setAttribute('class', 'sd-owncast-player-notice');
          notice.textContent = 'Live stream loads when active.';
          wrap.appendChild(notice);
        } else {
          // Editor placeholder: no stream URL available yet.
          wrap.setAttribute('class', 'sd-owncast-player-placeholder');
          wrap.setAttribute('role', 'note');
          wrap.setAttribute('aria-label', 'Live stream placeholder');
          wrap.textContent = 'Your live stream will appear here when published.';
        }
        replacement = wrap;
        break;
      }
      default: {
        // An unknown sd-* tag: unwrap to its (already-present) children safely by
        // replacing with a span so no raw custom element leaks to the sanitiser.
        const span = doc.createElement('span');
        moveChildren(el, span);
        replacement = span;
        break;
      }
    }
    el.replaceWith(replacement);
  }
}

/** Move all children of `from` into `to`, preserving order. */
function moveChildren(from: Element, to: Element): void {
  while (from.firstChild) to.appendChild(from.firstChild);
}

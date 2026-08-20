/**
 * Pure, framework-free sanitiser + CSS scoper + Markdown renderer for the
 * sandboxed WYSIWYG card editor (see {@link CardEditorComponent}). Kept as a
 * standalone module (no Angular deps) so the dangerous-input logic is unit
 * testable in isolation and reusable by the iframe-srcdoc builder.
 *
 * SECURITY MODEL — DEFENCE IN DEPTH. The card preview is rendered into a
 * `<iframe sandbox>` that carries NEITHER `allow-scripts` NOR
 * `allow-same-origin`, so the framed document runs in a unique, opaque origin
 * with scripting disabled — it can neither execute JS nor reach the host DOM,
 * cookies, or storage. The functions below are the FIRST wall (so a benign
 * preview stays benign and the saved card body is clean); the sandboxed iframe
 * is the SECOND, hard wall. A bypass of one layer is still contained by the
 * other.
 *
 * This module also orchestrates the SECTION model, the PROVIDED `sd-*` tags
 * (card-tags) and MATHTEX (card-math): sections are rendered to HTML, the
 * sanctioned custom tags are lowered to safe markup, KaTeX is pre-rendered to
 * static HTML out-of-band (via opaque placeholders so its positioning styles
 * survive sanitisation), and the structural KaTeX CSS (card-css) is inlined and
 * scoped into the preview document.
 */
import { lowerProvidedTags } from './card-tags';
import { extractMath, reinsertMath, renderMathTag } from './card-math';
import type { CardSection } from './card-sections';
import { KATEX_CSS } from './katex-css';

/** Block-level tags that may NEVER appear (active content / host escape). */
const FORBIDDEN_TAGS = new Set([
  'script',
  'style', // user CSS goes through the scoped <style> we build, never inline
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'svg', // SVG can host <script> / animatable href — drop wholesale
  'math',
]);

/**
 * Allow-list of tags kept in sanitised output. Anything not here is unwrapped
 * (its text/children survive, the tag is dropped) unless it is forbidden, in
 * which case the whole subtree is removed.
 */
const ALLOWED_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'u',
  'ul',
]);

/** Per-tag allow-list of attributes. Everything else (incl. on* + style) drops. */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  // `role` is allowed globally so the provided tags' lowered markup (e.g. the
  // <div role="note"> a <sd-callout> becomes) keeps its accessibility semantics.
  // role values are a fixed ARIA vocabulary — inert, no script vector.
  // `aria-label` is allowed globally for the player's accessible name.
  // `data-hls-src` is allowed on div for the sd-owncast-player lowered markup;
  // it carries a PLATFORM-supplied URL (never author-injectable) and is inert
  // data (no script vector — the sandbox has no allow-scripts).
  '*': new Set(['class', 'id', 'title', 'lang', 'dir', 'role', 'aria-label']),
  div: new Set(['data-hls-src']),
};

/** URL schemes permitted on href/src. Everything else (javascript:, data: html…) drops. */
const SAFE_URL = /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i;
/** data: images are allowed (inert), but only image media types. */
const SAFE_DATA_IMG = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);/i;
/** Whitespace + C0 control chars an attacker smuggles into `java\nscript:`. */
const URL_NOISE = /[\u0000-\u0020]+/g;

function isSafeUrl(raw: string, isImg: boolean): boolean {
  const v = (raw ?? '').trim();
  const collapsed = v.replace(URL_NOISE, '').toLowerCase();
  if (collapsed.startsWith('javascript:') || collapsed.startsWith('vbscript:')) return false;
  if (isImg && SAFE_DATA_IMG.test(v)) return true;
  if (collapsed.startsWith('data:')) return false;
  return SAFE_URL.test(v);
}

/**
 * Sanitise an HTML fragment using the browser's own parser (DOMParser), so we
 * walk a real, normalised DOM tree rather than regex-matching strings. Returns
 * a string of allow-listed HTML with: forbidden subtrees removed,
 * non-allow-listed tags unwrapped, every `on*`/`style` attribute stripped,
 * and href/src restricted to safe schemes. Comments are dropped.
 *
 * `prepare` is an optional hook that mutates the parsed <body> DOM BEFORE the
 * allow-list walk — used to LOWER the provided `sd-*` custom tags to plain,
 * allow-listed markup (so the only custom tags ever permitted are the sanctioned
 * ones, and they are reduced to safe HTML before sanitisation). After `prepare`
 * the tree contains no custom elements, so the generic walk strips anything the
 * lowering missed (defence in depth).
 */
export function sanitizeHtml(dirty: string, prepare?: (body: HTMLElement) => void): string {
  const doc = new DOMParser().parseFromString(`<body>${dirty ?? ''}</body>`, 'text/html');
  const body = doc.body;
  prepare?.(body);
  sanitizeNode(body);
  return body.innerHTML;
}

function sanitizeNode(node: Node): void {
  // Iterate over a static copy — we mutate childNodes as we go.
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.parentNode?.removeChild(child);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue; // keep text nodes

    const el = child as Element;
    const tag = el.tagName.toLowerCase();

    if (FORBIDDEN_TAGS.has(tag)) {
      el.parentNode?.removeChild(el); // drop the WHOLE subtree
      continue;
    }

    // Recurse first so children are clean before we (maybe) unwrap this node.
    sanitizeNode(el);

    if (!ALLOWED_TAGS.has(tag)) {
      unwrap(el); // keep the children, drop the unknown tag
      continue;
    }

    scrubAttributes(el, tag);
  }
}

function scrubAttributes(el: Element, tag: string): void {
  const allowed = ALLOWED_ATTRS[tag] ?? new Set<string>();
  const global = ALLOWED_ATTRS['*'];
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const ok = allowed.has(name) || global.has(name);
    // on*-handlers and inline style are never allowed (host-style escape / JS).
    if (!ok || name.startsWith('on') || name === 'style') {
      el.removeAttribute(attr.name);
      continue;
    }
    if (name === 'href' && !isSafeUrl(attr.value, false)) {
      el.removeAttribute(attr.name);
    }
    if (name === 'src' && !isSafeUrl(attr.value, true)) {
      el.removeAttribute(attr.name);
    }
  }
}

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

/**
 * Scope a block of user CSS so every rule applies only INSIDE `${scope}` (the
 * card container). This prevents the user CSS from restyling the host shell —
 * e.g. `body { display: none }` becomes `.card-root { … }` (only the card), and
 * `h1 { … }` becomes `.card-root h1 { … }`. `@`-rules (`@media`, `@keyframes`,
 * `@font-face`) are preserved and their inner selectors scoped. We also strip
 * any embedded `</style` and HTML-comment terminators so the CSS can never
 * break out of the `<style>` element we wrap it in, and drop CSS-level script
 * vectors (`javascript:` / `expression(` / `@import` / `-moz-binding`).
 */
export function scopeCss(css: string, scope = '.card-root'): string {
  if (!css) return '';
  // Neutralise breakout + CSS-borne script vectors before we touch selectors.
  const safe = css
    .replace(/<\/?\s*style/gi, '')
    .replace(/<!--|-->/g, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/-moz-binding\s*:[^;]*;?/gi, '');

  return rewriteSelectors(safe, scope);
}

/**
 * Walk the CSS at brace depth, prefixing each selector group with the scope.
 * Selectors inside a conditional at-rule block (`@media{…}`) are scoped; the
 * at-rule prelude itself (`@media (...)`) is left intact. `@keyframes` /
 * `@font-face` inner blocks are passed through untouched.
 */
function rewriteSelectors(css: string, scope: string): string {
  let out = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    let prelude = '';
    while (i < n && css[i] !== '{' && css[i] !== '}' && css[i] !== ';') {
      prelude += css[i++];
    }
    const ch = css[i];
    if (ch === '{') {
      i++; // consume {
      const trimmed = prelude.trim();
      const body = readBlock(css, i);
      i = body.end;
      if (trimmed.startsWith('@')) {
        const inner = /^@(media|supports|document|container)/i.test(trimmed)
          ? rewriteSelectors(body.text, scope) // conditional group rules wrap real selectors
          : body.text; // @keyframes / @font-face — leave inner untouched
        out += `${trimmed} {${inner}}`;
      } else {
        out += `${scopeSelectorList(trimmed, scope)} {${body.text}}`;
      }
    } else if (ch === '}' || ch === ';') {
      out += prelude + (ch ?? '');
      i++;
    } else {
      out += prelude; // EOF
    }
  }
  return out;
}

/** Read a brace-balanced block starting just after an opening `{`. */
function readBlock(css: string, start: number): { text: string; end: number } {
  let depth = 1;
  let i = start;
  let text = '';
  while (i < css.length && depth > 0) {
    const c = css[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
    text += c;
    i++;
  }
  return { text, end: i };
}

/** Prefix every selector in a comma list with the scope; map root selectors. */
function scopeSelectorList(list: string, scope: string): string {
  return list
    .split(',')
    .map((sel) => scopeOne(sel.trim(), scope))
    .filter(Boolean)
    .join(', ');
}

function scopeOne(sel: string, scope: string): string {
  if (!sel) return '';
  // Root-ish selectors collapse to the scope itself (the card root IS the root
  // the user can target — they cannot reach the real <html>/<body>/host shell).
  if (/^(:root|html|body)$/i.test(sel)) return scope;
  return `${scope} ${sel}`;
}

/** Escape the five HTML-significant characters. */
export function escapeHtml(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a fragment of card HTML safely through the full pipeline:
 *
 *   1. extractMath  — pull `$$…$$` / `\(…\)` out, render each with KaTeX, and
 *      leave an opaque placeholder token in the text (so KaTeX's positioning
 *      `style` attrs survive the allow-list, which would otherwise strip them).
 *   2. sanitizeHtml — parse, LOWER the provided `sd-*` custom tags to safe markup
 *      (any `<sd-math>` also registers a KaTeX placeholder), then run the generic
 *      allow-list walk (drops <script>/<iframe>/on*=/style=/unknown tags).
 *   3. reinsertMath — swap the trusted, static KaTeX HTML back in for its tokens.
 *
 * The output is allow-listed HTML plus trusted KaTeX HTML (inert: no script, no
 * live URLs, MathML for a11y). It is still rendered into the null-origin,
 * script-disabled iframe — the second, hard wall.
 */
export function renderSafeCardHtml(rawHtml: string, streamUrl?: string): string {
  const { text, slots } = extractMath(rawHtml ?? '');
  const sanitized = sanitizeHtml(text, (body) =>
    lowerProvidedTags(
      body,
      (tex, display) => {
        // Register an <sd-math> body's TeX into the same slot table and return its
        // placeholder token (plain text) to embed in the DOM. The SLOT KEY is the
        // bare, whitespace-free token; we pad the EMITTED value so it survives the
        // sanitiser's text-node whitespace handling (see card-math.extractMath).
        const token = `MATHTAG:${slots.size}:${Math.random().toString(36).slice(2)}`;
        slots.set(token, renderMathTag(tex, display));
        return ` ${token} `;
      },
      streamUrl,
    ),
  );
  return reinsertMath(sanitized, slots);
}

/** The structural KaTeX CSS, scoped under `.card-root` for the preview document. */
function scopedKatexCss(): string {
  return scopeCss(KATEX_CSS, '.card-root');
}

/**
 * Build the full, self-contained document we drop into the sandboxed iframe's
 * `srcdoc`. It contains ONLY: a tiny reset, the scoped KaTeX + user `<style>`,
 * and the sanitised body inside `.card-root`. There is no `<script>` anywhere
 * and the iframe runs script-disabled in a null origin, so this string can never
 * act on the host. `bodyHtml` must already be safe (run through
 * {@link renderSafeCardHtml}).
 */
function wrapPreviewDoc(bodyHtml: string, userCss: string): string {
  const css = scopeCss(userCss, '.card-root');
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
  .card-root { padding: 1rem; }
${PROVIDED_TAG_CSS}
${scopedKatexCss()}
${css}
</style></head>
<body><div class="card-root">${bodyHtml}</div></body></html>`;
}

/**
 * Render one section to a class-tagged wrapper applying its orientation
 * (alignment + column count). The title is escaped; the content is run through
 * the full safe pipeline (provided tags + math + allow-list).
 */
export function renderSection(section: CardSection): string {
  const align = section.layout?.align ?? 'left';
  const columns = section.layout?.columns ?? 1;
  const title = (section.title ?? '').trim();
  const heading = title ? `<h3 class="sd-section-title">${escapeHtml(title)}</h3>` : '';
  const inner = renderSafeCardHtml(section.content ?? '');
  const colClass = columns > 1 ? ` sd-cols-${columns}` : '';
  const contentWrap =
    columns > 1 ? `<div class="sd-columns${colClass}">${inner}</div>` : inner;
  return `<section class="sd-section sd-align-${align}">${heading}${contentWrap}</section>`;
}

/**
 * Build the sandboxed preview document for the full SECTION model: each section
 * is rendered in order to safe, oriented markup, concatenated inside
 * `.card-root`, with the scoped user CSS. Used by the draggable section editor.
 */
export function buildCardPreview(sections: CardSection[], userCss: string): string {
  const body = (sections ?? []).map(renderSection).join('\n');
  return wrapPreviewDoc(body, userCss);
}

/**
 * Baseline styling for the lowered provided-tag markup (callouts, columns,
 * badges, dividers, section alignment). Inlined into the preview document so the
 * sanctioned tags render meaningfully without the author writing any CSS. It is
 * static, author-independent CSS — already scoped under `.card-root`.
 */
const PROVIDED_TAG_CSS = `
  .card-root .sd-section { margin: 0 0 1rem; }
  .card-root .sd-align-left { text-align: left; }
  .card-root .sd-align-center { text-align: center; }
  .card-root .sd-align-right { text-align: right; }
  .card-root .sd-section-title { margin: 0 0 0.4rem; font-size: 1.1rem; }
  .card-root .sd-columns { display: grid; gap: 0.75rem; grid-template-columns: 1fr; }
  .card-root .sd-cols-2 { grid-template-columns: repeat(2, 1fr); }
  .card-root .sd-cols-3 { grid-template-columns: repeat(3, 1fr); }
  .card-root .sd-cols-4 { grid-template-columns: repeat(4, 1fr); }
  @media (max-width: 600px) {
    .card-root .sd-columns { grid-template-columns: 1fr; }
  }
  .card-root .sd-callout { padding: 0.6rem 0.8rem; border-radius: 0.5rem; border-left: 4px solid; margin: 0.5rem 0; }
  .card-root .sd-tone-info { border-color: #2196f3; background: rgba(33,150,243,0.08); }
  .card-root .sd-tone-success { border-color: #4caf50; background: rgba(76,175,80,0.08); }
  .card-root .sd-tone-warning { border-color: #ff9800; background: rgba(255,152,0,0.08); }
  .card-root .sd-tone-danger { border-color: #f44336; background: rgba(244,67,54,0.08); }
  .card-root .sd-badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.8rem; line-height: 1.6; }
  .card-root .sd-badge.sd-tone-info { background: #2196f3; color: #fff; }
  .card-root .sd-badge.sd-tone-success { background: #4caf50; color: #fff; }
  .card-root .sd-badge.sd-tone-warning { background: #ff9800; color: #111; }
  .card-root .sd-badge.sd-tone-danger { background: #f44336; color: #fff; }
  .card-root .sd-divider { border: 0; border-top: 1px solid currentColor; opacity: 0.3; margin: 0.8rem 0; }
  .card-root .sd-math-block { display: block; text-align: center; margin: 0.6rem 0; }
  .card-root .sd-math-inline { display: inline; }
  .card-root .sd-owncast-player { border: 1px solid currentColor; border-radius: 0.5rem; padding: 0.75rem 1rem; background: rgba(0,0,0,0.04); }
  .card-root .sd-owncast-player-notice { margin: 0; font-size: 0.9rem; opacity: 0.7; }
  .card-root .sd-owncast-player-placeholder { border: 2px dashed currentColor; border-radius: 0.5rem; padding: 0.75rem 1rem; opacity: 0.5; font-size: 0.9rem; }
`;

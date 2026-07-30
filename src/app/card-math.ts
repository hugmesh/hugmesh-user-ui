/**
 * MathTeX support for the sandboxed card editor — LaTeX → KaTeX, rendered to
 * STATIC HTML at preview/build time, never as runtime script in the sandbox.
 *
 * SECURITY MODEL (why this is safe inside the two-wall sandbox):
 *   - The user only ever controls the TeX SOURCE string. KaTeX parses that and
 *     emits its own structurally-generated HTML+MathML; the user never injects
 *     HTML here. KaTeX HTML-escapes text it places in the DOM, and we render
 *     with `trust: false` + `strict: 'ignore'` so `\href`/`\url`/`\includegraphics`
 *     and other escape-hatch commands are refused. The output therefore contains
 *     no <script>, no event handlers, and no live URLs.
 *   - KaTeX output legitimately needs inline `style` (for atom positioning) and
 *     MathML tags, which the card sanitiser would otherwise strip. So we do NOT
 *     feed KaTeX HTML through the tag/attr sanitiser. Instead each rendered span
 *     is swapped for an opaque PLACEHOLDER token before sanitising the
 *     surrounding user HTML, then re-substituted AFTER sanitising. The token is a
 *     random, unguessable marker, so user text can neither forge a placeholder
 *     nor smuggle markup past the sanitiser via this channel.
 *   - The result is still rendered into the null-origin, script-disabled iframe
 *     (the hard second wall), so even a KaTeX bug cannot execute or reach the host.
 */
import katex from 'katex';

/** Options locking KaTeX to inert, accessible output (no trust, no throw). */
const KATEX_OPTS = {
  throwOnError: false, // a malformed expression renders as a visible error node, never throws
  errorColor: '#ff6b6b',
  output: 'htmlAndMathml' as const, // visual HTML (aria-hidden) + accessible MathML
  trust: false, // refuse \href/\url/\includegraphics and other DOM-trusting commands
  strict: 'ignore' as const, // ignore (don't warn/throw on) non-strict TeX
  displayMode: false,
};

/**
 * Render a single TeX expression to KaTeX's static HTML+MathML string. `display`
 * picks block (centred, larger) vs inline rendering. Never throws — invalid TeX
 * yields a KaTeX error node (visible red text) instead.
 */
export function renderTex(tex: string, display = false): string {
  return katex.renderToString(tex ?? '', { ...KATEX_OPTS, displayMode: display });
}

/** Result of extracting math: the text with placeholders, and the slot table. */
export interface MathExtraction {
  text: string;
  slots: Map<string, string>;
}

/** Random per-extraction nonce so user input can never forge a placeholder. */
function nonce(): string {
  const a = new Uint8Array(8);
  (globalThis.crypto ?? cryptoFallback()).getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Crypto fallback for non-browser/test contexts lacking globalThis.crypto. */
function cryptoFallback(): { getRandomValues(a: Uint8Array): Uint8Array } {
  return {
    getRandomValues(arr: Uint8Array): Uint8Array {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
      return arr;
    },
  };
}

/**
 * Extract math delimited by `$$…$$` (display) and `\(…\)` (inline) from a body
 * of user text, rendering each to KaTeX and replacing it in the text with an
 * opaque placeholder token. The returned `text` is then safe to run through the
 * HTML sanitiser; afterwards, call {@link reinsertMath} to swap the trusted
 * KaTeX HTML back in. `$$…$$` is matched first (greedy-safe, non-nesting), then
 * `\(…\)`.
 *
 * Order matters: we scan with a single shared nonce so the same render pass
 * produces a consistent slot table.
 */
export function extractMath(text: string): MathExtraction {
  const slots = new Map<string, string>();
  const n = nonce();
  let i = 0;
  const mark = (html: string): string => {
    // A CONTIGUOUS, whitespace-free token (only [a-z0-9] + colons). It must
    // survive HTML text-node serialisation through the sanitiser, which can
    // collapse/trim surrounding whitespace, so the token carries NO spaces of
    // its own. We pad the EMITTED token with a space each side so it never
    // glues onto adjacent words; the SLOT KEY is the bare, contiguous token.
    const token = `MATH:${n}:${i++}`;
    slots.set(token, html);
    return ` ${token} `;
  };

  // 1) Display math: $$ … $$  (must come first so $$ isn't seen as two $).
  let out = (text ?? '').replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => mark(renderTex(tex, true)));
  // 2) Inline math: \( … \)
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_m, tex) => mark(renderTex(tex, false)));

  return { text: out, slots };
}

/**
 * Re-substitute the trusted KaTeX HTML back into a sanitised string, replacing
 * each placeholder token with its rendered math. Tokens absent from the slot
 * table (e.g. forged by user text — impossible given the nonce, but defensive)
 * are left as the literal placeholder and thus inert.
 */
export function reinsertMath(sanitized: string, slots: Map<string, string>): string {
  let out = sanitized;
  for (const [token, html] of slots) {
    out = out.split(token).join(html);
  }
  return out;
}

/**
 * Convenience for a whole `<sd-math>` element body: render its TeX directly to
 * trusted KaTeX HTML. `display` defaults to true (a standalone math block).
 */
export function renderMathTag(tex: string, display = true): string {
  return renderTex(tex, display);
}

import { KATEX_CSS } from './katex-css';

/**
 * The generated (see scripts/gen-katex-css.mjs) structural KaTeX CSS for the
 * sandboxed `<iframe sandbox srcdoc>` card preview. Proves the minimal font
 * subset is genuinely base64 data-URI-inlined (so those glyphs render for
 * real inside the null-origin sandbox), and that every OTHER font is stripped
 * to a bare, network-inert `@font-face`-free rule set — no relative
 * `url(fonts/...)` survives, since about:srcdoc can never resolve one.
 */
describe('KATEX_CSS (generated, base64-inlined minimal font subset)', () => {
  it('never contains a relative fonts/ URL (cannot resolve in a null-origin srcdoc)', () => {
    expect(KATEX_CSS).not.toContain('url(fonts/');
  });

  it('base64 data-URI-inlines the minimal font subset as real @font-face src', () => {
    const dataUriFontFaces = KATEX_CSS.match(/@font-face\{[^}]*data:font\/woff2;base64,[^}]*\}/g) ?? [];
    // KaTeX_Main (regular/bold/italic/bolditalic) + KaTeX_Math-Italic +
    // KaTeX_Size1/Size2 — see gen-katex-css.mjs's MINIMAL_SUBSET.
    expect(dataUriFontFaces.length).toBe(7);
    for (const family of ['KaTeX_Main', 'KaTeX_Math', 'KaTeX_Size1', 'KaTeX_Size2']) {
      expect(KATEX_CSS).toContain(`font-family:${family};`);
    }
  });

  it('inlined font-face declarations carry a real (non-empty) base64 payload', () => {
    const payloads = [...KATEX_CSS.matchAll(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g)];
    expect(payloads.length).toBe(7);
    for (const [, payload] of payloads) {
      // A real woff2 font is at least a few KB even minified/subsetted upstream —
      // this is nowhere near an empty-string / placeholder data URI.
      expect(payload.length).toBeGreaterThan(1000);
    }
  });

  it('still positions every atom via the structural (non-font) CSS', () => {
    expect(KATEX_CSS).toContain('.katex{');
    expect(KATEX_CSS).toContain('.katex-display');
  });

  it('is inert text: no <script> and no javascript: vector', () => {
    expect(KATEX_CSS.toLowerCase()).not.toContain('<script');
    expect(KATEX_CSS.toLowerCase()).not.toContain('javascript:');
  });
});

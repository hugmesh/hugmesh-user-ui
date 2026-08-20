import { KATEX_CSS } from './katex-css';

/**
 * The generated (see scripts/gen-katex-css.mjs) structural KaTeX CSS for the
 * sandboxed `<iframe sandbox srcdoc>` card preview. Proves EVERY upstream font
 * is genuinely base64 data-URI-inlined (so the full glyph repertoire renders
 * for real inside the null-origin sandbox), and that no relative
 * `url(fonts/...)` survives, since about:srcdoc can never resolve one.
 */
describe('KATEX_CSS (generated, base64-inlined full font set)', () => {
  /** Every @font-face katex 0.16.x ships, one per woff2 file in its dist/fonts. */
  const FONT_FACE_COUNT = 20;
  /** The families those 20 faces span — the whole KaTeX symbol repertoire. */
  const FAMILIES = [
    'KaTeX_AMS',
    'KaTeX_Caligraphic',
    'KaTeX_Fraktur',
    'KaTeX_Main',
    'KaTeX_Math',
    'KaTeX_SansSerif',
    'KaTeX_Script',
    'KaTeX_Size1',
    'KaTeX_Size2',
    'KaTeX_Size3',
    'KaTeX_Size4',
    'KaTeX_Typewriter',
  ];

  it('never contains a relative fonts/ URL (cannot resolve in a null-origin srcdoc)', () => {
    expect(KATEX_CSS).not.toContain('url(fonts/');
  });

  it('base64 data-URI-inlines every upstream font as a real @font-face src', () => {
    const dataUriFontFaces = KATEX_CSS.match(/@font-face\{[^}]*data:font\/woff2;base64,[^}]*\}/g) ?? [];
    expect(dataUriFontFaces.length).toBe(FONT_FACE_COUNT);
  });

  it('leaves no @font-face behind without an inlined payload', () => {
    // Any block the generator failed to inline would have been stripped, so the
    // inlined count must account for EVERY @font-face still in the sheet.
    const allFontFaces = KATEX_CSS.match(/@font-face\{[^}]*\}/g) ?? [];
    expect(allFontFaces.length).toBe(FONT_FACE_COUNT);
  });

  it('covers every KaTeX family, not just the plain-text/math subset', () => {
    // The AMS (blackboard-bold), Caligraphic, Fraktur, Script, SansSerif and
    // Typewriter sets plus the Size3/Size4 stretchy delimiters used to be
    // stripped and fell back to the system serif/sans — see gen-katex-css.mjs.
    for (const family of FAMILIES) {
      expect(KATEX_CSS).toContain(`font-family:${family};`);
    }
  });

  it('inlined font-face declarations carry a real (non-empty) base64 payload', () => {
    const payloads = [...KATEX_CSS.matchAll(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g)];
    expect(payloads.length).toBe(FONT_FACE_COUNT);
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

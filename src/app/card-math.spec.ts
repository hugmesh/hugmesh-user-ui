import { extractMath, reinsertMath, renderMathTag, renderTex } from './card-math';

describe('card-math (MathTeX via KaTeX, pre-rendered + script-free)', () => {
  describe('renderTex / renderMathTag', () => {
    it('renders TeX to KaTeX HTML with accessible MathML and no script', () => {
      const html = renderTex('c = \\pm\\sqrt{a^2 + b^2}', true);
      expect(html).toContain('class="katex');
      expect(html.toLowerCase()).toContain('<math'); // MathML for assistive tech
      expect(html.toLowerCase()).not.toContain('<script');
    });

    it('does not throw on malformed TeX (renders an error node)', () => {
      expect(() => renderMathTag('\\frac{1}{')).not.toThrow();
    });

    it('refuses trust commands (\\href) — no LIVE href/link injected via TeX', () => {
      const html = renderTex('\\href{javascript:alert(1)}{x}', false);
      // trust:false makes KaTeX render \href as inert error text, NOT an <a href>.
      // The raw TeX is echoed only inside the inert MathML <annotation> text node;
      // what matters is there is no live anchor/href attribute to click.
      expect(html.toLowerCase()).not.toContain('<a ');
      expect(html.toLowerCase()).not.toContain('href=');
    });
  });

  describe('extractMath / reinsertMath (placeholder channel)', () => {
    it('replaces $$…$$ and \\(…\\) with opaque tokens, then restores the KaTeX HTML', () => {
      const { text, slots } = extractMath('A $$x^2$$ B \\(y_i\\) C');
      // The math is gone from the text (replaced by tokens) so it survives sanitisation.
      expect(text).not.toContain('$$');
      expect(text).not.toContain('\\(');
      expect(slots.size).toBe(2);
      const restored = reinsertMath(text, slots);
      expect(restored).toContain('class="katex');
      expect(restored).toContain('A ');
      expect(restored).toContain(' B ');
      expect(restored).toContain(' C');
    });

    it('uses an unguessable per-pass token so user text cannot forge a placeholder', () => {
      const { text } = extractMath('$$x$$');
      expect(text).toMatch(/MATH:[0-9a-f]{16}:0/); // nonce-tagged token
    });

    it('leaves text without math untouched', () => {
      const { text, slots } = extractMath('no math here');
      expect(text).toBe('no math here');
      expect(slots.size).toBe(0);
    });
  });
});

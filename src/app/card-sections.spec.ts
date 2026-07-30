import {
  CardDocument,
  decodeDocument,
  emptySection,
  encodeDocument,
  reorderSections,
} from './card-sections';

describe('card-sections (section model + serialisation)', () => {
  function doc(): CardDocument {
    return {
      sections: [
        { ...emptySection(), title: 'Intro', content: 'hello', layout: { align: 'center', columns: 2 } },
        { ...emptySection(), title: 'Math', content: '$$x^2$$', layout: { align: 'right', columns: 1 } },
      ],
      css: '.card-root h1 { color: red; }',
    };
  }

  describe('encode/decode round-trip', () => {
    it('preserves the ORDERED section structure (titles, content, orientation) + css', () => {
      const body = encodeDocument(doc());
      const back = decodeDocument(body);
      expect(back.sections.length).toBe(2);
      expect(back.sections[0].title).toBe('Intro');
      expect(back.sections[0].content).toBe('hello');
      expect(back.sections[0].layout).toEqual({ align: 'center', columns: 2 });
      expect(back.sections[1].title).toBe('Math');
      expect(back.sections[1].content).toBe('$$x^2$$');
      expect(back.sections[1].layout).toEqual({ align: 'right', columns: 1 });
      expect(back.css).toBe('.card-root h1 { color: red; }');
    });

    it('reorders sections then serialises the NEW order (drag-drop reflected in the body)', () => {
      const original = doc();
      const reordered = reorderSections(original.sections, 0, 1); // move Intro after Math
      expect(reordered[0].title).toBe('Math');
      expect(reordered[1].title).toBe('Intro');
      const back = decodeDocument(encodeDocument({ sections: reordered, css: original.css }));
      expect(back.sections.map((s) => s.title)).toEqual(['Math', 'Intro']);
    });

    it('emits a v2 marker + JSON sections + the unchanged CSS fence', () => {
      const body = encodeDocument(doc());
      expect(body).toContain('@hugmesh-card v2');
      expect(body).toContain('"sections"');
      expect(body).toContain('/* @hugmesh-card-css */');
    });
  });

  describe('backward compatibility', () => {
    it('decodes a LEGACY markdown-only body into a single section', () => {
      const back = decodeDocument('# Legacy\n\nbody text');
      expect(back.sections.length).toBe(1);
      expect(back.sections[0].content).toBe('# Legacy\n\nbody text');
      expect(back.css).toBe('');
    });

    it('decodes a LEGACY markdown + fenced-CSS body into one section + css', () => {
      const legacy = '# Title\n\n/* @hugmesh-card-css */\n.card-root h1 { color: blue; }';
      const back = decodeDocument(legacy);
      expect(back.sections.length).toBe(1);
      expect(back.sections[0].content).toBe('# Title');
      expect(back.css).toBe('.card-root h1 { color: blue; }');
    });

    it('falls back to a single section on corrupt v2 JSON (never throws)', () => {
      const corrupt = '<!-- @hugmesh-card v2 -->\n{not json';
      expect(() => decodeDocument(corrupt)).not.toThrow();
      expect(decodeDocument(corrupt).sections.length).toBe(1);
    });
  });

  describe('reorderSections', () => {
    it('moves an item and returns a new array (immutability)', () => {
      const a = emptySection();
      const b = emptySection();
      const c = emptySection();
      const input = [a, b, c];
      const out = reorderSections(input, 2, 0); // c to front
      expect(out.map((s) => s.id)).toEqual([c.id, a.id, b.id]);
      expect(input.map((s) => s.id)).toEqual([a.id, b.id, c.id]); // original untouched
    });
  });
});

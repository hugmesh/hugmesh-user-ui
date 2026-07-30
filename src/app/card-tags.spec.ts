import { PROVIDED_TAGS, PROVIDED_TAG_NAMES, lowerProvidedTags } from './card-tags';

/** Lower the provided tags in a fragment (no stream URL) and return the resulting HTML. */
function lower(html: string): string {
  const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
  // Math is registered via a stub token here (the KaTeX path is covered elsewhere).
  lowerProvidedTags(body, (tex) => `[[math:${tex.trim()}]]`);
  return body.innerHTML;
}

/** Lower with a platform-supplied stream URL. */
function lowerWithStream(html: string, streamUrl: string): string {
  const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
  lowerProvidedTags(body, (tex) => `[[math:${tex.trim()}]]`, streamUrl);
  return body.innerHTML;
}

describe('card-tags (provided Angular tag vocabulary)', () => {
  describe('catalogue', () => {
    it('documents exactly the sanctioned sd-* tags with snippets + attrs', () => {
      const names = PROVIDED_TAGS.map((t) => t.tag).sort();
      expect(names).toEqual(
        [
          'sd-badge',
          'sd-callout',
          'sd-card-section',
          'sd-columns',
          'sd-divider',
          'sd-math',
          'sd-owncast-player',
        ].sort(),
      );
      for (const t of PROVIDED_TAGS) {
        expect(t.snippet).withContext(`${t.tag} snippet`).toContain(t.tag);
        expect(t.summary).withContext(`${t.tag} summary`).toBeTruthy();
      }
    });

    it('exposes the names as a Set for the sanitiser allow-list', () => {
      expect(PROVIDED_TAG_NAMES.has('sd-callout')).toBeTrue();
      expect(PROVIDED_TAG_NAMES.has('script')).toBeFalse();
    });
  });

  describe('lowerProvidedTags', () => {
    it('lowers sd-card-section with align + title', () => {
      const out = lower('<sd-card-section title="Bio" align="right">x</sd-card-section>');
      expect(out).toContain('class="sd-card-section sd-align-right"');
      expect(out).toContain('sd-section-title');
      expect(out).toContain('Bio');
    });

    it('clamps bad attribute values to the documented default', () => {
      expect(lower('<sd-columns count="99"><i>a</i></sd-columns>')).toContain('sd-cols-2');
      expect(lower('<sd-callout tone="xss"></sd-callout>')).toContain('sd-tone-info');
    });

    it('registers <sd-math> as a math placeholder token (not raw KaTeX here)', () => {
      const out = lower('<sd-math>a+b</sd-math>');
      expect(out).toContain('[[math:a+b]]'); // our stub token from the callback
      expect(out.toLowerCase()).not.toContain('<sd-math'); // no raw custom element survives
    });

    it('leaves no raw sd-* custom element behind for any provided tag', () => {
      const out = lower(
        '<sd-badge>n</sd-badge><sd-divider></sd-divider><sd-columns><div>c</div></sd-columns>',
      );
      expect(out.toLowerCase()).not.toMatch(/<sd-/);
    });

    describe('sd-owncast-player', () => {
      it('lowers to a placeholder div when no streamUrl is provided (editor preview)', () => {
        const out = lower('<sd-owncast-player></sd-owncast-player>');
        expect(out).toContain('class="sd-owncast-player-placeholder"');
        expect(out).toContain('role="note"');
        expect(out).toContain('Your live stream will appear here when published.');
        expect(out.toLowerCase()).not.toContain('<sd-owncast-player');
      });

      it('lowers to a live player div with data-hls-src when streamUrl is provided', () => {
        const url = 'https://stream.example.com/hls/live.m3u8';
        const out = lowerWithStream('<sd-owncast-player></sd-owncast-player>', url);
        expect(out).toContain('class="sd-owncast-player"');
        expect(out).toContain(`data-hls-src="${url}"`);
        expect(out).toContain('role="region"');
        expect(out).toContain('aria-label="Live stream player"');
        expect(out).toContain('class="sd-owncast-player-notice"');
        expect(out).toContain('Live stream loads when active.');
        expect(out.toLowerCase()).not.toContain('<sd-owncast-player');
      });

      it('IGNORES any attributes the card author places on sd-owncast-player (no injection)', () => {
        // The card author cannot inject src, data-hls-src, or any other attribute.
        const url = 'https://platform.example/hls/live.m3u8';
        const out = lowerWithStream(
          '<sd-owncast-player src="https://evil.example/hack.m3u8" data-hls-src="https://evil.example/inject.m3u8" onerror="alert(1)"></sd-owncast-player>',
          url,
        );
        // Author-supplied srcs are dropped; only the platform URL appears.
        expect(out).toContain(`data-hls-src="${url}"`);
        expect(out).not.toContain('hack.m3u8');
        expect(out).not.toContain('inject.m3u8');
        expect(out.toLowerCase()).not.toContain('onerror');
      });

      it('uses placeholder when streamUrl is an empty string (falsy)', () => {
        const out = lowerWithStream('<sd-owncast-player></sd-owncast-player>', '');
        expect(out).toContain('class="sd-owncast-player-placeholder"');
        expect(out).not.toContain('data-hls-src');
      });
    });
  });
});

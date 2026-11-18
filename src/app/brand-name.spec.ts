import { parseThemeText, readBrandName } from './brand-name';

describe('brand name from the theme', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--sd-header-content');
    document.documentElement.style.removeProperty('--hug-header-content');
  });

  it('reads the first quoted string, either quote, with escapes', () => {
    expect(parseThemeText("'Acme'")).toBe('Acme');
    expect(parseThemeText('"Example"')).toBe('Example');
    expect(parseThemeText("'It\\'s ours'")).toBe("It's ours");
    expect(parseThemeText("'Acme' / 'Acme logo'")).toBe('Acme');
  });

  it('reads nothing from none, normal, blank, unquoted or empty text', () => {
    for (const raw of ['none', 'normal', '', '   ', 'Acme', "''", "'  '", null, undefined]) {
      expect(parseThemeText(raw as string)).withContext(String(raw)).toBeNull();
    }
  });

  it('falls back to what the page always said when no theme names it', () => {
    expect(readBrandName('hugmesh.net')).toBe('hugmesh.net');
  });

  it("uses the theme's wordmark, --sd- first and --hug- as its twin", () => {
    document.documentElement.style.setProperty('--hug-header-content', "'From hug'");
    expect(readBrandName('hugmesh.net')).toBe('From hug');
    document.documentElement.style.setProperty('--sd-header-content', "'From sd'");
    expect(readBrandName('hugmesh.net')).toBe('From sd');
  });
});

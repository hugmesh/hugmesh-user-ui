/**
 * The name this page calls itself: the theme's header text (`--sd-header-content`,
 * the wordmark the shell's banner shows too) when the theme sets one, else `fallback`.
 *
 * On the local Docker mesh the HTTPS door serves each domain's own stylesheet by Host
 * (generator look_serving), so acme.localhost welcomes you to "Acme" and example.localhost
 * to "Example" with no rebuild. (Copied from login-ui: every remote carries its own copy of the
 * small helpers it shares, as SessionService is.) The stylesheet is a render-blocking <link> in index.html,
 * so it is applied before the first read here; a page with no theme reads `fallback` and
 * says exactly what it always said.
 *
 * Only the first quoted string counts: the CSS `content` alt-text syntax
 * (`'Acme' / 'Acme logo'`) names the text before the slash, and `none` / `normal` set nothing.
 */
const TOKENS = ['--sd-header-content', '--hug-header-content'];

export function parseThemeText(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value || value === 'none' || value === 'normal') return null;
  const m = /^(["'])((?:\\.|(?!\1).)*)\1/.exec(value);
  if (!m) return null;
  const text = m[2].replace(/\\(.)/g, '$1').trim();
  return text || null;
}

export function readBrandName(fallback: string, root?: Element | null): string {
  if (typeof getComputedStyle !== 'function') return fallback;
  const element = root ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!element) return fallback;
  const style = getComputedStyle(element);
  for (const token of TOKENS) {
    const text = parseThemeText(style.getPropertyValue(token));
    if (text) return text;
  }
  return fallback;
}

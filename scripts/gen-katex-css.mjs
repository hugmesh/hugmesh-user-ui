/**
 * Regenerate src/app/katex-css.ts from the installed katex package.
 *
 * The card preview renders into a <iframe sandbox srcdoc> that is a NULL ORIGIN
 * with scripting OFF, so it can load no external stylesheet or font — any
 * relative url(fonts/...) in the upstream katex.min.css cannot resolve against
 * about:srcdoc and would only trigger failed fetches.
 *
 * So EVERY upstream @font-face has its woff2 file base64 data-URI-inlined
 * directly into the `src`, and the sandbox renders the COMPLETE KaTeX glyph
 * repertoire for real (offline/air-gapped, no network round-trip either): the
 * AMS blackboard-bold/symbol set, Caligraphic, Fraktur, Script, SansSerif and
 * Typewriter variants, and the Size1-4 stretchy delimiters, alongside the
 * plain-text math and default math-variable italic. This replaces an earlier
 * 7-font MINIMAL_SUBSET under which every other symbol set silently fell back
 * to the system serif/sans (the accessible MathML layer was unaffected either
 * way, but the visual glyphs were wrong).
 *
 * Bundle cost: katex ships the whole face set as ~254 KB of woff2, ~346 KB once
 * base64-encoded, and it lands in the LAZILY-LOADED cards chunk rather than the
 * initial bundle. The subset saved ~196 KB of that at the cost of correctness
 * for every non-trivial formula, which is the wrong trade for an editor whose
 * whole point is previewing what the author typed.
 *
 * A @font-face whose woff2 is missing from the installed package is STRIPPED
 * rather than left pointing at an unresolvable url(fonts/...) (see above).
 *
 * Run after a katex bump:  node scripts/gen-katex-css.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const fontsDir = resolve(root, 'node_modules/katex/dist/fonts');

const ver = JSON.parse(
  readFileSync(resolve(root, 'node_modules/katex/package.json'), 'utf8'),
).version;

let css = readFileSync(resolve(root, 'node_modules/katex/dist/katex.min.css'), 'utf8');

const inlined = [];
const strippedNames = [];
let inlinedBytes = 0;
css = css.replace(/@font-face\{[^}]*\}/g, (block) => {
  const m = block.match(/url\(fonts\/([^)]+)\.woff2\)/);
  const basename = m ? m[1] : null;
  const woff2Path = basename ? resolve(fontsDir, `${basename}.woff2`) : null;
  if (!woff2Path || !existsSync(woff2Path)) {
    // No woff2 to inline — strip rather than ship a dead url(fonts/...) (see header).
    strippedNames.push(basename ?? '(no woff2 url)');
    return '';
  }
  const woff2 = readFileSync(woff2Path);
  inlined.push(basename);
  inlinedBytes += woff2.length;
  const dataUri = `data:font/woff2;base64,${woff2.toString('base64')}`;
  // Keep font-family/style/weight as upstream declared them; single-format
  // (woff2-only) src — every browser this sandboxed iframe targets supports it,
  // and there is no network fallback to gain from listing woff/ttf.
  // `src:` is always the LAST declared property in an upstream @font-face
  // block (no trailing `;` before the closing `}`), so match through to the
  // end of the block rather than requiring a `;` that may not be there.
  return block.replace(/src:[^}]*/, `src:url(${dataUri}) format("woff2")`);
});
css = css.replace(/\n{2,}/g, '\n').trim();

const banner =
  '/**\n' +
  ` * Structural KaTeX CSS (v${ver}) for the sandboxed card preview, with EVERY\n` +
  ' * upstream font base64 data-URI-inlined (see gen-katex-css.mjs header).\n' +
  ' *\n' +
  ' * GENERATED — do not hand-edit. Regenerate after a katex bump with:\n' +
  ' *   node scripts/gen-katex-css.mjs   (see that script; mirrors this transform)\n' +
  ' *\n' +
  ' * Why a string constant: the card preview renders into a <iframe sandbox srcdoc>\n' +
  ' * that is a NULL ORIGIN with scripting OFF, so it can load NO external stylesheet\n' +
  ' * or font — every url() must already be inert (a data: URI) or absent. All\n' +
  ` * ${inlined.length} @font-face blocks katex ships are kept with their woff2 bytes\n` +
  ' * inlined as base64 data: URIs, so the FULL glyph repertoire renders for real\n' +
  ' * inside the sandbox: plain-text math, the default math-variable italic, the\n' +
  ' * AMS/Caligraphic/Fraktur/Script/SansSerif/Typewriter symbol sets and the\n' +
  ' * Size1-4 stretchy delimiters. (An earlier revision inlined only a 7-font\n' +
  ' * subset and let everything else fall back to the system serif/sans.) The\n' +
  ' * string is inert text (no script) and is scoped under .card-root by the\n' +
  ' * preview builder.\n' +
  ' */\n';

const out = `${banner}export const KATEX_CSS = ${JSON.stringify(css)};\n`;
writeFileSync(resolve(root, 'src/app/katex-css.ts'), out);
console.log(
  `wrote src/app/katex-css.ts (css ${css.length} bytes, ${inlined.length} font(s) inlined, ` +
    `${inlinedBytes} raw woff2 bytes` +
    (strippedNames.length ? `, stripped ${strippedNames.join(', ')}` : '') +
    ')',
);

/**
 * Regenerate src/app/katex-css.ts from the installed katex package.
 *
 * The card preview renders into a <iframe sandbox srcdoc> that is a NULL ORIGIN
 * with scripting OFF, so it can load no external stylesheet or font — any
 * relative url(fonts/...) in the upstream katex.min.css cannot resolve against
 * about:srcdoc and would only trigger failed fetches.
 *
 * For the MINIMAL_SUBSET font faces below we instead base64 data-URI-inline the
 * woff2 file directly into the @font-face `src`, so those glyphs render for
 * real inside the sandbox (offline/air-gapped, no network round-trip either).
 * This covers plain-text math + the default math-variable italic + the two
 * most common stretchy-delimiter sizes — the vast majority of simple
 * arithmetic/algebra a card author is likely to write. Every OTHER @font-face
 * block (AMS, Caligraphic, Fraktur, Script, SansSerif, Typewriter, Size3/4, …)
 * is still stripped: those glyphs fall back to the system serif/sans (the
 * accessible MathML layer is unaffected either way).
 *
 * Run after a katex bump:  node scripts/gen-katex-css.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const fontsDir = resolve(root, 'node_modules/katex/dist/fonts');

// The minimal, base64-inlined font subset — keyed by the woff2 basename
// (without extension) exactly as it appears in katex.min.css's url(fonts/...).
const MINIMAL_SUBSET = [
  'KaTeX_Main-Regular',
  'KaTeX_Main-Bold',
  'KaTeX_Main-Italic',
  'KaTeX_Main-BoldItalic',
  'KaTeX_Math-Italic',
  'KaTeX_Size1-Regular',
  'KaTeX_Size2-Regular',
];

const ver = JSON.parse(
  readFileSync(resolve(root, 'node_modules/katex/package.json'), 'utf8'),
).version;

let css = readFileSync(resolve(root, 'node_modules/katex/dist/katex.min.css'), 'utf8');

let inlinedCount = 0;
let inlinedBytes = 0;
css = css.replace(/@font-face\{[^}]*\}/g, (block) => {
  const m = block.match(/url\(fonts\/([^)]+)\.woff2\)/);
  const basename = m ? m[1] : null;
  if (!basename || !MINIMAL_SUBSET.includes(basename)) {
    return ''; // not in the minimal subset — strip (see header)
  }
  const woff2 = readFileSync(resolve(fontsDir, `${basename}.woff2`));
  inlinedCount += 1;
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
  ` * Structural KaTeX CSS (v${ver}) for the sandboxed card preview, with a\n` +
  ' * MINIMAL font subset base64 data-URI-inlined (see gen-katex-css.mjs header).\n' +
  ' *\n' +
  ' * GENERATED — do not hand-edit. Regenerate after a katex bump with:\n' +
  ' *   node scripts/gen-katex-css.mjs   (see that script; mirrors this transform)\n' +
  ' *\n' +
  ' * Why a string constant: the card preview renders into a <iframe sandbox srcdoc>\n' +
  ' * that is a NULL ORIGIN with scripting OFF, so it can load NO external stylesheet\n' +
  ' * or font — every url() must already be inert (a data: URI) or absent. The\n' +
  ` * ${MINIMAL_SUBSET.length} @font-face blocks for {${MINIMAL_SUBSET.join(', ')}}\n` +
  ' * are kept with their woff2 bytes inlined as base64 data: URIs, so those\n' +
  ' * glyphs render for real (covers plain-text math, the default math-variable\n' +
  ' * italic, and the two most common stretchy-delimiter sizes). Every OTHER\n' +
  ' * @font-face block (AMS, Caligraphic, Fraktur, Script, SansSerif, Typewriter,\n' +
  ' * Size3/4, …) is STRIPPED: their relative url(fonts/...) cannot resolve\n' +
  ' * against about:srcdoc, and inlining all 20 would bloat this bundle for\n' +
  ' * rarely-used symbol sets, so those glyphs fall back to the system\n' +
  ' * serif/sans (the accessible MathML layer is unaffected either way). The\n' +
  ' * string is inert text (no script) and is scoped under .card-root by the\n' +
  ' * preview builder.\n' +
  ' */\n';

const out = `${banner}export const KATEX_CSS = ${JSON.stringify(css)};\n`;
writeFileSync(resolve(root, 'src/app/katex-css.ts'), out);
console.log(
  `wrote src/app/katex-css.ts (css ${css.length} bytes, ${inlinedCount} font(s) inlined, ` +
    `${inlinedBytes} raw woff2 bytes)`,
);

/**
 * pagepin design-sync — tokens-only bundle generator (off-script).
 *
 * pagepin's console is a Vite app, not a component library, so there is no
 * compiled dist to feed the converter. This emits the claude.ai/design
 * "tokens-only DS" layout deterministically from pagepin's design tokens:
 * styles.css + tokens/ + _ds_bundle.css + an empty _ds_bundle.js + README +
 * the build-meta/anchor sidecars package-validate.mjs checks.
 *
 * SOURCE OF TRUTH: console/tailwind.config.js (theme.extend) and
 * console/src/index.css (@layer base/components). Keep the maps below in sync
 * with those files; re-run on any token change:  node .design-sync/build-bundle.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const outArg = process.argv.indexOf('--out');
const OUT = outArg !== -1 ? process.argv[outArg + 1] : join(HERE, '..', 'ds-bundle');

// ---- tokens (mirror of console/tailwind.config.js theme.extend) ----
const tide = { 50: '#e6f4f2', 100: '#cfe9e5', 200: '#bfe5df', 300: '#8fd3ca', 400: '#3dafa4', 500: '#14958a', 600: '#0f7c72', 700: '#0b6358', 800: '#0b5a53', 900: '#08433d', 950: '#06302c' };
const ink = { 50: '#fafafa', 100: '#f4f5f6', 200: '#e7e9eb', 300: '#d7dadd', 400: '#9aa1a9', 500: '#8a929b', 600: '#6b7480', 700: '#3a424b', 800: '#1b2127', 900: '#11161b' };
const radius = { chip: '7px', field: '9px', panel: '12px', card: '14px' };
const shadow = {
  card: '0 1px 2px rgba(17,22,27,.04)',
  lift: '0 2px 8px rgba(17,22,27,.06), 0 14px 30px -12px rgba(17,22,27,.14)',
  login: '0 12px 30px -16px rgba(17,22,27,.2)',
  frame: '0 24px 60px -28px rgba(17,22,27,.28), 0 2px 8px rgba(17,22,27,.05)',
  modal: '0 20px 50px -18px rgba(0,0,0,.5)',
  toast: '0 10px 30px -8px rgba(0,0,0,.4)',
};
const fontSans = "'Hanken Grotesk', system-ui, -apple-system, sans-serif";
const fontMono = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

// ---- tokens/tokens.css : every token as a --pp-* custom property ----
let tokensCss = '/* pagepin tokens — generated from console/tailwind.config.js. Do not hand-edit. */\n:root {\n';
for (const [k, v] of Object.entries(tide)) tokensCss += `  --pp-tide-${k}: ${v};\n`;
for (const [k, v] of Object.entries(ink)) tokensCss += `  --pp-ink-${k}: ${v};\n`;
for (const [k, v] of Object.entries(radius)) tokensCss += `  --pp-radius-${k}: ${v};\n`;
for (const [k, v] of Object.entries(shadow)) tokensCss += `  --pp-shadow-${k}: ${v};\n`;
tokensCss += `  --pp-font-sans: ${fontSans};\n  --pp-font-mono: ${fontMono};\n}\n`;

// ---- _ds_bundle.css : the shipped utility + component classes (real CSS) ----
let css = '/* pagepin design classes — generated; mirrors the tailwind preset extension + @layer components. Do not hand-edit. */\n';
css += 'html { -webkit-font-smoothing: antialiased; }\n';
css += 'body { font-family: var(--pp-font-sans); background-color: var(--pp-ink-50); color: var(--pp-ink-800); background-image: radial-gradient(rgba(15,124,114,.05) 1px, transparent 1px); background-size: 22px 22px; }\n';
css += '::selection { background: var(--pp-tide-100); color: var(--pp-tide-900); }\n';
for (const [name, map] of [['tide', tide], ['ink', ink]]) {
  for (const k of Object.keys(map)) {
    css += `.text-${name}-${k} { color: var(--pp-${name}-${k}); }\n`;
    css += `.bg-${name}-${k} { background-color: var(--pp-${name}-${k}); }\n`;
    css += `.border-${name}-${k} { border-color: var(--pp-${name}-${k}); }\n`;
  }
}
for (const k of Object.keys(radius)) css += `.rounded-${k} { border-radius: var(--pp-radius-${k}); }\n`;
for (const k of Object.keys(shadow)) css += `.shadow-${k} { box-shadow: var(--pp-shadow-${k}); }\n`;
css += '.font-sans { font-family: var(--pp-font-sans); }\n.font-mono { font-family: var(--pp-font-mono); }\n';
css += '@keyframes pp-fade-up { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }\n';
css += '@keyframes pp-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }\n';
css += '@keyframes pp-pulse-dot { 0%,100% { opacity: 1; } 50% { opacity: .4; } }\n';
css += '.animate-fade-up { animation: pp-fade-up .3s ease both; }\n.animate-toast-in { animation: pp-toast-in .25s ease both; }\n.animate-pulse-dot { animation: pp-pulse-dot 2.4s ease-in-out infinite; }\n';
// component classes (expanded from console/src/index.css @layer components)
css += '.btn { display: inline-flex; align-items: center; justify-content: center; gap: .375rem; border: 1px solid transparent; border-radius: var(--pp-radius-field); padding: .5rem .875rem; font-size: .875rem; line-height: 1.25rem; font-weight: 600; cursor: pointer; transition: color .15s, background-color .15s, border-color .15s, box-shadow .15s; }\n';
css += '.btn:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(20,149,138,.4); }\n';
css += '.btn:disabled { cursor: not-allowed; opacity: .5; }\n';
css += '.btn-primary { background-color: var(--pp-tide-600); color: #fff; }\n.btn-primary:hover { background-color: var(--pp-tide-700); }\n.btn-primary:active { background-color: var(--pp-tide-800); }\n';
css += '.btn-ghost { background-color: #fff; border-color: var(--pp-ink-200); color: var(--pp-ink-600); }\n.btn-ghost:hover { border-color: var(--pp-tide-300); color: var(--pp-tide-700); }\n';
css += '.btn-danger-ghost { background-color: #fff; border-color: var(--pp-ink-200); color: var(--pp-ink-500); }\n.btn-danger-ghost:hover { border-color: #fca5a5; background-color: #fef2f2; color: #dc2626; }\n';
css += '.input { width: 100%; border-radius: var(--pp-radius-field); border: 1px solid var(--pp-ink-300); background: #fff; padding: .5rem .75rem; font-size: .875rem; line-height: 1.25rem; color: var(--pp-ink-800); }\n.input::placeholder { color: var(--pp-ink-400); }\n.input:focus { outline: none; border-color: var(--pp-tide-600); box-shadow: 0 0 0 2px rgba(15,124,114,.1); }\n';

// ---- styles.css : remote fonts + local closure (tokens before classes) ----
const stylesCss =
  '@import url("https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap");\n' +
  '@import "./tokens/tokens.css";\n' +
  '@import "./_ds_bundle.css";\n';

// ---- _ds_bundle.js : tokens-only, empty namespace ----
const header = { namespace: 'Pagepin', components: [], sourceHashes: {}, inlinedExternals: [] };
const bundleJs =
  `/* @ds-bundle: ${JSON.stringify(header)} */\n` +
  "(function () { if (typeof window !== 'undefined') { window.Pagepin = window.Pagepin || {}; } })();\n";

// ---- README : conventions header + generated token index ----
let readme = '';
try { readme += readFileSync(join(HERE, 'conventions.md'), 'utf8').trimEnd() + '\n\n'; } catch { /* header optional */ }
readme += '---\n\n## Token reference (generated)\n\n';
readme += '_All values below are emitted as `--pp-*` CSS variables in `tokens/tokens.css` and as `text-/bg-/border-`, `rounded-`, `shadow-`, `font-` classes in `_ds_bundle.css`._\n\n';
readme += '### Color — tide (brand teal)\n\n| shade | hex |\n|---|---|\n' + Object.entries(tide).map(([k, v]) => `| ${k} | \`${v}\` |`).join('\n') + '\n\n';
readme += '### Color — ink (neutral)\n\n| shade | hex |\n|---|---|\n' + Object.entries(ink).map(([k, v]) => `| ${k} | \`${v}\` |`).join('\n') + '\n\n';
readme += '### Radius\n\n| name | value |\n|---|---|\n' + Object.entries(radius).map(([k, v]) => `| \`rounded-${k}\` | ${v} |`).join('\n') + '\n\n';
readme += '### Shadow\n\n' + Object.keys(shadow).map((k) => `\`shadow-${k}\``).join(' · ') + '\n\n';
readme += '### Type\n\n`font-sans` → ' + fontSans + '  \n`font-mono` → ' + fontMono + '\n\n';
readme += '### Component classes\n\n`btn btn-primary` · `btn btn-ghost` · `btn btn-danger-ghost` · `input`\n';

// ---- write everything ----
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'tokens'), { recursive: true });
writeFileSync(join(OUT, 'tokens', 'tokens.css'), tokensCss);
writeFileSync(join(OUT, '_ds_bundle.css'), css);
writeFileSync(join(OUT, 'styles.css'), stylesCss);
writeFileSync(join(OUT, '_ds_bundle.js'), bundleJs);
writeFileSync(join(OUT, 'README.md'), readme);
writeFileSync(join(OUT, '.ds-build-meta.json'), JSON.stringify({ componentCount: 0, shape: 'package', runtimeFontPrefixes: ['Hanken Grotesk', 'JetBrains Mono'] }, null, 2));
const styleSha = createHash('sha256').update(stylesCss).digest('hex');
const bundleSha12 = createHash('sha256').update(bundleJs).digest('hex').slice(0, 12);
writeFileSync(join(OUT, '_ds_sync.json'), JSON.stringify({ shape: 'package', styleSha, renderHashes: {}, sourceKeys: {}, sourceHashes: {}, bundleSha12 }, null, 2));
writeFileSync(join(OUT, '_ds_needs_recompile'), JSON.stringify({ by: 'design-sync-cli' }));

console.log(`wrote tokens-only bundle → ${OUT}`);

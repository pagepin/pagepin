/**
 * Pre-bundle the comment-overlay design components into a clean ESM dist entry.
 *   - generates src/comments-source.generated.js from the REAL static/comments.js
 *     (the baseline injects it at runtime as a <script>, so currentScript works)
 *   - bundles entry.tsx with React external (converter provisions it via _vendor/)
 * No store/api alias or location shim needed: the concepts are pure React and the
 * real overlay is injected as a script, not bundled.
 *
 * Run:  cd .design-sync/comments && npm i && node prebundle.mjs
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // .design-sync/comments
const REPO = resolve(HERE, '..', '..');
const SRC = join(HERE, 'src');
const DIST = join(HERE, 'dist');
const CONSOLE_NM = join(REPO, 'console', 'node_modules');

// 1. inline the real overlay source as a string module
const commentsJs = readFileSync(join(REPO, 'static', 'comments.js'), 'utf8');
writeFileSync(
  join(SRC, 'comments-source.generated.js'),
  '// GENERATED from static/comments.js by prebundle.mjs — do not edit.\nexport default ' +
    JSON.stringify(commentsJs) +
    ';\n',
);

mkdirSync(DIST, { recursive: true });

await build({
  entryPoints: [join(SRC, 'entry.tsx')],
  outfile: join(DIST, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  absWorkingDir: REPO,
  nodePaths: [CONSOLE_NM],
  external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  logLevel: 'info',
});

copyFileSync(join(SRC, 'index.d.ts'), join(DIST, 'index.d.ts'));
console.log('prebundle (comments) → ' + join(DIST, 'index.js'));

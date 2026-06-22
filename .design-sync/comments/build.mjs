/**
 * Reproducible build of the comment-overlay design bundle. One command:
 *   cd .design-sync/comments && npm i && node build.mjs
 * Steps:
 *   1. prebundle: regenerate comments-source.generated.js from static/comments.js + esbuild entry.tsx
 *   2. compile the Tailwind CSS → dist/_ds_bundle.css, ensure the font @import leads it
 *   3. run the design-sync converter → ds-bundle-comments/
 *   4. re-prepend the brand-font @import to the emitted styles.css
 * Then validate:  node ../../.ds-sync/package-validate.mjs ../../ds-bundle-comments
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // .design-sync/comments
const REPO = resolve(HERE, '..', '..');
const FONT_IMPORT =
  '@import url("https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap");\n';

const run = (cmd, args, cwd) => {
  console.log('$', cmd, args.join(' '));
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
};
const prependOnce = (file, prefix, marker) => {
  const cur = readFileSync(file, 'utf8');
  if (!cur.includes(marker)) writeFileSync(file, prefix + cur);
};

run('node', ['prebundle.mjs'], HERE);

run(
  join(REPO, 'console', 'node_modules', '.bin', 'tailwindcss'),
  ['-c', 'tailwind.design.mjs', '-i', '../../console/src/index.css', '-o', 'dist/_ds_bundle.css', '--minify'],
  HERE,
);
prependOnce(join(HERE, 'dist', '_ds_bundle.css'), FONT_IMPORT, 'fonts.googleapis');

run(
  'node',
  [
    join(REPO, '.ds-sync', 'package-build.mjs'),
    '--config', '.design-sync/comments/config.json',
    '--node-modules', 'console/node_modules',
    '--entry', '.design-sync/comments/dist/index.js',
    '--out', 'ds-bundle-comments',
  ],
  REPO,
);

prependOnce(join(REPO, 'ds-bundle-comments', 'styles.css'), FONT_IMPORT, 'fonts.googleapis');

console.log('\n✓ build complete → ds-bundle-comments  (validate: node .ds-sync/package-validate.mjs ds-bundle-comments)');

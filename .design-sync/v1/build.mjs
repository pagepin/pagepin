/**
 * Reproducible build of the pagepin design-sync v1 bundle. One command:
 *   cd .design-sync/v1 && npm i && node build.mjs
 * Chains the four steps so a re-sync can't drop one (esp. the font @import,
 * which the converter's styles.css regeneration would otherwise lose):
 *   1. prebundle the real console screens (alias store/api → mocks, shim location)
 *   2. compile the console Tailwind CSS → dist/_ds_bundle.css (cfg.cssEntry)
 *   3. run the design-sync converter → ds-bundle-v1/
 *   4. prepend the brand-font @import to the emitted styles.css
 * Then validate:  node ../../.ds-sync/package-validate.mjs ../../ds-bundle-v1
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // .design-sync/v1
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

// 1. prebundle the real screens
run('node', ['prebundle.mjs'], HERE);

// 2. compile the console Tailwind CSS, then ensure the font @import leads cssEntry
run(
  join(REPO, 'console', 'node_modules', '.bin', 'tailwindcss'),
  ['-c', 'tailwind.design.mjs', '-i', '../../console/src/index.css', '-o', 'dist/_ds_bundle.css', '--minify'],
  HERE,
);
prependOnce(join(HERE, 'dist', '_ds_bundle.css'), FONT_IMPORT, 'fonts.googleapis');

// 3. design-sync converter
run(
  'node',
  [
    join(REPO, '.ds-sync', 'package-build.mjs'),
    '--config', '.design-sync/v1/config.json',
    '--node-modules', 'console/node_modules',
    '--entry', '.design-sync/v1/dist/index.js',
    '--out', 'ds-bundle-v1',
  ],
  REPO,
);

// 4. the converter regenerates styles.css without the remote font @import — re-add it
prependOnce(join(REPO, 'ds-bundle-v1', 'styles.css'), FONT_IMPORT, 'fonts.googleapis');

console.log('\n✓ build complete → ds-bundle-v1  (validate: node .ds-sync/package-validate.mjs ds-bundle-v1)');

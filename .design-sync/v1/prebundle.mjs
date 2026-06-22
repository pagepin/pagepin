/**
 * Pre-bundle the REAL console screens into a clean ESM dist entry for the
 * design-sync converter. The two things the converter can't do itself happen here:
 *   - alias ../store / ../api (in the console components) → mock-store / mock-api
 *   - rewrite bare `location` → __ppLoc (the controllable shim) via define+inject
 * React is left external so the converter provisions it from _vendor/.
 *
 * Run:  cd .design-sync/v1 && npm i && node prebundle.mjs
 * Out:  .design-sync/v1/dist/{index.js,index.d.ts}
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // .design-sync/v1
const REPO = resolve(HERE, '..', '..'); // repo root
const SRC = join(HERE, 'src');
const DIST = join(HERE, 'dist');
const CONSOLE_NM = join(REPO, 'console', 'node_modules');

const MOCK_STORE = join(SRC, 'mock-store.ts');
const MOCK_API = join(SRC, 'mock-api.ts');
const LOC_SHIM = join(SRC, 'loc-shim.js');

/** Redirect the console's own `./store` / `../api` imports to the mocks. */
const aliasStoreApi = {
  name: 'alias-store-api',
  setup(b) {
    b.onResolve({ filter: /(^|\/)(store|api)$/ }, (args) => {
      if (!args.importer.replace(/\\/g, '/').includes('/console/src')) return undefined;
      const base = args.path.split('/').pop();
      if (base === 'store') return { path: MOCK_STORE };
      if (base === 'api') return { path: MOCK_API };
      return undefined;
    });
  },
};

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
  external: [
    'react',
    'react-dom',
    'react-dom/client',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
  ],
  define: { location: '__ppLoc' },
  inject: [LOC_SHIM],
  plugins: [aliasStoreApi],
  logLevel: 'info',
});

copyFileSync(join(SRC, 'index.d.ts'), join(DIST, 'index.d.ts'));
console.log('prebundle → ' + join(DIST, 'index.js'));

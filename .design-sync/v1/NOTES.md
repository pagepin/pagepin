# design-sync notes — pagepin-v1 (real interactive console screens)

## Shape: off-script, real components backed by mocks

Unlike the tokens-only `pagepin-ui` sync (repo-root `.design-sync/`, project `bcdf8e1c-…`), **pagepin-v1** ships the **real console screens** as interactive components so the console can be redesigned (interactions included) in claude.ai/design.

- Project: **pagepin-v1** — `29bfd5ab-5744-4ab5-b994-66fdb5914495` (https://claude.ai/design/p/29bfd5ab-5744-4ab5-b994-66fdb5914495). Pinned in `config.json`.
- 13 prop-free screen exports on `window.Pagepin.*`, grouped auth / sites / account / admin / prototype.
- The trick: the converter's `package-build.mjs` can't alias or shim, so `prebundle.mjs` (esbuild) does it first, then feeds a clean ESM dist entry to the converter:
  - `../store` / `../api` (in the real components) → `src/mock-store.ts` / `src/mock-api.ts` (esbuild alias plugin).
  - bare `location` → `__ppLoc` (esbuild `define` + `inject src/loc-shim.js`) so nothing navigates the preview iframe; `href=`/`assign` dispatch a `ppnav` event that `ConsolePrototype` re-renders the real `<App/>` against.
  - `react`/`react-dom`/`react/jsx-runtime` external → the converter provisions them via `_vendor/`.

## How to re-sync

```sh
cd .design-sync/v1 && npm i          # fresh clone: installs esbuild + @types/react (BOTH required —
                                     #   @types/react makes the converter discover the 13 exports)
node build.mjs                       # prebundle → tailwind css → converter → re-add font @import
cd ../.. && node .ds-sync/package-validate.mjs ds-bundle-v1   # must exit 0; chromium cached at ~/Library/Caches/ms-playwright
```
Then upload via the **atomic path** (project is now non-empty / pinned): `finalize_plan` (writes/deletes as in this run) → sentinel `_ds_needs_recompile` → content → sentinel re-arm → `_ds_sync.json` LAST.

The converter must run from the repo root; `--config .design-sync/v1/config.json` makes `cfgHome` resolve to `.design-sync/v1` (so `readmeHeader: conventions.md` and `docsDir: groups` are v1-relative). `--out ds-bundle-v1` (must be OUTSIDE `.design-sync/`). PKG_DIR resolves to `.design-sync/v1` via its `package.json`.

## Re-sync risks (watch-list)

- **Mock interface drift (main one).** `mock-store.ts` mirrors `console/src/store.ts`'s `AppState` and `mock-api.ts` mirrors `console/src/api.ts`'s export surface (the `api` object + `login`/`signup`/`logout`/`deploySite`/`fetchAuthConfig`/`acceptInvite`/`fetchInviteInfo`/`redirectToLogin`/`ApiError`). If the real store/api gains or renames a member a screen calls, the prebundle still compiles but that screen throws at render — update the mock to match, rebuild, re-validate.
- **Token/CSS drift.** `tailwind.design.mjs` hand-mirrors `console/tailwind.config.js` `theme.extend`. If the palette/radii/shadows/fonts change there, update it here or the synced look goes stale. (Same class of risk as pagepin-ui's `build-bundle.mjs`.)
- **Font @import.** `build.mjs` step 4 re-prepends the Google Fonts `@import` to the emitted `styles.css` because the converter regenerates `styles.css` without it (package shape only hoists remote imports from a storybook static dir, which we don't have). Don't drop that step or previews fall back to system fonts.
- **location shim scope.** `define: {location: __ppLoc}` only rewrites bare `location.*` in MY pre-bundle (react/react-dom are external and untouched). If a component starts using `window.location` (member access) instead of bare `location`, the shim won't intercept it — it would navigate the iframe. Grep new screens for `window.location` before adding them.
- **New screens.** When the console adds a component, add a prop-free wrapper export in `src/entry.tsx`, a declaration in `src/index.d.ts`, and a `groups/<Name>.md` stub (category frontmatter) — else it won't appear or won't be grouped.
- **@types/react required for discovery.** Component discovery (`exportedNames`) parses `dist/index.d.ts`; without `@types/react` resolvable in `.design-sync/v1/node_modules` it reads 0 exports → `[ZERO_MATCH]`. A fresh clone MUST `npm i` here first.
- **Two projects, one repo.** The converter writes `previews/`/`.cache/` to the repo-root `.design-sync/` (CWD-relative), shared with pagepin-ui. v1 authors no previews (all 13 are full-render floor cards), so there is no collision today. If you ever author `.design-sync/previews/<Name>.tsx`, they're shared state — name them unambiguously.
- **Fixtures are demo data.** `src/fixtures.ts` (admin user "wenqi", sample sites, device code K7QP-2F9X) is illustrative only. Timestamps are computed relative to load time so cards stay fresh.
- **Not the real backend.** Submitting Login, deploying in the drop-zone, rotating tokens, suspending users etc. mutate in-memory mock state only — by design. Interactions are real; effects are local.

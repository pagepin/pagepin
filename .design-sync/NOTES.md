# design-sync notes — pagepin-ui

## Shape: off-script, tokens-only

pagepin's `console/` is a private Vite **app**, not a component library — no Storybook, no dist of reusable exports, and its components are coupled to the zustand store + api client. So there are no shippable React components for claude.ai/design. The sync ships pagepin's **design language only** (the tokens-only DS case): `styles.css` + `tokens/` + `_ds_bundle.css` + an empty `_ds_bundle.js`, plus a conventions guide.

The skill converter (`package-build.mjs`) is **not** used (it needs a buildable component dist). Instead `.design-sync/build-bundle.mjs` generates the bundle deterministically and `package-validate.mjs` gates it.

## How to re-sync

```sh
node .design-sync/build-bundle.mjs --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle --no-render-check   # re-stage .ds-sync from the skill first
```
Then upload via the **atomic path** (the project is now non-empty / pinned in config.json): `finalize_plan` → sentinel → content writes → reconcile deletes → sentinel re-arm → `_ds_sync.json` last.

## Known render warns

- `[RENDER_SKIPPED]` is expected and correct here: tokens-only, zero component previews — there is nothing to render-check. Not a gap; do not install Chromium to "fix" it.

## Re-sync risks (watch-list)

- **Token drift (the main one).** `build-bundle.mjs` hardcodes the token values mirrored from `console/tailwind.config.js` (`theme.extend`) and `console/src/index.css` (`@layer base`/`components`). It does **not** read those files. If the palette, radii, shadows, fonts, or the `btn`/`input` classes change there, update the maps in `build-bundle.mjs` to match, or the synced design language goes stale silently.
- **Render env assumption.** The shipped `_ds_bundle.css` only defines pagepin's *custom* preset extension (tide/ink colors, custom radii/shadows/fonts, `btn`/`input`). Generic layout utilities (flex, grid, gap, padding, text sizing) are assumed available from Tailwind core in the claude.ai/design render env. If that stops being true, layout utilities won't resolve.
- **Fonts load remotely.** Hanken Grotesk + JetBrains Mono come from a Google Fonts `@import` in `styles.css` (`[FONT_REMOTE]`), not shipped `@font-face`. `runtimeFontPrefixes` is set in `.ds-build-meta.json` as a belt-and-suspenders. If offline/blocked, designs fall back to system fonts.
- **No real components were verified** (there are none). If pagepin ever grows a standalone primitives library (`@pagepin/ui` + stories), switch to the real package/storybook shape and author + verify component previews.

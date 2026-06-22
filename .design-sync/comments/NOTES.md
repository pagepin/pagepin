# design-sync notes — pagepin-comments (comment-overlay redesign exploration)

A third design-sync project, separate from `pagepin-ui` (tokens) and `pagepin-v1` (real console screens). It holds the **comment / review experience**: the real shipping overlay as a baseline plus three interaction redesigns, all over one sample hosted page.

- Project: **pagepin-comments** — `3bdd6e2c-299f-46ba-9365-cce98727ae7c` (https://claude.ai/design/p/3bdd6e2c-299f-46ba-9365-cce98727ae7c). Pinned in `config.json`. globalName `PagepinComments`.
- 6 components, grouped: `current` (real overlay), `a-margin-rail` (ConceptRail), `b-keyboard` (ConceptKeyboard), `c-atlas` (ConceptAtlas), `d-keyboard-v2` (ConceptKeyboardV2), `e-tideline-mobile` (ConceptTideline).
- **v2 (ConceptKeyboardV2)** is the **chosen, trimmed desktop direction** (won the desktop scorecard 8.27/10). The rail is a FLOATING right drawer (page renders full-width, zero reflow — `scrollRef` is `absolute inset-0`, drawer is `absolute right-0` translateX), mouse-first hover-"+" creation, clear resolved state. Leading 16px is a transparent→opaque feather (the "edge-gap" decision: drawer overlaps the page's right gutter, content shows through frosted; never reflow the page; collapse `\\` is the guaranteed zero-occlusion escape). Keep DRAWER_W=320 (card floor). **Width-aware auto-collapse**: drawer auto-retracts to its spine at ≤1366 (`NARROW_MAX`) / auto-expands at ≥1536 (`WIDE_MIN`), only on a boundary *crossing* (hysteresis) so a manual `\\` toggle persists in the 1367–1535 band; initial state derived from width. Drops narrow-width occlusion (was 96px@1280 / 53px@1366) to 0 without pressing collapse.
- **Positioning is LOCKED: "fast pinpoint review, lightweight, just-enough, no burden."** Management (priority / severity / sign-off / assignment / activity feed) is OUT of the overlay → if ever built, it lives in the **console**, not here. The burden that matters is concept-count, not pixels. A `priority` dot was prototyped then **deliberately removed** (it was the lightest slice of the management layer; once positioning locked to pure review it was scope creep). A "just-enough" trim pass (3-perspective panel) then **cut**: the ⌘K command palette (whole modal + state + keymap), the wider keyboard grammar (kept only `j/k` move · `r` resolve · `c` comment · `\\` hide + Esc; dropped e/y/g/G/1-4/u), the resolve Undo-toast ceremony, and the redundant header "New comment" button (element comments come from the in-context hover "+ comment" pill; `c` is a quiet accelerator; the one header button is now just the whole-page note). KEEP spine: pins + glow camera + one in-context create + reply + resolve-and-advance + optional silent kind tags + the document-order drawer. Do not re-add palette/priority/extra keys without re-opening the positioning question.
- **Tideline (ConceptTideline)** is the phone/narrow form factor: a Maps-style bottom sheet (PEEK/HALF/FULL detents) over a true-mobile-width page, rendered inside a phone device frame. Chosen via a diverge→judge→critique workflow (6 candidates, 92/100) and hardened against 20 adversarial findings (always-visible "+ Note" bubble FAB in the right thumb corner; AIM mode dims + lights up the 7 anchorable elements + bottom instruction chip + nearest-anchor snap; camera parks the anchor in the LIVE clear zone above the sheet, NOT a fixed viewport fraction; footer clearance via scroll-area padding, never a node injected into the page). Caveat: in the fixed phone frame, `ReviewPage`'s Tailwind `sm:` breakpoints key off the real browser viewport, not the 390px frame, so the sample page doesn't fully collapse to mobile layout in the preview — on a real 390px device it would. The review UI itself is the artifact under test and is correct.

## Shape

Off-script, like `pagepin-v1`, but with two flavours of component:

- **CommentOverlayCurrent** = the REAL `static/comments.js`, injected at runtime as a `<script>` (so `document.currentScript` provides its config) over a sample page (`review-page.tsx`), with `window.fetch` stubbed (in `comments-baseline.tsx`) to serve the mock viewer + threads and mutate them locally. `prebundle.mjs` regenerates `src/comments-source.generated.js` from `static/comments.js` on every build, so the baseline always reflects the shipping overlay.
- **ConceptRail / ConceptKeyboard / ConceptAtlas** = authored redesign prototypes (NOT shipped code) — interactive React over the same `review-page.tsx` + `concept-kit.tsx` (shared `useThreads` store + `useAnchorRects`). They are design exploration, intentionally divergent (margin-rail / keyboard-cockpit / atlas-camera).

The concepts came from a design-sync ideation+judge workflow (6 lenses → 3 picks); the full picks were cached in `.specs.json` (gitignored).

## How to re-sync

```sh
cd .design-sync/comments && npm i      # esbuild + @types/react (both required for discovery)
node build.mjs                         # regen overlay source → prebundle → tailwind → converter → font @import
cd ../.. && node .ds-sync/package-validate.mjs ds-bundle-comments   # must exit 0; 4/4 render
```
Then upload via the **atomic path** (project non-empty / pinned): `finalize_plan` (writes/deletes as in this run) → sentinel → content → sentinel re-arm → `_ds_sync.json` LAST.

## Re-sync risks (watch-list)

- **Overlay source is regenerated.** `prebundle.mjs` reads `static/comments.js` fresh each build, so the baseline tracks the shipping overlay automatically. If comments.js changes its config contract (currently `data-handle/slug/path/version` on `document.currentScript`) or its API paths (`/api/viewer`, `/api/comments/{handle}/{slug}`, `/threads/{id}/replies|PATCH|DELETE`), update the fetch stub in `comments-baseline.tsx` to match or the baseline silently shows no overlay (anonymous-viewer path) or no threads.
- **Mock data drift.** `comment-fixtures.ts` thread/viewer shapes mirror the real comments API; the concepts read them via `concept-kit.tsx`. Keep the `PpThread`/`PpComment`/`VIEWER` shapes aligned with the server if you reuse this against real data.
- **Concepts are prototypes, not the product.** ConceptRail/Keyboard/Atlas are design artifacts for evaluation. If one is chosen for real, it becomes a console/overlay implementation task — these files are the interaction spec, not shippable code.
- **Font @import** — `build.mjs` step 4 re-prepends the Google Fonts `@import` to `styles.css` (the converter regenerates it without it). Same as the other two projects.
- **Sample page is fixed.** `review-page.tsx` element ids (#hero-title/#hero-cta/#feature-2/#pricing) are the anchor contract for fixtures + concepts; changing ids means updating `comment-fixtures.ts` selectors.
- **Three projects, one repo.** pagepin-ui (`.design-sync/`, tokens), pagepin-v1 (`.design-sync/v1/`, real screens), pagepin-comments (`.design-sync/comments/`, this). Each pins its own projectId. The converter writes `previews/`/`.cache/` to the repo-root `.design-sync/` (CWD-relative) — shared, but none of the three author previews, so no collision.

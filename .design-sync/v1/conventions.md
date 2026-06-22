# pagepin console — v1 screens (redesign baseline)

This design system is the **current (v1) pagepin console**, captured as real, interactive React screens so it can be redesigned in place — including interaction changes, not just looks. Every export is a real console screen compiled from the shipping source; its data layer (auth, sites, tokens, admin) is replaced with in-memory fixtures so it renders populated and stays clickable (open panels, type in fields, toggle visibility, expand cards, walk the flow). Treat these as the "before" you are iterating away from.

## What the exports are

Each export is a prop-free, self-contained screen:

- `LoginScreen`, `SignupScreen`, `AcceptInviteScreen`, `ActivateScreen`, `HandleSetupScreen` — the unauthenticated / onboarding flow.
- `SitesScreen` — the authenticated home: top bar, deploy drop-zone, and the site list.
- `SiteCardScreen` — one expandable site card with its share / settings / versions panels.
- `SettingsScreen`, `TokenManagerScreen`, `TokenDialogScreen`, `PasswordDialogScreen` — account + API-token surfaces.
- `AdminScreen` — instance administration.
- `ConsolePrototype` — the **whole app wired together**: real routing across every screen (sign in, navigate the top bar, open settings/admin, sign out). Start here to design flows and transitions.

## Brand language

Color runs on two ramps, surfaced as Tailwind utilities (`text-…`, `bg-…`, `border-…`):

- **Tide** — the brand teal accent (`tide-600` `#0f7c72` primary, `tide-700`/`tide-800` for hover/active, `tide-50`/`tide-100` for tinted fills). Used for primary actions, focus rings, links, and "active/healthy" states.
- **Ink** — a cool neutral ramp from `ink-50` (page background) through `ink-200`/`ink-300` (borders) to `ink-800`/`ink-900` (headings, body). Text is ink, never pure black.

The page sits on `ink-50` with a faint teal dot-grid background. Surfaces are white cards with hairline `ink-200` borders.

Shape and depth: rounded scale `rounded-chip` (7px) · `rounded-field` (9px, inputs/buttons) · `rounded-panel` (12px) · `rounded-card` (14px, cards/modals). Shadows are soft and layered — `shadow-card` (resting), `shadow-lift` (hover/raised), `shadow-login`/`shadow-frame` (auth & framed surfaces), `shadow-modal`/`shadow-toast` (overlays).

Type: `font-sans` is **Hanken Grotesk** (UI), `font-mono` is **JetBrains Mono** (tokens, codes, slugs). Headings are bold and tight (`font-bold tracking-tight`); secondary text is `ink-400`/`ink-500` at `text-sm`/`text-xs`.

Component idioms (the `@layer components` classes): `btn btn-primary` (teal solid), `btn btn-ghost` (white, ink border, teal on hover), `btn btn-danger-ghost` (white → red on hover), and `input` (full-width, `ink-300` border, teal focus ring). Motion is subtle: `animate-fade-up` for entrances, `animate-toast-in` for toasts, `animate-pulse-dot` for live/expiry dots.

Overlays (dialogs, confirm, toasts) render through portals over an `ink-900/55` scrim; toasts stack bottom-center.

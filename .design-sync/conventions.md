# pagepin design language

pagepin's UI is a small, calm, utility-class system: a cool neutral canvas, one teal brand accent, generous radii, and soft shadows. Hanken Grotesk for prose, JetBrains Mono for anything technical (slugs, tokens, counts). There are no shippable React components in this project — it ships the **token + class foundation**, and you compose UI from it with the same vocabulary pagepin's own code uses.

## Setup

No provider or theme wrapper. Styling is plain CSS shipped in `styles.css`: a base layer, CSS custom properties, and ready-made utility/component classes. The page already gets pagepin's look from the base layer — a cool off-white canvas (`ink-50`) with a faint teal dot grid and `ink-800` text — so don't restyle `body`. Fonts load via `styles.css` (Hanken Grotesk + JetBrains Mono from Google Fonts).

## The idiom — Tailwind-style classes

Use Tailwind **core** utilities for layout (flex, grid, gap, padding, text sizing) as usual. For pagepin's brand, use these shipped custom families:

- **Color** (`text-`/`bg-`/`border-`): `tide-{50,100,200,300,400,500,600,700,800,900,950}` — the brand teal; **`tide-600` is the primary action color** (`700`/`800` = hover/active). `ink-{50,100,200,300,400,500,600,700,800,900}` — cool neutrals: `ink-900/800` = primary text, `ink-500/600` = secondary text, `ink-200` = borders, `ink-50/100` = surfaces. (Standard `red-*`/`amber-*` from Tailwind core are used for danger/warning states.)
- **Radius**: `rounded-chip` (7px · pills, badges), `rounded-field` (9px · inputs, buttons), `rounded-panel` (12px), `rounded-card` (14px · cards).
- **Shadow**: `shadow-card` (resting), `shadow-lift` (hover), `shadow-modal`, `shadow-toast`, `shadow-frame`, `shadow-login`.
- **Type**: `font-sans` (Hanken Grotesk · default UI), `font-mono` (JetBrains Mono · slugs, tokens, counts, technical labels).
- **Motion**: `animate-fade-up`, `animate-toast-in`, `animate-pulse-dot`.

## Component classes (ready-made)

- Buttons: `btn btn-primary` (filled teal), `btn btn-ghost` (white/outline), `btn btn-danger-ghost` (destructive). Always pair `btn` with one variant.
- Text input: `input`.

Every token is also a CSS variable for inline styles: `var(--pp-tide-600)`, `var(--pp-radius-card)`, `var(--pp-shadow-card)`, `var(--pp-font-mono)`, etc.

## Where the truth lives

Read `tokens/tokens.css` (every token value as a `--pp-*` variable) and `_ds_bundle.css` (the utility and component classes) before styling. Those are the authoritative, shipped definitions.

## One idiomatic snippet

```html
<div class="rounded-card border border-ink-200 bg-white shadow-card p-4">
  <div class="flex items-center justify-between">
    <span class="font-mono text-sm font-semibold text-ink-800">my-report</span>
    <span class="rounded-chip bg-tide-50 px-2 py-0.5 text-xs font-semibold text-tide-700">Public</span>
  </div>
  <p class="mt-1 text-sm text-ink-500">Q1 outbound cargo — weight by lane.</p>
  <button class="btn btn-primary mt-3">Deploy</button>
</div>
```

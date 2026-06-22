# pagepin — comment & review interaction

This design system is the **pin-point review experience** pagepin injects into hosted pages: reviewers drop comments anchored to elements, tag them (copy / style / question / bug), reply, and resolve. It contains the **current** overlay (the real shipping interaction) plus **three redesign concepts** exploring a more fluid review flow. Every screen runs over the same sample hosted page with the same mock threads, and every interaction is live (create, navigate, reply, resolve) on local mock state — there is no backend.

Use these to compare interaction models side by side and to design the next version of pagepin's review UX.

## Shared review language

- **Kinds** carry consistent colors everywhere: Copy `#2f6fb0`, Style `#c07a16`, Question `#7c4bc0`, Bug `#c2361b`; resolved threads desaturate to grey.
- **Anchors** tie a thread to a page element (or `@page` for whole-page notes); a thread snapshots the element so it can degrade to "anchor lost" if the page changes.
- Brand surface: white cards, hairline `ink-200` borders, `tide` teal accents, **Hanken Grotesk** UI / **JetBrains Mono** for code; soft layered shadows; subtle motion (`fade-up`, gentle scroll).

## The concepts

- **Current** — command bar + content-covering popovers + modal comment/walk modes (the baseline).
- **A · Rail** — a persistent margin rail (Docs-style); threads never cover the content.
- **B · Spotlight** — hover-to-comment inline anchors + a focus mode that dims the page and steps through threads.
- **C · Keyboard** — a keyboard-first / command-driven flow for fast reviewing.

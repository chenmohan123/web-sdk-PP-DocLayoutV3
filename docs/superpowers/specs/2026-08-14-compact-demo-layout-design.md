# Compact Demo Layout Design

## Goal

Increase first-screen information density while preserving the complete detection workflow and clear access to the GitHub repository.

## Layout

- Compress the top bar by reducing the PP-DocLayoutV3 heading size, vertical padding, and control spacing.
- Add a visible `Github` icon plus `GitHub` repository link to the top actions. Open it in a new tab with `rel="noreferrer"`.
- Move the four sample documents below the result image inside the left result panel. Use one row of four compact cards on desktop and a two-by-two grid on narrow screens.
- Order the right panel as performance, model information, fallback records when present, detection results, then export and cache actions.
- Keep the sample interaction unchanged: selecting a sample loads its preview but does not start detection.

## Verification

- Add DOM-order assertions for the left sample gallery and right-side sections.
- Verify the GitHub link URL, accessible name, and new-tab attributes.
- Retain horizontal-overflow checks at mobile, tablet, and desktop viewports.

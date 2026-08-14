# Compact Demo Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the Demo so the first screen shows more of the detection workspace and exposes a clear repository link.

**Architecture:** Keep the existing single-page React component and move existing sections without changing their data flow. Add stable test IDs for structural assertions and update responsive CSS within the current stylesheet.

**Tech Stack:** React, TypeScript, CSS, Lucide React, Playwright

---

### Task 1: Structural regression tests

**Files:**

- Modify: `apps/demo/tests/demo.spec.ts`

- [ ] Assert the `GitHub` link targets the repository and opens in a new tab.
- [ ] Assert the sample gallery is a descendant of the result panel and follows the canvas.
- [ ] Assert right-panel DOM order is performance, model information, fallback, detection results, actions.
- [ ] Run the focused Demo tests and confirm the assertions fail against the previous layout.

### Task 2: React layout

**Files:**

- Modify: `apps/demo/src/App.tsx`

- [ ] Import the Lucide `Github` icon and add the repository link to the top actions.
- [ ] Move the existing sample gallery below the canvas inside the result panel.
- [ ] Reorder existing right-panel sections without changing result rendering or actions.
- [ ] Add stable test IDs only to structural containers used by the regression tests.

### Task 3: Compact responsive styling

**Files:**

- Modify: `apps/demo/src/styles.css`

- [ ] Reduce top-level and topbar padding, heading size, and action height.
- [ ] Remove full-width sample-gallery borders and make its cards denser.
- [ ] Keep four sample columns on desktop and two columns below 620px.
- [ ] Run existing viewport overflow checks and inspect desktop/mobile screenshots.

### Task 4: Verification

**Files:**

- Verify all modified Demo and planning files.

- [ ] Run Prettier on modified files.
- [ ] Run Demo TypeScript checks and focused Playwright tests.
- [ ] Run `git diff --check` and inspect the final diff for unrelated changes.

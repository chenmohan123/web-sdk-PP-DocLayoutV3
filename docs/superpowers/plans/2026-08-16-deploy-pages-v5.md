# Deploy Pages v5 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the GitHub Pages deployment action to Node.js 24-backed `actions/deploy-pages@v5` and prevent regression to `v4`.

**Architecture:** Keep the existing two-job Pages workflow and all permissions, inputs, artifacts, model staging, and outputs unchanged. Extend the existing workflow contract test first, then make the single action-version change required to satisfy it.

**Tech Stack:** GitHub Actions YAML, Node.js built-in test runner, pnpm workspace verification.

---

### Task 1: Lock the Pages deploy action to v5

**Files:**
- Modify: `scripts/verify-release.test.mjs:229`
- Modify: `.github/workflows/pages.yml:54`

- [ ] **Step 1: Write the failing contract assertion**

Add the following assertion beside the existing Pages action assertions in `scripts/verify-release.test.mjs`:

```js
assert.match(pages, /^\s*- uses: actions\/deploy-pages@v5\r?$/m);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern "recognizes standard list-form GitHub Action steps" scripts/verify-release.test.mjs
```

Expected: FAIL because `.github/workflows/pages.yml` still contains `actions/deploy-pages@v4` and does not match the new `v5` assertion.

- [ ] **Step 3: Apply the minimal workflow change**

Replace only the deploy action version in `.github/workflows/pages.yml`:

```yaml
      - name: Deploy GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v5
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test --test-name-pattern "recognizes standard list-form GitHub Action steps" scripts/verify-release.test.mjs
```

Expected: PASS for the selected contract test with no failures.

- [ ] **Step 5: Review the focused diff**

Run:

```bash
git diff --check
git diff -- .github/workflows/pages.yml scripts/verify-release.test.mjs
```

Expected: no whitespace errors; the diff contains one action-version replacement and one new assertion.

- [ ] **Step 6: Commit the implementation**

```bash
git add .github/workflows/pages.yml scripts/verify-release.test.mjs
git commit -m "ci: upgrade deploy-pages to v5"
```

### Task 2: Verify and publish the branch

**Files:**
- Verify: `.github/workflows/pages.yml`
- Verify: `scripts/verify-release.test.mjs`

- [ ] **Step 1: Run the complete release contract suite**

Run:

```bash
pnpm release:test
```

Expected: all release and dependency-security tests pass.

- [ ] **Step 2: Run the workspace verification suite**

Run:

```bash
pnpm verify
```

Expected: formatting, documentation contracts, release contracts, benchmark contracts, lint, type checking, workspace tests, and production builds all pass.

- [ ] **Step 3: Verify branch state and perform final review**

Run:

```bash
git diff --check origin/main...HEAD
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: no unstaged files, no whitespace errors, and exactly the design plus implementation commits ahead of `origin/main`.

- [ ] **Step 4: Push and create the pull request**

```bash
git push -u origin codex/deploy-pages-v5
gh pr create --base main --head codex/deploy-pages-v5 --title "ci: upgrade deploy-pages to v5" --body "## Summary
- upgrade actions/deploy-pages from v4 to v5
- enforce the Node.js 24-backed action in release contracts

## Test Plan
- pnpm release:test
- pnpm verify"
```

Expected: an open PR targeting `main` with successful CI.

- [ ] **Step 5: Verify deployment after merge**

After the PR is merged, wait for the automatic `GitHub Pages` workflow on `main`.

Expected: build and deploy jobs succeed and the previous `actions/deploy-pages@v4` Node.js 20 deprecation annotation is absent.

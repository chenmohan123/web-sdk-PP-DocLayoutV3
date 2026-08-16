# Main-Only Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move CI and benchmark automation from the retired `develop` branch to the repository's sole long-lived branch, `main`, then remove `develop`.

**Architecture:** Keep the existing workflow jobs and permissions intact and change only branch filters. Treat the Node workflow contract tests as the policy boundary: update them first to require main-only triggers, observe failure against the old YAML, then make the minimal YAML changes.

**Tech Stack:** GitHub Actions YAML, Node.js built-in test runner, pnpm, GitHub CLI

---

### Task 1: Make Branch-Policy Contracts Require Main Only

**Files:**
- Modify: `scripts/benchmark-contract.test.mjs:20`
- Modify: `scripts/verify-release.mjs:108-118`

- [ ] **Step 1: Update the benchmark workflow assertion**

Replace the branch assertion with:

```js
assert.match(workflow, /push:\s+branches:\s+\[main\]\s+paths:/);
```

- [ ] **Step 2: Update the CI workflow assertions**

Replace the push and pull-request assertions with:

```js
requireMatch(ci, /push:\s*\n\s+branches:\s*\[main\]/, "CI must run on main pushes");
requireMatch(
  ci,
  /pull_request:\s*\n\s+branches:\s*\[main\]/,
  "CI must run on pull requests targeting main"
);
```

Keep the later release-workflow guard that prohibits publishing from `develop`; it protects against accidental future reintroduction.

- [ ] **Step 3: Run the focused tests and verify the new policy fails against old YAML**

Run: `pnpm benchmark:test`

Expected: FAIL because `benchmark.yml` still contains `branches: [develop]`.

Run: `pnpm release:test`

Expected: FAIL with `CI must run on main pushes` because `ci.yml` still contains `[develop, main]`.

- [ ] **Step 4: Commit the failing contract tests together with this implementation plan**

```bash
git add docs/superpowers/plans/2026-08-16-main-only-workflows.md scripts/benchmark-contract.test.mjs scripts/verify-release.mjs
git commit -m "test: require main-only workflow triggers"
```

### Task 2: Migrate Workflow Branch Filters

**Files:**
- Modify: `.github/workflows/benchmark.yml:5`
- Modify: `.github/workflows/ci.yml:5-7`

- [ ] **Step 1: Change the benchmark push branch**

Use this trigger while preserving the current path filter and manual trigger:

```yaml
on:
  push:
    branches: [main]
    paths:
      - .github/workflows/benchmark.yml
      - scripts/benchmark-contract.test.mjs
      - tests/browser/benchmark.spec.ts
  workflow_dispatch:
```

- [ ] **Step 2: Change CI push and pull-request branches**

Use this trigger while preserving every existing job:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
```

- [ ] **Step 3: Run focused contract tests**

Run: `pnpm benchmark:test`

Expected: all benchmark contract tests pass.

Run: `pnpm release:test`

Expected: all release and dependency-security tests pass.

- [ ] **Step 4: Confirm no active automation depends on develop**

Run: `git grep -n -I -w develop -- ':!docs/superpowers/**'`

Expected: only the release-workflow defense-in-depth check in `scripts/verify-release.mjs` may remain; no workflow trigger or branch-policy assertion may reference `develop`.

- [ ] **Step 5: Commit the workflow migration**

```bash
git add .github/workflows/benchmark.yml .github/workflows/ci.yml
git commit -m "ci: migrate automation to main"
```

### Task 3: Verify and Integrate the Migration

**Files:**
- Verify only; no additional source files

- [ ] **Step 1: Run repository formatting and diff checks**

Run: `pnpm format:check`

Expected: all files use the repository's formatting rules.

Run: `git diff --check origin/main...HEAD`

Expected: no whitespace errors.

- [ ] **Step 2: Run the complete verification suite**

Run: `pnpm run verify`

Expected: formatting, documentation, release, benchmark, lint, typecheck, unit, browser, and build checks all pass.

- [ ] **Step 3: Push and create the pull request**

```bash
git push -u origin codex/main-only-workflows
gh pr create --base main --head codex/main-only-workflows --title "ci: migrate automation to main" --body "## Summary

- move CI push and pull-request triggers to main only
- move benchmark push automation to main
- update workflow contract tests to enforce the main-only policy

## Verification

- pnpm run verify"
```

The PR body must state that CI and benchmark triggers now target `main`, contract tests enforce the policy, and `pnpm run verify` passed.

- [ ] **Step 4: Wait for all applicable PR checks and merge with squash**

Run: `gh pr checks --watch --interval 10`

Expected: every applicable check passes; hardware-only WebGPU jobs may be skipped by their existing condition.

Run: `gh pr merge --squash --delete-branch=false`

Expected: the PR is merged into `main`; branch deletion remains a separate verified cleanup step.

### Task 4: Remove Develop and Finish Branch Cleanup

**Files:**
- Operational Git cleanup only

- [ ] **Step 1: Update local main to the merged commit**

```bash
git switch main
git pull --ff-only origin main
```

- [ ] **Step 2: Verify develop contains no commits absent from main**

Run: `git rev-list --left-right --count main...develop`

Expected: the right-hand count is `0`.

- [ ] **Step 3: Delete local and remote develop**

```bash
git branch -d develop
git push origin --delete develop
```

- [ ] **Step 4: Delete the merged migration branch locally and remotely**

Because the PR is squash-merged, first verify `git diff main codex/main-only-workflows` is empty, then run:

```bash
git branch -D codex/main-only-workflows
git push origin --delete codex/main-only-workflows
```

- [ ] **Step 5: Verify final repository state**

Run: `git status --short --branch`

Expected: clean `main` tracking `origin/main`.

Run: `gh api repos/chenmohan123/web-sdk-PP-DocLayoutV3/branches --paginate`

Expected: `main` is the only remote branch.

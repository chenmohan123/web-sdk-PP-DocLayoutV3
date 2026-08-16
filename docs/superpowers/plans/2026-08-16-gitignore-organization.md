# Gitignore Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ignore the repository-local pnpm store and organize all root ignore rules into documented, purpose-based sections without changing existing behavior.

**Architecture:** Keep ignore behavior centralized in the root `.gitignore`. Preserve every existing pattern, add `.pnpm-store/`, and use one concise English comment per category so future generated paths have an obvious home.

**Tech Stack:** Git ignore patterns, Git CLI, PowerShell

---

### Task 1: Organize Root Ignore Rules

**Files:**
- Modify: `.gitignore`
- Reference: `docs/superpowers/specs/2026-08-16-gitignore-organization-design.md`

- [ ] **Step 1: Verify the missing ignore rule**

Run:

```powershell
git check-ignore -v .pnpm-store
```

Expected: exit code 1 with no matching rule, proving the local pnpm store is currently visible to Git.

- [ ] **Step 2: Replace the root ignore file with the approved organization**

Set `.gitignore` to exactly:

```gitignore
# Workspace tooling
.superpowers/
.worktrees/

# Dependencies and package-manager caches
node_modules/
.pnpm-store/

# Build and test outputs
outputs/
work/
dist/
coverage/
packages/sdk/temp/
playwright-report/
test-results/

# Environment files
.env
.env.*

# Python artifacts
.venv*/
**/__pycache__/
.pytest_cache/

# Logs
*.log
```

- [ ] **Step 3: Verify the new pnpm store rule**

Run:

```powershell
git check-ignore -v .pnpm-store .pnpm-store/v11/index.db
```

Expected: both paths match `.gitignore` through the `.pnpm-store/` rule.

- [ ] **Step 4: Verify representative existing rules still work**

Run:

```powershell
git check-ignore -v .superpowers/example .worktrees/example node_modules/example outputs/example work/example dist/example coverage/example packages/sdk/temp/example playwright-report/example test-results/example .env .env.local .venv-test/bin/python tools/example/__pycache__/cache.py tools/model-pipeline/.pytest_cache/v/cache/nodeids debug.log
```

Expected: every path is reported as ignored by its corresponding preserved rule.

- [ ] **Step 5: Verify the final diff and working tree**

Run:

```powershell
git diff --check
git diff -- .gitignore
git status --short --branch
```

Expected: no whitespace errors; the `.gitignore` diff contains only category comments, reordering, and `.pnpm-store/`; `.pnpm-store/` is absent from status.

- [ ] **Step 6: Commit the implementation**

```powershell
git add .gitignore
git commit -m "chore: organize gitignore rules"
```

# npm Integrity Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the npm release workflow tolerate short registry propagation delays while still failing when published integrity cannot be verified.

**Architecture:** Keep the behavior in the existing GitHub Actions release step. A workflow contract test reads the YAML as text and requires bounded polling, delayed retries, Bash pipeline failure propagation, successful summary output, and an explicit terminal failure.

**Tech Stack:** GitHub Actions YAML, Bash, Node.js built-in test runner, pnpm, Prettier

---

### Task 1: Harden published integrity verification

**Files:**
- Modify: `scripts/verify-release.test.mjs`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Write the failing release workflow contract test**

Add this test after `publishes through npm Trusted Publishing without token fallbacks` in `scripts/verify-release.test.mjs`:

```js
  test("retries npm integrity lookup without hiding a persistent failure", () => {
    const release = readFileSync(resolve(repositoryRoot, ".github/workflows/release.yml"), "utf8");
    const integrityStep = release.slice(release.indexOf("- name: Record published integrity"));

    assert.match(integrityStep, /shell: bash/);
    assert.match(integrityStep, /set -o pipefail/);
    assert.match(integrityStep, /for attempt in \{1\.\.5\}; do/);
    assert.match(
      integrityStep,
      /metadata="\$\(npm view "\$package" version dist\.integrity --json\)"/
    );
    assert.match(integrityStep, /sleep 3/);
    assert.match(integrityStep, /echo "\$metadata"/);
    assert.match(integrityStep, /exit 1/);
  });
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```powershell
node --test --test-name-pattern="retries npm integrity" scripts/verify-release.test.mjs
```

Expected: FAIL because the current workflow does not contain `shell: bash` or `set -o pipefail`.

- [ ] **Step 3: Implement the bounded integrity lookup**

Replace the existing `Record published integrity` step in `.github/workflows/release.yml` with:

```yaml
      - name: Record published integrity
        shell: bash
        run: |
          set -o pipefail
          package="web-sdk-pp-doclayoutv3@${GITHUB_REF_NAME#v}"
          for attempt in {1..5}; do
            if metadata="$(npm view "$package" version dist.integrity --json)"; then
              {
                echo '## npm integrity'
                echo "$metadata"
              } | tee -a "$GITHUB_STEP_SUMMARY"
              exit 0
            fi
            if (( attempt < 5 )); then
              echo "npm registry has not exposed $package yet; retrying in 3 seconds..." >&2
              sleep 3
            fi
          done
          echo "Failed to read published integrity for $package after 5 attempts." >&2
          exit 1
```

This captures `npm view` output before writing the summary, retries only the registry lookup, and preserves a failing status for both retry exhaustion and a failed `tee` pipeline.

- [ ] **Step 4: Run the focused test and verify the green state**

Run:

```powershell
node --test --test-name-pattern="retries npm integrity" scripts/verify-release.test.mjs
```

Expected: PASS for `retries npm integrity lookup without hiding a persistent failure`.

- [ ] **Step 5: Run release and formatting verification**

Run:

```powershell
pnpm release:test
pnpm exec prettier --check .github/workflows/release.yml scripts/verify-release.test.mjs docs/superpowers/specs/2026-08-14-npm-integrity-retry-design.md docs/superpowers/plans/2026-08-14-npm-integrity-retry.md
git diff --check
```

Expected: release tests pass with no failures, Prettier reports all matched files use its style, and `git diff --check` exits zero.

- [ ] **Step 6: Commit the implementation**

```powershell
git add -- .github/workflows/release.yml scripts/verify-release.test.mjs docs/superpowers/plans/2026-08-14-npm-integrity-retry.md
git commit -m "fix(release): retry npm integrity lookup"
```

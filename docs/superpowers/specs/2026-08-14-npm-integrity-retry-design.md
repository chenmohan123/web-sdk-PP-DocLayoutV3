# npm Integrity Retry Design

## Problem

The `v1.0.3` Trusted Publishing run successfully published the package, but the immediately following `npm view` returned `E404` while the npm registry propagated the new version. Because the command was piped through `tee` without `pipefail`, the workflow step still completed successfully and the job summary did not contain the intended integrity value.

## Design

Keep the fix inside `.github/workflows/release.yml` and avoid adding a repository script or dependency.

The `Record published integrity` step will:

1. Enable Bash pipeline failure propagation with `set -o pipefail`.
2. Query the exact tag-derived package version up to five times.
3. Wait three seconds between failed attempts so npm registry propagation can complete.
4. Capture successful JSON output before appending it to `$GITHUB_STEP_SUMMARY`.
5. Exit non-zero after the final failed attempt, so an unavailable or incorrectly published version cannot be reported as a successful release.

The retry loop is condition-based and bounded. It handles the observed transient `E404` without hiding persistent authentication, package-name, version, or registry failures.

## Testing

Extend `scripts/verify-release.test.mjs` with a release workflow contract that requires:

- `set -o pipefail` in the integrity step;
- a bounded retry loop around the exact `npm view` query;
- delayed retry behavior;
- an explicit non-zero exit after retry exhaustion.

Run the focused release contract test first in the red state, then after the workflow change, followed by formatting, `git diff --check`, and the repository release verification suite.

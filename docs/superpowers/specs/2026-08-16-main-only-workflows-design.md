# Main-Only Workflow Migration Design

## Goal

Retire the `develop` branch without disabling repository automation. All normal development will start from `main`, use a short-lived feature branch, and return to `main` through a pull request.

## Scope

- Change CI push and pull-request filters from `develop` plus `main` to `main` only.
- Change release benchmark push automation from `develop` to `main`.
- Keep all existing manual workflow triggers, jobs, permissions, runner labels, and path filters unchanged.
- Update the workflow contract tests so they enforce the main-only policy.
- Delete `develop` only after the migration pull request is merged and its checks pass.

## Alternatives Considered

1. Delete `develop` immediately. Rejected because the benchmark workflow currently runs automatically only on `develop`.
2. Keep `develop` indefinitely. Rejected because it conflicts with the agreed feature-branch-to-`main` workflow and creates two sources of truth.
3. Migrate automation first, then delete `develop`. Selected because it preserves coverage throughout the transition.

## Implementation

The workflow YAML files remain structurally unchanged apart from their branch filters. The existing Node contract tests will be updated first so the old filters fail the new policy, followed by the YAML changes that make the tests pass.

The release workflow remains restricted to tags and is not changed. References that prohibit publishing from `develop` remain valid as defense-in-depth even after the branch is removed.

## Verification

- Run the focused benchmark and release contract tests.
- Run `pnpm run verify`.
- Require all applicable pull-request checks to pass.
- After merge, confirm `main` is the default branch, delete local and remote `develop`, and verify that only `main` remains remotely.

## Rollback

Before deleting `develop`, rollback is a normal revert of the migration pull request. After deletion, the branch can be recreated from commit `03b9364dd0d5732b16e82e6fb488a1731b71c37b` if historical branch behavior is ever required.

# Gitignore Organization Design

## Goal

Keep local pnpm store data out of Git while making the repository ignore rules easier to scan and maintain.

## Scope

- Add `.pnpm-store/` to the root `.gitignore`.
- Preserve every existing ignore pattern and its behavior.
- Group patterns by purpose with concise English comments.
- Do not delete local cache data or change pnpm configuration.

## Organization

The root `.gitignore` will use these sections:

1. Workspace tooling
2. Dependencies and package-manager caches
3. Build and test outputs
4. Environment files
5. Python artifacts
6. Logs

## Verification

- `git check-ignore -v .pnpm-store` must report the new root `.gitignore` rule.
- Existing representative paths must remain ignored.
- `git status --short` must no longer report `.pnpm-store/` as untracked.
- The final diff must contain only the design record and the intended `.gitignore` reorganization.

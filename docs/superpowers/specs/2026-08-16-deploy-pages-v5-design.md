# Deploy Pages v5 Upgrade Design

## Goal

Remove the GitHub Actions Node.js 20 deprecation warning by upgrading the Pages deployment action from `actions/deploy-pages@v4` to `actions/deploy-pages@v5`.

## Scope

- Update only the deploy step in `.github/workflows/pages.yml`.
- Extend the existing release workflow contract test to require `actions/deploy-pages@v5`.
- Keep Pages permissions, concurrency, build commands, model staging, artifact upload, environment, and deployment output unchanged.

## Compatibility

`actions/deploy-pages@v5.0.0` moves the action runtime to Node.js 24. Its documented interface remains compatible with the repository's current `artifact_name` default and `page_url` output usage, so no workflow input or permission changes are required.

## Test Strategy

1. Add the `deploy-pages@v5` assertion before changing the workflow and confirm the release contract test fails because the workflow still uses `v4`.
2. Upgrade the workflow to `v5` and confirm the focused contract test passes.
3. Run formatting, release contracts, lint, type checking, tests, and the production build.
4. After merge, require the automatic GitHub Pages workflow to complete successfully without the Node.js 20 annotation.

## Rollout

Deliver the change in `codex/deploy-pages-v5` through a pull request targeting `main`. The normal `main` Pages workflow is the deployment verification; no SDK, model, npm, or GitHub Release version changes are included.

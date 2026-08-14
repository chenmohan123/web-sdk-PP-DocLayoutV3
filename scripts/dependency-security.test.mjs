import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("keeps esbuild outside the GHSA-g7r4-m6w7-qqqr vulnerable range", () => {
  const workspaceConfig = readFileSync(resolve(repositoryRoot, "pnpm-workspace.yaml"), "utf8");
  const lockfile = readFileSync(resolve(repositoryRoot, "pnpm-lock.yaml"), "utf8");
  const lockedVersions = [
    ...new Set(
      [...lockfile.matchAll(/^  esbuild@(\d+\.\d+\.\d+):$/gm)].map(([, version]) => version)
    )
  ];

  assert.match(workspaceConfig, /^overrides:\r?\n  esbuild: 0\.28\.2$/m);
  assert.deepEqual(lockedVersions, ["0.28.2"]);
});

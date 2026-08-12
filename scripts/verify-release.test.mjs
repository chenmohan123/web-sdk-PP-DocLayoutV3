import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("release workflow contract", () => {
  test("validates the repository release configuration", () => {
    const output = execFileSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/verify-release.mjs"), "--static"],
      { cwd: repositoryRoot, encoding: "utf8" }
    );

    assert.match(output, /Release contract verified:/);
    assert.match(output, /4 workflows, 2 model variants/);
  });

  test("recognizes standard list-form GitHub Action steps", () => {
    const ci = readFileSync(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8");

    assert.match(ci, /^\s*- uses: actions\/checkout@v4$/m);
  });

  test("rejects a release tag that does not match the SDK package version", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/verify-release.mjs"), "--release", "v9.9.9"],
      { cwd: repositoryRoot, encoding: "utf8" }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tag v9\.9\.9 does not match package version/);
  });

  test("builds Pages assets with the repository base path", () => {
    const outputRoot = mkdtempSync(resolve(tmpdir(), "ppdoclayout-pages-"));
    try {
      const args = [
        "--filter",
        "demo",
        "exec",
        "vite",
        "build",
        "--base",
        "/web-sdk-PP-DocLayoutV3/",
        "--outDir",
        outputRoot,
        "--emptyOutDir"
      ];
      if (process.platform === "win32") {
        execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm", ...args], {
          cwd: repositoryRoot,
          stdio: "pipe"
        });
      } else {
        execFileSync("pnpm", args, { cwd: repositoryRoot, stdio: "pipe" });
      }

      const html = readFileSync(resolve(outputRoot, "index.html"), "utf8");
      assert.match(html, /(?:src|href)="\/web-sdk-PP-DocLayoutV3\/assets\//);
    } finally {
      rmSync(outputRoot, { force: true, recursive: true });
    }
  });
});

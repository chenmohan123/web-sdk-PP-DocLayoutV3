import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bash =
  process.platform === "win32" ? join(process.env.ProgramFiles, "Git/bin/bash.exe") : "bash";

function runIntegrityStep(visibleAfter) {
  const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
  const step = workflow.slice(workflow.indexOf("- name: Record published integrity"));
  const script = step
    .split(/run: \|\r?\n/)[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
  const directory = mkdtempSync(join(tmpdir(), "npm-integrity-test-"));
  try {
    // 运行真正的工作流脚本，只替换外部 npm 和等待，复现发布后的可见性延迟。
    const result = spawnSync(
      bash,
      [
        "--noprofile",
        "--norc",
        "-e",
        "-o",
        "pipefail",
        "-c",
        `
      elapsed=0
      export GITHUB_REF_NAME=v1.2.0
      export GITHUB_STEP_SUMMARY=summary.md
      npm() {
        if [[ "$1" != view || "$2" != web-sdk-pp-doclayoutv3@1.2.0 ]]; then
          echo '禁止执行查询以外的 npm 命令' >&2
          return 90
        fi
        echo "查询:$elapsed" >&2
        if (( elapsed < ${visibleAfter} )); then
          echo 'npm error code E404' >&2
          return 1
        fi
        echo '{"version":"1.2.0","dist.integrity":"sha512-test"}'
      }
      sleep() {
        elapsed=$((elapsed + $1))
        if (( elapsed > 1200 )); then
          echo '等待超过测试的 20 分钟上限' >&2
          exit 91
        fi
      }
      ${script}
    `
      ],
      { cwd: directory, encoding: "utf8", timeout: 10_000 }
    );
    let summary = "";
    try {
      summary = readFileSync(join(directory, "summary.md"), "utf8");
    } catch {}
    return { ...result, summary };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("版本立即可见时只查询一次并记录完整性", () => {
  const result = runIntegrityStep(0);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.match(/查询:/g)?.length, 1);
  assert.match(result.summary, /sha512-test/);
});

test("npm 延迟三分钟公开版本时继续等待并成功记录", () => {
  const result = runIntegrityStep(180);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.summary, /"version":"1.2.0"/);
  assert.match(result.summary, /sha512-test/);
});

test("持续不可见时在有限时间后失败，摘要提示不要重复发布", () => {
  const result = runIntegrityStep(3600);
  assert.equal(result.status, 1, result.stderr);
  const times = [...result.stderr.matchAll(/查询:(\d+)/g)].map((match) => Number(match[1]));
  assert.ok(times.at(-1) >= 300 && times.at(-1) <= 600, result.stderr);
  assert.doesNotMatch(result.summary, /sha512-test/);
  assert.match(result.summary, /不要.*(?:重复发布|重新发布)/);
});

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const repositoryRoot = new URL("..", import.meta.url);

describe("documentation contract", () => {
  it("runs the bilingual inventory and generated error-code checks", () => {
    assert.doesNotThrow(() => {
      execFileSync(process.execPath, ["scripts/check-doc-parity.mjs"], {
        cwd: repositoryRoot,
        stdio: "pipe"
      });
    });
  });

  it("describes bundled defaults without coupling the model label to an SDK version", () => {
    const chineseReadme = readFileSync(new URL("README.md", repositoryRoot), "utf8");
    const englishReadme = readFileSync(new URL("README.en.md", repositoryRoot), "utf8");

    assert.match(chineseReadme, /默认模型：FP16/);
    assert.doesNotMatch(chineseReadme, /默认 1\.0\.0 模型/);
    assert.match(englishReadme, /The default FP16 model/);
    assert.doesNotMatch(englishReadme, /The default 1\.0\.0 FP16 model/);
  });
});

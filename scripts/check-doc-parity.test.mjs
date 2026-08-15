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

  it("documents only the validated default backend and precision pairs", () => {
    const rootReadme = readFileSync(new URL("README.md", repositoryRoot), "utf8");
    const packageReadme = readFileSync(new URL("packages/sdk/README.md", repositoryRoot), "utf8");
    const modelReadme = readFileSync(new URL("models/README.md", repositoryRoot), "utf8");
    const englishModels = readFileSync(new URL("docs/en/models.md", repositoryRoot), "utf8");
    const chineseModels = readFileSync(new URL("docs/zh-CN/models.md", repositoryRoot), "utf8");

    assert.match(rootReadme, /WebGPU \+ FP16、CPU\/WASM \+ FP16、CPU\/WASM \+ FP32/s);
    assert.match(
      packageReadme,
      /FP16 模型用于 WebGPU，也可用于 WASM\/CPU；FP32 模型用于 WASM\/CPU/
    );
    assert.match(
      packageReadme,
      /The FP16 model targets WebGPU and WASM\/CPU; the FP32 model targets WASM\/CPU\./
    );
    assert.match(modelReadme, /FP32\s+\| WASM/);
    assert.match(englishModels, /FP32\s+\| 143,216,104 bytes \| WASM/);
    assert.match(chineseModels, /FP32 \| 143,216,104 字节 \| WASM/);
  });
});

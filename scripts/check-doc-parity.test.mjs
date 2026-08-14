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

    assert.match(rootReadme, /WebGPU 仅支持 FP16.*CPU\/WASM 仅支持 FP32/s);
    assert.match(packageReadme, /FP16 模型用于 WebGPU；FP32 模型用于 WASM\/CPU/);
    assert.match(
      packageReadme,
      /The FP16 model targets WebGPU\. The FP32 model targets WASM\/CPU\./
    );
    assert.match(modelReadme, /FP32\s+\| WASM/);
    assert.match(englishModels, /FP32\s+\| 143,216,104 bytes \| WASM/);
    assert.match(chineseModels, /FP32 \| 143,216,104 字节 \| WASM/);
  });

  it("records model 1.0.1 sanitation provenance in both languages", () => {
    const modelReadme = readFileSync(new URL("models/README.md", repositoryRoot), "utf8");
    const englishConversion = readFileSync(
      new URL("docs/en/conversion.md", repositoryRoot),
      "utf8"
    );
    const chineseConversion = readFileSync(
      new URL("docs/zh-CN/conversion.md", repositoryRoot),
      "utf8"
    );

    for (const document of [modelReadme, englishConversion, chineseConversion]) {
      assert.match(document, /1\.0\.1/);
      assert.match(document, /v1\.0\.1-models/);
      assert.match(document, /sin.*cos.*sin_1.*cos_1/s);
      assert.match(document, /625.*64/s);
      assert.match(document, /FP64.*不支持|FP64.*not supported/is);
    }
  });
});

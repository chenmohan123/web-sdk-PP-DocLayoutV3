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

    assert.match(chineseReadme, /默认模型 `1\.0\.1`：FP16/);
    assert.doesNotMatch(chineseReadme, /默认 1\.0\.0 模型/);
    assert.match(englishReadme, /The default `1\.0\.1` model/);
    assert.doesNotMatch(englishReadme, /The default 1\.0\.0 FP16 model/);
  });

  it("documents only the validated default backend and precision pairs", () => {
    const rootReadme = readFileSync(new URL("README.md", repositoryRoot), "utf8");
    const packageReadme = readFileSync(new URL("packages/sdk/README.md", repositoryRoot), "utf8");
    const modelReadme = readFileSync(new URL("models/README.md", repositoryRoot), "utf8");
    const englishModels = readFileSync(new URL("docs/en/models.md", repositoryRoot), "utf8");
    const chineseModels = readFileSync(new URL("docs/zh-CN/models.md", repositoryRoot), "utf8");

    assert.match(rootReadme, /默认模型 `1\.0\.1`.*WebGPU 支持 FP16 和已验证的 FP32/s);
    assert.match(packageReadme, /默认模型 `1\.0\.1`.*FP16 和 FP32 变体均支持 WebGPU/s);
    assert.match(packageReadme, /The default `1\.0\.1` model supports FP16 and FP32 on WebGPU/);
    assert.match(modelReadme, /FP32\s+\| WASM/);
    assert.match(englishModels, /FP32\s+\| 142,574,928 bytes \| WASM, WebGPU/);
    assert.match(chineseModels, /FP32 \| 142,574,928 字节 \| WASM、WebGPU/);
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

  it("keeps FP16 single-sample evidence distinct from FP32 seven-fixture evidence", () => {
    const documents = [
      readFileSync(new URL("README.md", repositoryRoot), "utf8"),
      readFileSync(new URL("README.en.md", repositoryRoot), "utf8"),
      readFileSync(new URL("docs/zh-CN/performance.md", repositoryRoot), "utf8"),
      readFileSync(new URL("docs/en/performance.md", repositoryRoot), "utf8")
    ];

    for (const document of documents) {
      assert.match(document, /FP16.*单次样本|FP16.*single sample/is);
      assert.match(document, /FP32.*7 张授权图片|FP32.*seven licensed fixtures/is);
    }
  });
});

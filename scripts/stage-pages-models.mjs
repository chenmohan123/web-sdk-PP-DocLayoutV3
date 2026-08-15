import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MODEL_RELEASE_ROOT =
  "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.1-models";
export const MODEL_PUBLIC_ROOT =
  "https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/models/v1.0.1";
export const PAGE_MODEL_RELEASES = [
  {
    version: "1.0.0",
    releaseRoot:
      "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.0-models"
  },
  { version: "1.0.1", releaseRoot: MODEL_RELEASE_ROOT }
];

async function requireOk(response, url) {
  if (!response.ok) throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  return response;
}

function requireFilename(filename) {
  if (typeof filename !== "string" || !/^model-fp(?:16|32)\.onnx$/.test(filename)) {
    throw new Error(`Unsafe or unexpected model filename: ${String(filename)}`);
  }
  return filename;
}

export async function stagePagesModels({
  fetchImpl = fetch,
  outputRoot,
  publicRoot = MODEL_PUBLIC_ROOT,
  releaseRoot = MODEL_RELEASE_ROOT
}) {
  const manifestUrl = `${releaseRoot}/manifest.json`;
  const manifestResponse = await requireOk(await fetchImpl(manifestUrl), manifestUrl);
  const manifest = await manifestResponse.json();
  const ids = manifest.variants?.map(({ id }) => id).sort();
  if (JSON.stringify(ids) !== JSON.stringify(["fp16", "fp32"])) {
    throw new Error("Model release must contain exactly fp16 and fp32 variants");
  }

  await mkdir(outputRoot, { recursive: true });
  const variants = [];
  for (const variant of manifest.variants) {
    const filename = requireFilename(variant.filename);
    const assetUrl = `${releaseRoot}/${filename}`;
    const response = await requireOk(await fetchImpl(assetUrl), assetUrl);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength !== variant.bytes) {
      throw new Error(`${filename} byte length mismatch`);
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== variant.sha256) throw new Error(`${filename} SHA-256 mismatch`);
    await writeFile(resolve(outputRoot, filename), bytes);
    variants.push({ ...variant, url: `${publicRoot}/${filename}` });
  }

  const staged = { ...manifest, variants };
  await writeFile(resolve(outputRoot, "manifest.json"), `${JSON.stringify(staged, null, 2)}\n`);
  return staged;
}

export async function stageAllPagesModels({ fetchImpl = fetch, outputRoot }) {
  const staged = [];
  for (const model of PAGE_MODEL_RELEASES) {
    const manifest = await stagePagesModels({
      fetchImpl,
      outputRoot: resolve(outputRoot, model.version),
      publicRoot: `https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/models/${model.version}`,
      releaseRoot: model.releaseRoot
    });
    staged.push({ manifest, model });
  }
  return staged;
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  const repositoryRoot = resolve(dirname(modulePath), "..");
  await stageAllPagesModels({
    outputRoot: resolve(repositoryRoot, "apps/demo/dist/models")
  });
}

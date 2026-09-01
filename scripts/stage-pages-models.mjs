import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(modulePath), "..");
export const MODEL_ROOT = resolve(repositoryRoot, "models", "pp-doclayoutv3");
export const MODEL_PUBLIC_ROOT = "https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/models";

function requireFilename(filename) {
  if (typeof filename !== "string" || !/^model-fp(?:16|32)\.onnx$/.test(filename)) {
    throw new Error(`Unsafe or unexpected model filename: ${String(filename)}`);
  }
  return filename;
}

function requireAssetUrl(value, filename) {
  const url = new URL(value);
  const expected = new RegExp(
    `^/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v\\d+\\.\\d+\\.\\d+-models/${filename}$`
  );
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !expected.test(url.pathname)) {
    throw new Error(`Unsafe or unexpected model URL: ${value}`);
  }
  return url.href;
}

export async function stagePagesModels({
  fetchImpl = fetch,
  outputRoot,
  publicRoot = MODEL_PUBLIC_ROOT,
  modelRoot = MODEL_ROOT,
  manifest: suppliedManifest,
  releaseRoot
}) {
  const manifest =
    suppliedManifest ??
    (releaseRoot === undefined
      ? JSON.parse(await readFile(resolve(modelRoot, "manifest.json"), "utf8"))
      : await (async () => {
          const url = `${releaseRoot}/manifest.json`;
          const response = await fetchImpl(url);
          if (!response.ok) throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
          return response.json();
        })());
  const ids = manifest.variants?.map(({ id }) => id).sort();
  if (JSON.stringify(ids) !== JSON.stringify(["fp16", "fp32"])) {
    throw new Error("当前模型清单必须包含 FP16 和 FP32 两个变体");
  }
  await mkdir(outputRoot, { recursive: true });
  const variants = [];
  for (const variant of manifest.variants) {
    const filename = requireFilename(variant.filename);
    const sourceUrl =
      releaseRoot === undefined ? undefined : requireAssetUrl(variant.url, filename);
    const bytes =
      sourceUrl === undefined
        ? await readFile(resolve(modelRoot, filename))
        : Buffer.from(await (await fetchImpl(sourceUrl)).arrayBuffer());
    if (bytes.byteLength !== variant.bytes) throw new Error(`${filename} byte length mismatch`);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== variant.sha256) throw new Error(`${filename} SHA-256 mismatch`);
    await writeFile(resolve(outputRoot, filename), bytes);
    variants.push({ ...variant, url: `${publicRoot}/${filename}` });
  }
  const staged = { ...manifest, variants };
  await writeFile(resolve(outputRoot, "manifest.json"), `${JSON.stringify(staged, null, 2)}\n`);
  return staged;
}

export async function stageAllPagesModels({ outputRoot }) {
  const manifest = await stagePagesModels({ outputRoot });
  return [{ manifest, model: { version: manifest.model.version } }];
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  await stageAllPagesModels({ outputRoot: resolve(repositoryRoot, "apps/demo/dist/models") });
}

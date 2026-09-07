import { DocLayoutError, parseModelManifest, type ModelManifest } from "web-sdk-pp-doclayoutv3";

export type ModelSourceKey = "modelscope" | "huggingface";

export interface ModelSourceOption {
  readonly available: boolean;
  readonly disabledReason?: Readonly<{ en: string; zh: string }>;
  readonly key: ModelSourceKey;
  readonly label: Readonly<{ en: string; zh: string }>;
  readonly manifestUrl?: string;
}

export const DEFAULT_MODEL_SOURCE: ModelSourceKey = "modelscope";

export const MODEL_SOURCE_OPTIONS: readonly ModelSourceOption[] = [
  {
    available: true,
    key: "modelscope",
    label: { en: "ModelScope", zh: "ModelScope" },
    manifestUrl:
      "https://modelscope.cn/models/chenmohan/web-sdk-pp-doclayoutv3/resolve/master/manifest.json?v=1.0.2"
  },
  {
    available: true,
    key: "huggingface",
    label: { en: "Hugging Face", zh: "Hugging Face" },
    manifestUrl:
      "https://huggingface.co/chenmohan/web-sdk-pp-doclayoutv3/resolve/main/manifest.json?v=1.0.2"
  }
] as const;

export function selectionToModel(source: ModelSourceKey): string | undefined {
  return MODEL_SOURCE_OPTIONS.find((option) => option.key === source)?.manifestUrl;
}

export async function loadSelectedModel(
  source: ModelSourceKey,
  signal: AbortSignal
): Promise<ModelManifest> {
  const manifestUrl = selectionToModel(source);
  if (manifestUrl === undefined)
    throw new DocLayoutError("MANIFEST_INVALID", "模型来源缺少清单地址");
  let response: Response;
  try {
    response = await fetch(manifestUrl, { signal });
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new DocLayoutError(
      "MODEL_DOWNLOAD_FAILED",
      "模型清单下载失败",
      { url: manifestUrl },
      { cause }
    );
  }
  if (!response.ok) {
    throw new DocLayoutError("MODEL_DOWNLOAD_FAILED", "模型清单下载失败", {
      status: response.status,
      url: manifestUrl
    });
  }
  const manifest = parseModelManifest(await response.json());
  // 镜像清单可能仍保留 Pages 地址；显式选择来源后，模型也必须从该仓库下载。
  return {
    ...manifest,
    variants: manifest.variants.map((variant) => {
      const url = new URL(encodeURIComponent(variant.filename), manifestUrl);
      url.search = new URL(manifestUrl).search;
      return { ...variant, url: url.href };
    })
  };
}

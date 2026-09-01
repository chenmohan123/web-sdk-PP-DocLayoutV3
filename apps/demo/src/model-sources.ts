export type ModelSourceKey = "default" | "huggingface" | "modelscope";

export interface ModelSourceOption {
  readonly available: boolean;
  readonly disabledReason?: Readonly<{ en: string; zh: string }>;
  readonly key: ModelSourceKey;
  readonly label: Readonly<{ en: string; zh: string }>;
  readonly manifestUrl?: string;
}

export const DEFAULT_MODEL_SOURCE: ModelSourceKey = "default";

export const MODEL_SOURCE_OPTIONS: readonly ModelSourceOption[] = [
  {
    available: true,
    key: "default",
    label: { en: "SDK default", zh: "SDK 默认" }
  },
  {
    available: true,
    key: "huggingface",
    label: { en: "Hugging Face", zh: "Hugging Face" },
    manifestUrl:
      "https://huggingface.co/chenmohan/web-sdk-pp-doclayoutv3/resolve/main/manifest.json?v=1.0.2"
  },
  {
    available: true,
    key: "modelscope",
    label: { en: "ModelScope", zh: "ModelScope" },
    manifestUrl:
      "https://modelscope.cn/models/chenmohan/web-sdk-pp-doclayoutv3/resolve/master/manifest.json?v=1.0.2"
  }
] as const;

export function selectionToModel(source: ModelSourceKey): string | undefined {
  return MODEL_SOURCE_OPTIONS.find((option) => option.key === source)?.manifestUrl;
}

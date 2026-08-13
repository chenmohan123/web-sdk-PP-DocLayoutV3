export interface DemoSample {
  readonly coverage: Readonly<{ en: string; zh: string }>;
  readonly filename: string;
  readonly id: string;
  readonly label: Readonly<{ en: string; zh: string }>;
  readonly mimeType: string;
  readonly sha256: string;
  readonly sourceUrl: string;
}

export const demoSamples: readonly DemoSample[] = [
  {
    coverage: { en: "Chinese · Reading order", zh: "中文 · 阅读顺序" },
    filename: "layout-demo.jpg",
    id: "layout-demo",
    label: { en: "Layout sample", zh: "版面示例" },
    mimeType: "image/jpeg",
    sha256: "785b7d19f158dcb636342dd3378ed3a4cddb7333d2d71688f0baa5c25a88ad51",
    sourceUrl: "https://paddle-model-ecology.bj.bcebos.com/paddlex/imgs/demo_image/layout_demo.jpg"
  },
  {
    coverage: { en: "English · Formula", zh: "英文 · 公式" },
    filename: "doc-formula.png",
    id: "doc-formula",
    label: { en: "Formula document", zh: "公式文档" },
    mimeType: "image/png",
    sha256: "6b07d28527dc9e930804fa73df562f1a81599c6b8a1a8bbc2a80742fa9f26e80",
    sourceUrl:
      "https://github.com/PaddlePaddle/PaddleOCR/blob/2661c7c0ef5c613e8f93c6e93b2e052399f0f854/tests/test_files/doc_with_formula.png"
  },
  {
    coverage: { en: "Chinese · Table", zh: "中文 · 表格" },
    filename: "table.png",
    id: "table",
    label: { en: "Table document", zh: "表格文档" },
    mimeType: "image/png",
    sha256: "6d50148ceccb2d5cecc50b084b5105e3167f2d55a8899b29e04c3ebe46e88fa8",
    sourceUrl:
      "https://github.com/PaddlePaddle/PaddleOCR/blob/2661c7c0ef5c613e8f93c6e93b2e052399f0f854/tests/test_files/medal_table.png"
  },
  {
    coverage: { en: "Chinese/English · Figures", zh: "中英文 · 图片与图表" },
    filename: "image-layout.jpg",
    id: "image-layout",
    label: { en: "Mixed layout", zh: "图文混排" },
    mimeType: "image/jpeg",
    sha256: "cfebd4e0716da8ef01ad29c6f5bf7ed0dcc7d3a07bd38e32219c3b10645798de",
    sourceUrl:
      "https://github.com/PaddlePaddle/PaddleOCR/blob/2661c7c0ef5c613e8f93c6e93b2e052399f0f854/docs/version2.x/ppstructure/model_train/images/layout.jpg"
  }
];

export function sampleUrl(sample: DemoSample): string {
  return `${import.meta.env.BASE_URL}samples/${sample.filename}`;
}

export async function fetchSampleFile(sample: DemoSample): Promise<File> {
  const response = await fetch(sampleUrl(sample));
  if (!response.ok) throw new Error(`Unable to load sample ${sample.filename}`);
  return new File([await response.blob()], sample.filename, { type: sample.mimeType });
}

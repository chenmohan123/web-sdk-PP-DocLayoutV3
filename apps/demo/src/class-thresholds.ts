export function uniqueLabels(labels: readonly string[]): readonly string[] {
  return [...new Set(labels)];
}

export const DEFAULT_CLASS_LABELS = uniqueLabels([
  "abstract",
  "algorithm",
  "aside_text",
  "chart",
  "content",
  "formula",
  "doc_title",
  "figure_title",
  "footer",
  "footer",
  "footnote",
  "formula_number",
  "header",
  "header",
  "image",
  "formula",
  "number",
  "paragraph_title",
  "reference",
  "reference_content",
  "seal",
  "table",
  "text",
  "text",
  "vision_footnote"
]);

function createThresholdRecord(): Record<string, number> {
  return Object.create(null) as Record<string, number>;
}

export function classThresholdValue(
  thresholds: Readonly<Record<string, number>>,
  label: string
): number | "" {
  return Object.hasOwn(thresholds, label) ? thresholds[label]! : "";
}

export function setClassThresholdValue(
  thresholds: Readonly<Record<string, number>>,
  label: string,
  value: string
): Record<string, number> {
  const next = Object.assign(createThresholdRecord(), thresholds);
  if (value === "") delete next[label];
  else next[label] = Number(value);
  return next;
}

export function selectActiveClassThresholds(
  labels: readonly string[],
  thresholds: Readonly<Record<string, number>>
): Readonly<Record<string, number>> {
  const selected = createThresholdRecord();
  for (const label of uniqueLabels(labels)) {
    if (Object.hasOwn(thresholds, label)) selected[label] = thresholds[label]!;
  }
  return selected;
}

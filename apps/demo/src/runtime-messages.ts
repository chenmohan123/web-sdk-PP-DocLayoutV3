import type { DocLayoutFallback } from "web-sdk-pp-doclayoutv3";

function nestedMessage(value: unknown): string | undefined {
  if (value instanceof Error) return value.message;
  if (typeof value !== "object" || value === null || !("message" in value)) return undefined;
  return typeof value.message === "string" ? value.message : undefined;
}

export function formatRuntimeError(error: unknown): string {
  const message = nestedMessage(error) ?? String(error);
  if (typeof error !== "object" || error === null || !("details" in error)) return message;
  const details = error.details;
  if (typeof details !== "object" || details === null || !("causeMessage" in details)) {
    return message;
  }
  return typeof details.causeMessage === "string" && details.causeMessage !== message
    ? `${message}: ${details.causeMessage}`
    : message;
}

export function formatFallbackCause(
  fallback: Pick<DocLayoutFallback, "cause" | "message">
): string {
  return nestedMessage(fallback.cause) ?? fallback.message;
}

export type DocLayoutErrorCode =
  | "CAPABILITY_UNSUPPORTED"
  | "MANIFEST_INVALID"
  | "MODEL_INCOMPATIBLE"
  | "MODEL_DOWNLOAD_FAILED"
  | "MODEL_INTEGRITY_FAILED"
  | "IMAGE_INVALID"
  | "SESSION_CREATE_FAILED"
  | "INFERENCE_FAILED"
  | "OUT_OF_MEMORY"
  | "ABORTED";

export class DocLayoutError extends Error {
  constructor(
    public readonly code: DocLayoutErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "DocLayoutError";
  }
}

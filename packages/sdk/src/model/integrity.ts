import { DocLayoutError } from "../errors";
import type { ModelVariant } from "../types";

export async function sha256Hex(
  data: ArrayBuffer,
  subtle: SubtleCrypto = globalThis.crypto.subtle
): Promise<string> {
  let digest: ArrayBuffer;
  try {
    digest = await subtle.digest("SHA-256", data);
  } catch (cause) {
    throw new DocLayoutError(
      "MODEL_INTEGRITY_FAILED",
      "Unable to compute the model SHA-256 digest",
      {},
      { cause }
    );
  }
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function verifyModelIntegrity(
  data: ArrayBuffer,
  variant: Pick<ModelVariant, "bytes" | "id" | "sha256">,
  subtle?: SubtleCrypto
): Promise<void> {
  if (data.byteLength !== variant.bytes) {
    throw new DocLayoutError(
      "MODEL_INTEGRITY_FAILED",
      `Model ${variant.id} byte size does not match its manifest`,
      { actualBytes: data.byteLength, expectedBytes: variant.bytes, variantId: variant.id }
    );
  }
  const actualSha256 = await sha256Hex(data, subtle);
  if (actualSha256 !== variant.sha256.toLowerCase()) {
    throw new DocLayoutError(
      "MODEL_INTEGRITY_FAILED",
      `Model ${variant.id} SHA-256 does not match its manifest`,
      { actualSha256, expectedSha256: variant.sha256, variantId: variant.id }
    );
  }
}

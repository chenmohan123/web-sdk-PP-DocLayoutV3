export class DocLayoutError extends Error {}

export function createDocLayout(): Promise<never> {
  return Promise.reject(new DocLayoutError("SDK implementation is not initialized"));
}

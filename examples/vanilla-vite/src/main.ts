import { createDocLayout, DocLayoutError, type DocLayoutDetector } from "web-sdk-pp-doclayoutv3";

const image = document.querySelector<HTMLInputElement>("#image")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const progress = document.querySelector<HTMLProgressElement>("#progress")!;
const output = document.querySelector<HTMLPreElement>("#output")!;
let detector: DocLayoutDetector | undefined;

document.querySelector("#detect")!.addEventListener("click", async () => {
  const file = image.files?.[0];
  if (file === undefined) return;
  try {
    await detector?.dispose();
    detector = await createDocLayout({
      backend: "auto",
      precision: "auto",
      onProgress: (event) => {
        status.textContent = `${event.phase}: ${event.status}`;
        if (event.totalBytes !== undefined)
          progress.value = ((event.loadedBytes ?? 0) / event.totalBytes) * 100;
      }
    });
    const result = await detector.detect(file, { threshold: 0.5 });
    progress.value = 100;
    output.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    const detail =
      error instanceof DocLayoutError
        ? { code: error.code, message: error.message, details: error.details }
        : { message: String(error) };
    output.textContent = JSON.stringify(detail, null, 2);
  }
});

window.addEventListener("pagehide", () => void detector?.dispose());

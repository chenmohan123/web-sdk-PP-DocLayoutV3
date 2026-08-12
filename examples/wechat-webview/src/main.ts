import { createDocLayout, DocLayoutError, type DocLayoutDetector } from "web-sdk-pp-doclayoutv3";

const image = document.querySelector<HTMLInputElement>("#image")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const progress = document.querySelector<HTMLProgressElement>("#progress")!;
const output = document.querySelector<HTMLPreElement>("#output")!;
let detector: DocLayoutDetector | undefined;

document.addEventListener("WeixinJSBridgeReady", () => {
  status.textContent = "微信 H5/WebView 已就绪";
});
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
  } catch (caught) {
    const detail =
      caught instanceof DocLayoutError
        ? { code: caught.code, message: caught.message, details: caught.details }
        : { message: String(caught) };
    output.textContent = JSON.stringify(detail, null, 2);
  }
});
window.addEventListener("pagehide", () => void detector?.dispose());

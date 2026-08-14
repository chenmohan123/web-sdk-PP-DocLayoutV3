import { expect, test } from "playwright/test";

const pixelPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("maps SDK progress events to honest model status text states", async ({ page }) => {
  await page.goto("/?fixture=1");
  const states = await page.evaluate(async (moduleUrl) => {
    type EvaluatedState =
      | { readonly status: "downloading"; readonly percentage?: number }
      | { readonly status: "loading" };
    const { modelProgressState } = (await import(moduleUrl)) as {
      readonly modelProgressState: (event: {
        readonly phase: string;
        readonly status: string;
        readonly loadedBytes?: number;
        readonly totalBytes?: number;
      }) => EvaluatedState | undefined;
    };
    return [
      modelProgressState({ phase: "model", status: "start" }),
      modelProgressState({ phase: "model", status: "progress", loadedBytes: 56 }),
      modelProgressState({
        phase: "model",
        status: "progress",
        loadedBytes: 56,
        totalBytes: 100
      }),
      modelProgressState({ phase: "session", status: "start" }),
      modelProgressState({ phase: "ready", status: "complete" })
    ];
  }, "/src/model-progress.ts");

  expect(states).toEqual([
    { status: "loading" },
    { status: "downloading" },
    { percentage: 56, status: "downloading" },
    { status: "loading" },
    undefined
  ]);
});

test("keeps manual choices strict and uses only validated default pairs", async ({ page }) => {
  await page.goto("/?fixture=1");
  const behavior = await page.evaluate(
    async ({ preferencesUrl, messagesUrl }) => {
      const preferences = (await import(
        preferencesUrl
      )) as unknown as typeof import("../src/execution-preferences");
      const messages = (await import(
        messagesUrl
      )) as unknown as typeof import("../src/runtime-messages");
      return {
        autoFallback: preferences.allowFallbackForSelection("auto", "auto"),
        backendFallback: preferences.allowFallbackForSelection("webgpu", "auto"),
        precisionFallback: preferences.allowFallbackForSelection("auto", "fp32"),
        gpuFp16: preferences.supportsCombination("webgpu", "fp16"),
        gpuFp32: preferences.supportsCombination("webgpu", "fp32"),
        wasmFp16: preferences.supportsCombination("wasm", "fp16"),
        wasmFp32: preferences.supportsCombination("wasm", "fp32"),
        gpuCorrection: preferences.precisionForBackend("webgpu", "fp32"),
        wasmCorrection: preferences.precisionForBackend("wasm", "fp16"),
        runtimeError: messages.formatRuntimeError({
          details: { causeMessage: "unsupported WebGPU operator" },
          message: "ONNX session-create failed for webgpu"
        }),
        fallbackCause: messages.formatFallbackCause({
          cause: { message: "adapter allocation failed" },
          message: "ONNX session-create failed for webgpu"
        })
      };
    },
    {
      preferencesUrl: "/src/execution-preferences.ts",
      messagesUrl: "/src/runtime-messages.ts"
    }
  );

  expect(behavior).toEqual({
    autoFallback: true,
    backendFallback: false,
    precisionFallback: false,
    gpuFp16: true,
    gpuFp32: false,
    wasmFp16: false,
    wasmFp32: true,
    gpuCorrection: "fp16",
    wasmCorrection: "fp32",
    runtimeError: "ONNX session-create failed for webgpu: unsupported WebGPU operator",
    fallbackCause: "adapter allocation failed"
  });
});

test("reports loading before detecting for an in-memory model", async ({ page }) => {
  await page.route("**/ort-fixture/*.wasm", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await page.goto("/?fixture=1");
  await page.locator('input[type="file"]').setInputFiles({
    name: "status.png",
    mimeType: "image/png",
    buffer: Buffer.from(pixelPng, "base64")
  });
  await page.getByTestId("status").evaluate((target) => {
    const history: string[] = [];
    Object.defineProperty(window, "__statusHistory", { configurable: true, value: history });
    const record = (): void => {
      const snapshot = target.cloneNode(true) as HTMLElement;
      snapshot.querySelector(".status-hint")?.remove();
      const text = snapshot.textContent?.trim();
      if (text !== undefined && history.at(-1) !== text) history.push(text);
    };
    new MutationObserver(record).observe(target, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    });
    record();
  });

  const wasmRequest = page.waitForRequest(
    (request) => request.url().includes("/ort-fixture/") && request.url().endsWith(".wasm")
  );
  await page.getByRole("button", { name: "开始检测" }).click();
  await wasmRequest;
  await expect(page.getByTestId("status")).toContainText("模型加载中");
  await expect(page.getByTestId("status")).toContainText("检测完成", { timeout: 15_000 });

  const history = await page.evaluate(
    () =>
      (window as typeof window & { readonly __statusHistory: readonly string[] }).__statusHistory
  );
  const loadingIndex = history.indexOf("模型加载中");
  const detectingIndex = history.indexOf("检测中");
  const successIndex = history.indexOf("检测完成");
  expect(loadingIndex).toBeGreaterThanOrEqual(0);
  expect(detectingIndex).toBeGreaterThan(loadingIndex);
  expect(successIndex).toBeGreaterThan(detectingIndex);
  expect(history.some((text) => text.includes("模型下载中") || text.includes("0%"))).toBe(false);
});

test("starts in Chinese and exposes the complete detection workflow", async ({
  page
}, testInfo) => {
  await page.goto("/?fixture=1");

  const fixtureOrtModule = await page.request.get("/ort-fixture/ort-wasm-simd-threaded.jsep.mjs");
  expect(fixtureOrtModule.status()).toBe(200);
  expect(fixtureOrtModule.headers()["content-type"]).toContain("text/javascript");

  await expect(page.getByRole("heading", { name: "PP-DocLayoutV3" })).toBeVisible();
  await expect(page.getByRole("link", { name: "GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3"
  );
  await expect(page.getByRole("link", { name: "GitHub" })).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: "GitHub" })).toHaveAttribute("rel", "noreferrer");
  await expect(page.getByText("SDK 1.0.4", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "English", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "运行后端" })).toBeVisible();
  await expect(page.getByRole("group", { name: "模型精度" })).toBeVisible();
  await page.getByRole("group", { name: "运行后端" }).getByRole("button", { name: "CPU" }).click();
  await expect(
    page.getByRole("group", { name: "运行后端" }).getByRole("button", { name: "CPU" })
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("group", { name: "模型精度" }).getByRole("button", { name: "FP32" }).click();
  await expect(page.getByRole("button", { name: "选择图片" })).toBeVisible();
  await expect(page.getByText("模型信息")).toBeVisible();

  const performance = page.getByTestId("performance-section");
  const initialization = performance.getByTestId("initialization-timings");
  const detection = performance.getByTestId("detection-timings");
  await expect(initialization).toBeVisible();
  await expect(detection).toBeVisible();

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "fixture.png",
    mimeType: "image/png",
    buffer: Buffer.from(pixelPng, "base64")
  });
  await expect(page.getByRole("button", { name: "开始检测" })).toBeEnabled();
  await page.getByRole("button", { name: "开始检测" }).click();
  await expect(page.getByTestId("status")).toContainText("检测完成", { timeout: 15_000 });
  await expect(page.getByTestId("result-canvas")).toBeVisible();
  await expect(
    page.getByTestId("result-panel").getByRole("heading", { name: "检测结果" })
  ).toBeVisible();
  await expect(initialization.getByText("初始化", { exact: true })).toBeVisible();
  await expect(detection.getByText("本次检测", { exact: true })).toBeVisible();
  await expect(initialization.getByText("初始化总耗时", { exact: true })).toBeVisible();
  await expect(detection.getByText("端到端耗时", { exact: true })).toBeVisible();
  await expect(detection.getByText("图片解码", { exact: true })).toBeVisible();
  await expect(detection.getByText("模型推理", { exact: true })).toBeVisible();
  await expect(detection).toContainText("端到端耗时还包含 Worker 通信与结果传输等少量开销。");
  expect(
    await performance.evaluate((section: HTMLElement) => {
      const initialization = section.querySelector('[data-testid="initialization-timings"]');
      const detection = section.querySelector('[data-testid="detection-timings"]');
      return Boolean(
        initialization &&
        detection &&
        initialization.compareDocumentPosition(detection) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    })
  ).toBe(true);
  await expect(page.getByTestId("timing-total")).toContainText("ms");
  await expect(page.getByTestId("model-name")).not.toHaveText("-");
  await expect(page.getByRole("button", { name: "导出 JSON" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "清理缓存" })).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("pp-doclayoutv3-result.json");
  await page.getByRole("button", { name: "清理缓存" }).click();
  await expect(page.getByTestId("notice")).toContainText("缓存已清理");
  const canvasPixels = await page
    .getByTestId("result-canvas")
    .evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d");
      if (context === null) return 0;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let index = 0; index < pixels.length; index += 4)
        sum += pixels[index]! + pixels[index + 1]! + pixels[index + 2]!;
      return sum;
    });
  expect(canvasPixels).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("desktop.png"), fullPage: true });
});

test("enforces the validated default model matrix in controls", async ({ page }) => {
  await page.goto("/?fixture=1");
  const backend = page.getByRole("group", { name: "运行后端" });
  const precision = page.getByRole("group", { name: "模型精度" });

  await precision.getByRole("button", { name: "FP32" }).click();
  await backend.getByRole("button", { name: "GPU" }).click();
  await expect(precision.getByRole("button", { name: "FP32" })).toBeDisabled();
  await expect(precision.getByRole("button", { name: "FP16" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByTestId("notice")).toContainText(
    "GPU 默认模型当前仅验证了 FP16，已为你切换模型精度"
  );

  await backend.getByRole("button", { name: "自动" }).click();
  await precision.getByRole("button", { name: "FP16" }).click();
  await backend.getByRole("button", { name: "CPU" }).click();

  await expect(precision.getByRole("button", { name: "FP16" })).toBeDisabled();
  await expect(precision.getByRole("button", { name: "FP16" })).toHaveAttribute(
    "title",
    "CPU 当前仅支持 FP32，已为你切换模型精度。"
  );
  await expect(precision.getByRole("button", { name: "FP32" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByTestId("notice")).toContainText("CPU 当前仅支持 FP32，已为你切换模型精度");
  await page.locator('input[type="file"]').setInputFiles({
    name: "cpu-fp16.png",
    mimeType: "image/png",
    buffer: Buffer.from(pixelPng, "base64")
  });

  await page.getByRole("button", { name: "开始检测" }).click();
  await expect(page.getByTestId("status")).toContainText("检测完成", { timeout: 15_000 });
  await expect(page.getByText("wasm", { exact: true })).toBeVisible();
  await expect(page.getByText("fp32", { exact: true })).toBeVisible();
});

test("shows local sample documents and only previews a selected sample", async ({ page }) => {
  await page.goto("/?fixture=1");
  await expect(page.getByTestId("sample-gallery")).toBeVisible();
  await expect(page.getByTestId("result-panel").getByTestId("sample-gallery")).toBeVisible();
  expect(
    await page.getByTestId("result-panel").evaluate((panel: HTMLElement) => {
      const canvas = panel.querySelector(".canvas-wrap");
      const samples = panel.querySelector('[data-testid="sample-gallery"]');
      return Boolean(
        canvas &&
        samples &&
        canvas.compareDocumentPosition(samples) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    })
  ).toBe(true);
  await expect(page.getByRole("button", { name: /版面示例/ }).first()).toBeVisible();
  await page
    .getByRole("button", { name: /版面示例/ })
    .first()
    .click();
  await expect(page.getByTestId("status")).toContainText("准备就绪");
  await expect(page.getByRole("button", { name: "开始检测" })).toBeEnabled();
  await expect(page.getByTestId("sample-source")).toContainText("PaddleOCR");
});

test("orders runtime details before fallback and potentially long detections", async ({ page }) => {
  await page.goto("/?fixture=1");

  expect(
    await page
      .getByTestId("details-panel")
      .evaluate((panel: HTMLElement) =>
        [...panel.children]
          .map((element) => element.getAttribute("data-testid"))
          .filter((value): value is string => value !== null)
      )
  ).toEqual([
    "performance-section",
    "model-section",
    "fallback-slot",
    "detection-section",
    "detail-actions"
  ]);
});

test("switches language, toggles overlays, validates custom model input, and cancels", async ({
  page
}) => {
  await page.goto("/?fixture=1");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "PP-DocLayoutV3" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select image" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run detection" })).toBeVisible();

  await page.getByRole("button", { name: "Polygon" }).click();
  await expect(page.getByRole("button", { name: "Box" })).toBeVisible();
  await page.getByRole("button", { name: "Custom manifest" }).click();
  await expect(page.getByRole("dialog", { name: "Custom model" })).toBeVisible();
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByRole("alert")).toContainText(/manifest/i);
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "cancel.png",
    mimeType: "image/png",
    buffer: Buffer.from(pixelPng, "base64")
  });
  await page.getByRole("button", { name: "Run detection" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("status")).toContainText("Ready");
});

test("stacks the result workflow on a narrow viewport without horizontal overflow", async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?fixture=1");
  await expect(page.getByTestId("demo-shell")).toBeVisible();
  const overflow = await page.evaluate(() => ({
    containers: [...document.querySelectorAll<HTMLElement>("html, body, body *")]
      .filter((element) => element.scrollWidth > element.clientWidth)
      .map((element) => ({
        className: element.className,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        tagName: element.tagName
      })),
    clientWidth: document.documentElement.clientWidth,
    elements: [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          bounds: {
            left: Math.round(bounds.left * 100) / 100,
            right: Math.round(bounds.right * 100) / 100,
            width: Math.round(bounds.width * 100) / 100
          },
          className: element.className,
          tagName: element.tagName
        };
      })
      .filter(({ bounds }) => bounds.left < 0 || bounds.right > innerWidth),
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth
  }));
  await page.screenshot({ path: testInfo.outputPath("mobile.png"), fullPage: true });
  expect(overflow, JSON.stringify(overflow, null, 2)).toMatchObject({
    clientWidth: 390,
    elements: [],
    scrollWidth: 390,
    viewportWidth: 390
  });
  await expect(page.getByTestId("controls")).toBeVisible();
  await expect(page.getByTestId("result-panel")).toBeVisible();
  await expect(page.getByTestId("details-panel")).toBeVisible();

  const fallbackCause = await page.evaluate((cause) => {
    const slot = document.querySelector<HTMLElement>('[data-testid="fallback-slot"]');
    if (slot === null) throw new Error("Fallback slot is missing");
    slot.innerHTML = `<section class="detail-section"><div class="fallback-row"><small>${cause}</small></div></section>`;
    const element = slot.querySelector<HTMLElement>(".fallback-row small");
    if (element === null) throw new Error("Fallback cause is missing");
    return {
      clientWidth: element.clientWidth,
      overflowWrap: getComputedStyle(element).overflowWrap,
      scrollWidth: element.scrollWidth
    };
  }, "adapterallocationfailed".repeat(30));
  expect(fallbackCause.scrollWidth).toBeLessThanOrEqual(fallbackCause.clientWidth);
  expect(fallbackCause.overflowWrap).toBe("anywhere");
});

for (const viewport of [
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 }
]) {
  test(`has no horizontal overflow at ${viewport.width}x${viewport.height}`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/?fixture=1");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.screenshot({
      path: testInfo.outputPath(`${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });
  });
}

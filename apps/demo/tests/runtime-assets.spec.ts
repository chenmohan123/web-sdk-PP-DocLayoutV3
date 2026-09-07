import { expect, test, type Page } from "playwright/test";
import { TINY_MODEL_BASE64, tinyModelManifest } from "../src/fixture";
import { selectionToModel } from "../src/model-sources";

async function selectImage(page: Page, name: string): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    )
  });
}

for (const source of ["modelscope", "huggingface"] as const) {
  test(`普通页面从 ${source} 下载模型并加载同源 WASM`, async ({ page }) => {
    const manifestUrl = selectionToModel(source)!;
    const modelUrl = new URL("tiny-model.onnx", manifestUrl);
    modelUrl.search = new URL(manifestUrl).search;
    const modelRequests: string[] = [];
    const wasmRequests: string[] = [];
    // 保留历史清单中的异源 URL，检验页面是否遵守明确选择的模型来源。
    await page.route(manifestUrl, (route) => route.fulfill({ json: tinyModelManifest }));
    await page.route("**/*.onnx*", async (route) => {
      modelRequests.push(route.request().url());
      await route.fulfill({
        body: Buffer.from(TINY_MODEL_BASE64, "base64"),
        contentType: "application/octet-stream"
      });
    });
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith(".wasm")) wasmRequests.push(request.url());
    });
    await page.goto("/");
    await page.getByLabel("模型来源", { exact: true }).selectOption(source);
    await page.getByRole("button", { name: "CPU", exact: true }).click();
    await selectImage(page, "来源验证.png");
    await page.getByRole("button", { name: "开始检测", exact: true }).click();
    await expect(page.getByTestId("status")).toContainText("检测完成", { timeout: 20_000 });
    expect(modelRequests).toEqual([modelUrl.href]);
    expect(wasmRequests.length).toBeGreaterThan(0);
    for (const url of wasmRequests) {
      expect(new URL(url).origin).toBe(new URL(page.url()).origin);
      expect(new URL(url).pathname).toContain("/ort/");
      const response = await page.request.get(url);
      expect(response.headers()["content-type"]).toContain("application/wasm");
      expect([...(await response.body()).subarray(0, 4)]).toEqual([0, 97, 115, 109]);
      await response.dispose();
    }
  });
}

test("更换图片后旧模型任务不能恢复加载状态或结果", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/*.wasm", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/?fixture=1");
  await page.getByRole("button", { name: "CPU", exact: true }).click();
  await selectImage(page, "旧图片.png");
  const wasmRequested = page.waitForRequest((request) => request.url().endsWith(".wasm"));
  await page.getByRole("button", { name: "开始检测", exact: true }).click();
  await wasmRequested;
  await selectImage(page, "新图片.png");
  release();
  await page.waitForTimeout(1_500);
  await expect(page.getByTestId("status")).toContainText("新图片.png");
  await expect(page.getByTestId("status")).not.toContainText("检测完成");
  await expect(page.locator(".detection-row")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "开始检测", exact: true })).toBeEnabled();
});

test("较早的样例下载不能覆盖最后选择的样例", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/samples/layout-demo.jpg", async (route) => {
    if (route.request().resourceType() === "fetch") await gate;
    await route.continue();
  });
  await page.goto("/?fixture=1");
  await page.locator(".sample-card").nth(0).click();
  await page.locator(".sample-card").nth(1).click();
  await expect(page.getByTestId("status")).toContainText("doc-formula.png");
  release();
  await page.waitForTimeout(400);
  await expect(page.getByTestId("status")).toContainText("doc-formula.png");
});

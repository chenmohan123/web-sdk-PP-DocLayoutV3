import { expect, test } from "playwright/test";

const pixelPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("starts in Chinese and exposes the complete detection workflow", async ({
  page
}, testInfo) => {
  await page.goto("/?fixture=1");

  await expect(page.getByRole("heading", { name: "PP-DocLayoutV3" })).toBeVisible();
  await expect(page.getByText("SDK 1.0.2", { exact: true })).toBeVisible();
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
  await expect(page.getByTestId("timing-total")).toContainText("ms");
  await expect(page.getByTestId("model-name")).not.toHaveText("-");
  await expect(page.getByRole("button", { name: "导出 JSON" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "清理缓存" })).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("pp-doclayoutv3-result.json");
  await page.getByRole("button", { name: "清理缓存" }).click();
  await expect(page.getByTestId("notice")).toContainText("缓存已清理");
  const canvasPixels = await page.getByTestId("result-canvas").evaluate((canvas) => {
    const context = (canvas as HTMLCanvasElement).getContext("2d");
    if (context === null) return 0;
    const pixels = context.getImageData(
      0,
      0,
      (canvas as HTMLCanvasElement).width,
      (canvas as HTMLCanvasElement).height
    ).data;
    let sum = 0;
    for (let index = 0; index < pixels.length; index += 4)
      sum += pixels[index]! + pixels[index + 1]! + pixels[index + 2]!;
    return sum;
  });
  expect(canvasPixels).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("desktop.png"), fullPage: true });
});

test("shows local sample documents and only previews a selected sample", async ({ page }) => {
  await page.goto("/?fixture=1");
  await expect(page.getByTestId("sample-gallery")).toBeVisible();
  await expect(page.getByRole("button", { name: /版面示例/ }).first()).toBeVisible();
  await page
    .getByRole("button", { name: /版面示例/ })
    .first()
    .click();
  await expect(page.getByTestId("status")).toContainText("准备就绪");
  await expect(page.getByRole("button", { name: "开始检测" })).toBeEnabled();
  await expect(page.getByTestId("sample-source")).toContainText("PaddleOCR");
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

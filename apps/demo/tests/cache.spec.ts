import { expect, test } from "playwright/test";
import { TINY_MODEL_BASE64, tinyModelManifest } from "../src/fixture";

test("同来源的迟到缓存清单不能覆盖实际加载的新模型版本", async ({ page }) => {
  const current = { ...tinyModelManifest, model: { ...tinyModelManifest.model, version: "2.0.0" } };
  let running = false;
  let requested = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const state = window as Window & { manifestPending?: number };
    state.manifestPending = 0;
    window.fetch = async (...args) => {
      const input = args[0];
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("manifest.json")) return originalFetch(...args);
      state.manifestPending! += 1;
      try {
        const response = await originalFetch(...args);
        await response.clone().arrayBuffer();
        return response;
      } finally {
        state.manifestPending! -= 1;
      }
    };
  });
  await page.route("**/manifest.json?*", async (route) => {
    if (!running) {
      requested += 1;
      await gate;
      await route.fulfill({ json: tinyModelManifest });
    } else await route.fulfill({ json: current });
  });
  await page.route("**/*.onnx*", (route) =>
    route.fulfill({
      body: Buffer.from(TINY_MODEL_BASE64, "base64"),
      contentType: "application/octet-stream"
    })
  );
  try {
    await page.goto("/");
    await expect.poll(() => requested).toBeGreaterThan(0);
    await page.getByRole("button", { name: "CPU", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "cache.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      )
    });
    running = true;
    await page.getByRole("button", { name: "开始检测" }).click();
    await expect(page.getByTestId("status")).toContainText("检测完成", { timeout: 20000 });
    release();
    await page.waitForFunction(
      () => (window as Window & { manifestPending?: number }).manifestPending === 0
    );
    await page.locator('[data-sdk-cache-clear="current"]').click();
    await expect(page.getByTestId("notice")).toContainText("缓存已清理");
    const remaining = await page.evaluate(async () =>
      (await (await caches.open("ppdoclayout-models-v1")).keys()).map((request) =>
        decodeURIComponent(new URL(request.url).pathname.slice(1))
      )
    );
    expect(remaining.filter((key) => key.includes(":2.0.0:"))).toEqual([]);
  } finally {
    release();
  }
});

test("加载期间不能应用另一份自定义清单覆盖当前模型身份", async ({ page }) => {
  await page.goto("/?fixture=1");
  const fixture = await page.evaluate(async (moduleUrl) => {
    const { tinyModelManifest, tinyModelData } = (await import(
      moduleUrl
    )) as typeof import("../src/fixture");
    return { manifest: tinyModelManifest, data: Array.from(new Uint8Array(tinyModelData())) };
  }, "/src/fixture.ts");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/manifest.json?*", (route) => route.fulfill({ json: fixture.manifest }));
  await page.route("**/*.onnx*", async (route) => {
    await gate;
    await route.fulfill({
      body: Buffer.from(fixture.data),
      contentType: "application/octet-stream"
    });
  });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "CPU", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "cache.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      )
    });
    await page.getByRole("button", { name: "开始检测" }).click();
    await page.getByRole("button", { name: "自定义 manifest" }).click();
    await page.getByLabel("manifest JSON").fill(
      JSON.stringify({
        ...fixture.manifest,
        model: { ...fixture.manifest.model, id: "other-model" }
      })
    );
    await expect(page.getByRole("button", { name: "校验", exact: true })).toBeDisabled();
    release();
    await expect(page.getByTestId("status")).toContainText("检测完成", { timeout: 20000 });
    await expect(page.getByRole("button", { name: "校验", exact: true })).toBeEnabled();
  } finally {
    release();
  }
});

test("当前模型清理保留其他模型，全清仅删除本 SDK，并显示真实容量", async ({ page }) => {
  await page.goto("/?fixture=1");
  await page.evaluate(async (moduleUrl) => {
    const { tinyModelManifest } = (await import(moduleUrl)) as typeof import("../src/fixture");
    const cache = await caches.open("ppdoclayout-models-v1");
    const keys = [
      `ppdoclayout:${tinyModelManifest.model.id}:${tinyModelManifest.model.version}:fp32:hash`,
      "ppdoclayout:other:1:fp32:hash",
      "other-sdk:other:1:fp32:hash"
    ];
    for (const key of keys) {
      await cache.put(
        `https://cache.ppdoclayout.invalid/${encodeURIComponent(key)}`,
        new Response(new Uint8Array(4), {
          headers: { "content-length": "4", "x-ppdoclayout-sha256": "hash" }
        })
      );
    }
  }, "/src/fixture.ts");
  await page.reload();
  await expect(page.locator("[data-sdk-cache-usage]")).toContainText("4 B");
  await page.locator('[data-sdk-cache-clear="current"]').click();
  await expect(page.locator("[data-sdk-cache-usage]")).toContainText("0 B");
  const keys = () =>
    page.evaluate(async () =>
      (await (await caches.open("ppdoclayout-models-v1")).keys()).map((request) =>
        decodeURIComponent(new URL(request.url).pathname.slice(1))
      )
    );
  expect(await keys()).toEqual(["ppdoclayout:other:1:fp32:hash", "other-sdk:other:1:fp32:hash"]);
  await page.locator('[data-sdk-cache-clear="all"]').click();
  await expect(page.getByTestId("notice")).toContainText("缓存已清理");
  expect(await keys()).toEqual(["other-sdk:other:1:fp32:hash"]);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator('[data-sdk-cache-clear="current"]')).toHaveText(
    "Clear current model cache"
  );
});

test("清理失败显示可读错误并恢复按钮", async ({ page }) => {
  await page.goto("/?fixture=1");
  await page.evaluate(() => {
    Cache.prototype.delete = () => Promise.reject(new Error("缓存删除失败"));
  });
  await page.evaluate(async () => {
    const cache = await caches.open("ppdoclayout-models-v1");
    await cache.put(
      "https://cache.ppdoclayout.invalid/ppdoclayout%3Aother%3A1%3Afp32%3Ahash",
      new Response(new Uint8Array(4), {
        headers: { "content-length": "4", "x-ppdoclayout-sha256": "hash" }
      })
    );
  });
  await page.locator('[data-sdk-cache-clear="all"]').click();
  await expect(page.getByRole("alert")).toContainText("缓存删除失败");
  await expect(page.locator('[data-sdk-cache-clear="all"]')).toBeEnabled();
});

test("清理释放真实 Worker 和持久写入失败后的内存缓存", async ({ page }) => {
  await page.goto("/?fixture=1");
  const fixture = await page.evaluate(async (moduleUrl) => {
    const { tinyModelManifest, tinyModelData } = (await import(
      moduleUrl
    )) as typeof import("../src/fixture");
    return { manifest: tinyModelManifest, data: Array.from(new Uint8Array(tinyModelData())) };
  }, "/src/fixture.ts");
  await page.route("**/manifest.json?*", (route) => route.fulfill({ json: fixture.manifest }));
  await page.route("**/*.onnx*", (route) =>
    route.fulfill({ body: Buffer.from(fixture.data), contentType: "application/octet-stream" })
  );
  await page.goto("/");
  await page.evaluate(() => {
    Cache.prototype.put = () => Promise.reject(new DOMException("配额不足", "QuotaExceededError"));
  });
  await page.getByRole("button", { name: "CPU", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "cache.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    )
  });
  await page.getByRole("button", { name: "开始检测" }).click();
  await expect(page.getByTestId("status")).toContainText("检测完成", { timeout: 20_000 });
  await expect.poll(() => page.workers().length).toBeGreaterThan(0);
  await expect(page.locator("[data-sdk-cache-usage]")).toContainText(`${fixture.data.length} B`);
  await page.locator('[data-sdk-cache-clear="current"]').click();
  await expect(page.locator("[data-sdk-cache-usage]")).toContainText("0 B");
  await expect.poll(() => page.workers().length).toBe(0);
});

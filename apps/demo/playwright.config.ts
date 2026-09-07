import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: process.env.DEMO_BASE_URL ?? "http://127.0.0.1:4174",
    browserName: "chromium",
    headless: true
  },
  ...(process.env.DEMO_BASE_URL
    ? {}
    : {
        webServer: { command: "pnpm dev --host 127.0.0.1", port: 4174, reuseExistingServer: false }
      }),
  workers: 1
});

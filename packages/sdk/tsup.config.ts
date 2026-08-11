import { defineConfig } from "tsup";

const shared = {
  outDir: "dist",
  platform: "browser" as const,
  sourcemap: true,
  target: "es2022" as const,
  treeshake: true
};

export default defineConfig([
  {
    ...shared,
    clean: true,
    dts: true,
    entry: { index: "src/index.ts" },
    external: [/^onnxruntime-web(?:\/.*)?$/],
    format: ["esm"],
    splitting: true,
    define: {
      __PPDOCLAYOUT_MODULE_URL__: "import.meta.url"
    }
  },
  {
    ...shared,
    clean: false,
    dts: false,
    entry: { "inference.worker": "src/worker/inference.worker.ts" },
    format: ["esm"],
    noExternal: ["onnxruntime-web"],
    splitting: false
  },
  {
    ...shared,
    clean: false,
    dts: false,
    entry: { "browser-global": "src/browser-global.ts" },
    format: ["iife"],
    globalName: "PPDocLayout",
    noExternal: ["onnxruntime-web"],
    outExtension: () => ({ js: ".js" }),
    splitting: false,
    define: {
      __PPDOCLAYOUT_MODULE_URL__: "globalThis.__PPDOCLAYOUT_SCRIPT_URL__"
    }
  }
]);

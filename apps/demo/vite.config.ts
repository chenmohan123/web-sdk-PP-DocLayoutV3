import react from "@vitejs/plugin-react";
import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig, type Plugin } from "vite";

const fixtureOrtAssetNames = new Set([
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jspi.mjs",
  "ort-wasm-simd-threaded.jspi.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm"
]);

function fixtureOrtAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const ortDist = dirname(require.resolve("onnxruntime-web"));
  const prefix = "/ort-fixture/";

  return {
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (!pathname.startsWith(prefix)) {
          next();
          return;
        }

        const filename = decodeURIComponent(pathname.slice(prefix.length));
        if (!fixtureOrtAssetNames.has(filename)) {
          response.statusCode = 404;
          response.end();
          return;
        }

        response.statusCode = 200;
        response.setHeader(
          "Content-Type",
          filename.endsWith(".wasm") ? "application/wasm" : "text/javascript"
        );
        createReadStream(join(ortDist, filename)).on("error", next).pipe(response);
      });
    },
    name: "fixture-ort-assets"
  };
}

export default defineConfig({
  plugins: [fixtureOrtAssets(), react()],
  server: { host: "127.0.0.1", port: 4174 }
});

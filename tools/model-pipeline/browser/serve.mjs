import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePort } from "./port.mjs";

const browserDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(browserDirectory, "../../..");
const ortDirectory = join(repositoryRoot, "packages/sdk/node_modules/onnxruntime-web/dist");
const modelDirectory = join(repositoryRoot, "models/pp-doclayoutv3");
const requestedPort = parsePort(process.argv);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".onnx": "application/octet-stream",
  ".wasm": "application/wasm"
};

function resolveRequest(pathname) {
  if (pathname === "/") return join(browserDirectory, "index.html");
  if (pathname === "/runner.mjs") return join(browserDirectory, "runner.mjs");
  if (pathname.startsWith("/ort/")) return join(ortDirectory, pathname.slice(5));
  if (pathname === "/models/model-fp16.onnx") return join(modelDirectory, "model-fp16.onnx");
  return null;
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const path = resolveRequest(pathname);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");

  if (!path) {
    response.writeHead(404).end("Not found");
    return;
  }

  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) throw new Error("Not a file");
    response.setHeader("Content-Length", metadata.size);
    response.setHeader("Content-Type", contentTypes[extname(path)] ?? "application/octet-stream");
    response.writeHead(200);
    createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(requestedPort, "127.0.0.1", () => {
  console.log(`PP-DocLayoutV3 browser validation: http://127.0.0.1:${requestedPort}/`);
});
